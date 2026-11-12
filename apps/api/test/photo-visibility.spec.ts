import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineController } from '../src/timeline.controller';
import { PHOTO_BATCH_LIMIT } from '../src/photo-ids';
import { PhotoVisibilityService } from '../src/photo-visibility.service';
import { dropUsers, pgClient, pgUrl, photoRow, resetUsers } from './support/pg';

const P = 'pv';
const OWNER = `${P}-owner`;

describe.skipIf(!pgUrl)('PhotoVisibilityService (PostgreSQL)', () => {
  const prisma = pgClient();
  const service = new PhotoVisibilityService(prisma as any);
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index + 1}`);
  const row = (id: string) => prisma.photo.findUniqueOrThrow({ where: { id } });

  const fixture = async (count = 3) => {
    await prisma.photo.createMany({
      data: ids(count).map((id) =>
        photoRow(P, id, {
          effectiveDateValue: new Date('2020-01-01'),
          effectiveDatePrecision: 'YEAR',
        }),
      ),
    });
    await prisma.photo.create({
      data: photoRow(P, 'foreign', { userId: `${P}-other`, driveFileId: 'd-foreign' }),
    });
  };

  /** A service whose photo.updateMany can be made to fail without patching the client. */
  const failingFirstUpdate = () => {
    let calls = 0;
    const wrapped = new Proxy(prisma, {
      get: (target, key) =>
        key === 'photo'
          ? new Proxy(target.photo, {
              get: (photo, method) =>
                method === 'updateMany'
                  ? (...args: unknown[]) =>
                      ++calls === 1
                        ? Promise.reject(new Error('temporary'))
                        : (photo.updateMany as (...a: unknown[]) => unknown)(...args)
                  : (photo as any)[method],
            })
          : (target as any)[key],
    });
    return new PhotoVisibilityService(wrapped as any);
  };

  beforeEach(async () => {
    await resetUsers(prisma, P);
  });
  afterAll(async () => {
    await dropUsers(prisma, P);
    await prisma.$disconnect();
  });

  it('hides and shows again immediately, keeping the row, its date and its copies', async () => {
    await fixture();
    await prisma.photoFile.create({
      data: {
        photoId: 'p1',
        userId: OWNER,
        driveFileId: 'd-p1',
        sourceId: `${P}-source`,
        fileName: 'p1.jpg',
        mimeType: 'image/jpeg',
      },
    });

    const hidden = await service.hide(OWNER, ['p1', 'p2']);
    expect(hidden).toEqual({
      results: [
        { id: 'p1', status: 'HIDDEN' },
        { id: 'p2', status: 'HIDDEN' },
      ],
      changedCount: 2,
    });
    expect((await row('p1')).hiddenAt).toBeInstanceOf(Date);
    expect((await row('p1')).effectiveDatePrecision).toBe('YEAR');
    expect(await prisma.photoFile.count({ where: { userId: OWNER } })).toBe(1);

    const shown = await service.unhide(OWNER, ['p1']);
    expect(shown.results).toEqual([{ id: 'p1', status: 'VISIBLE' }]);
    expect((await row('p1')).hiddenAt).toBeNull();
    expect((await row('p2')).hiddenAt).toBeInstanceOf(Date);
  });

  it('reports repeats and foreign or unknown IDs without touching them', async () => {
    await fixture();
    await service.hide(OWNER, ['p1']);
    const hiddenAt = (await row('p1')).hiddenAt;

    const again = await service.hide(OWNER, ['p1', 'foreign', 'unknown']);
    expect(again.results).toEqual([
      { id: 'p1', status: 'ALREADY_HIDDEN' },
      { id: 'foreign', status: 'NOT_FOUND' },
      { id: 'unknown', status: 'NOT_FOUND' },
    ]);
    expect(again.changedCount).toBe(0);
    expect((await row('p1')).hiddenAt).toEqual(hiddenAt);
    expect((await row('foreign')).hiddenAt).toBeNull();

    const none = await service.unhide(OWNER, ['p2', 'foreign']);
    expect(none.results).toEqual([
      { id: 'p2', status: 'ALREADY_VISIBLE' },
      { id: 'foreign', status: 'NOT_FOUND' },
    ]);
  });

  it('never unhides another user photo', async () => {
    await fixture();
    await prisma.photo.update({
      where: { id: 'foreign' },
      data: { hiddenAt: new Date('2026-01-01') },
    });
    await service.unhide(OWNER, ['foreign']);
    expect((await row('foreign')).hiddenAt).toEqual(new Date('2026-01-01'));
  });

  it('accepts large batches, counting duplicated IDs once', async () => {
    await fixture(1_300);
    const all = ids(1_300);
    const result = await service.hide(OWNER, [...all, 'p1', 'p2']);
    expect(result.results).toHaveLength(1_300);
    expect(result.changedCount).toBe(1_300);
    expect(await prisma.photo.count({ where: { userId: OWNER, hiddenAt: { not: null } } })).toBe(
      1_300,
    );
  }, 60_000);

  it('isolates a failing chunk and still processes the others', async () => {
    await fixture(700);
    const result = await failingFirstUpdate().hide(OWNER, ids(700));
    expect(result.results.filter((entry) => entry.status === 'FAILED')).toHaveLength(500);
    expect(result.results.filter((entry) => entry.status === 'HIDDEN')).toHaveLength(200);
    expect(result.changedCount).toBe(200);
  });

  it.each([undefined, null, [], [''], [42], 'p1', ['x'.repeat(201)]])(
    'rejects invalid input before touching data: %j',
    async (input) => {
      await fixture();
      await expect(service.hide(OWNER, input)).rejects.toMatchObject({ status: 400 });
      expect(await prisma.photo.count({ where: { userId: OWNER, hiddenAt: { not: null } } })).toBe(
        0,
      );
    },
  );

  it(`rejects more than ${PHOTO_BATCH_LIMIT} IDs`, async () => {
    await expect(service.hide(OWNER, ids(PHOTO_BATCH_LIMIT + 1))).rejects.toMatchObject({
      status: 400,
      response: { code: 'BATCH_LIMIT_EXCEEDED' },
    });
  });
});

describe('hidden photos leave every visible listing', () => {
  const makeController = () => {
    const prisma: any = {
      $queryRawUnsafe: vi.fn(async () => []),
      photo: {
        findMany: vi.fn(async () => []),
        groupBy: vi.fn(async () => []),
        count: vi.fn(async () => 0),
      },
      photoCover: { findMany: vi.fn(async () => []) },
      photoSource: { findFirst: vi.fn(async () => ({ id: 'source', userId: 'owner' })) },
      indexedFolder: {
        findFirst: vi.fn(async () => ({ id: 'folder', userId: 'owner', sourceId: 'source' })),
        findMany: vi.fn(async () => []),
      },
    };
    const none = {} as any;
    return {
      prisma,
      controller: new TimelineController(prisma, none, none) as any,
    };
  };

  it('adds the hidden filter to every timeline, count and search query', async () => {
    const { prisma, controller: app } = makeController();
    await app.years('owner');
    await app.yearSummary('owner', '2020');
    await app.monthPreviews('owner', '2020');
    await app.monthPhotos('owner', '2020', '3');
    await app.unknownMonthPhotos('owner', '2020');
    await app.photos('owner', '2020', undefined, undefined, 'YEAR');

    expect(prisma.$queryRawUnsafe.mock.calls.length).toBeGreaterThan(0);
    for (const [sql] of prisma.$queryRawUnsafe.mock.calls)
      expect(sql, sql).toContain('"hiddenAt" IS NULL');
    const prismaCalls = [
      ...prisma.photo.findMany.mock.calls,
      ...prisma.photo.groupBy.mock.calls,
      ...prisma.photo.count.mock.calls,
    ];
    expect(prismaCalls.length).toBeGreaterThan(0);
    for (const [args] of prismaCalls) {
      const where = args.where ?? {};
      if (where.id) continue; // lookups of already selected IDs
      expect(where, JSON.stringify(where)).toHaveProperty('hiddenAt', null);
    }
  });
});
