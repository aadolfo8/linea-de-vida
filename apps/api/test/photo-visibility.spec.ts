import { describe, expect, it, vi } from 'vitest';
import { AppController } from '../src/app.controller';
import { PHOTO_BATCH_LIMIT } from '../src/photo-ids';
import { PhotoVisibilityService } from '../src/photo-visibility.service';
import { MemoryPrisma } from './support/memory-prisma';

function fixture(count = 3) {
  const memory = new MemoryPrisma();
  for (let index = 1; index <= count; index++)
    memory.rows('photo').push({
      id: `p${index}`,
      userId: 'owner',
      status: 'ACTIVE',
      hiddenAt: null,
      effectiveDateValue: new Date('2020-01-01'),
      effectiveDatePrecision: 'YEAR',
    });
  memory.rows('photo').push({ id: 'foreign', userId: 'other', status: 'ACTIVE', hiddenAt: null });
  return { memory, service: new PhotoVisibilityService(memory as any) };
}
const row = (memory: MemoryPrisma, id: string) =>
  memory.rows('photo').find((photo) => photo.id === id)!;

describe('PhotoVisibilityService', () => {
  it('hides and shows again immediately, keeping the row, its date and its copies', async () => {
    const { memory, service } = fixture();
    memory.rows('photoFile').push({ id: 'file', photoId: 'p1', userId: 'owner' });

    const hidden = await service.hide('owner', ['p1', 'p2']);
    expect(hidden).toEqual({
      results: [
        { id: 'p1', status: 'HIDDEN' },
        { id: 'p2', status: 'HIDDEN' },
      ],
      changedCount: 2,
    });
    expect(row(memory, 'p1').hiddenAt).toBeInstanceOf(Date);
    expect(row(memory, 'p1').effectiveDatePrecision).toBe('YEAR');
    expect(memory.rows('photoFile')).toHaveLength(1);

    const shown = await service.unhide('owner', ['p1']);
    expect(shown.results).toEqual([{ id: 'p1', status: 'VISIBLE' }]);
    expect(row(memory, 'p1').hiddenAt).toBeNull();
    expect(row(memory, 'p2').hiddenAt).toBeInstanceOf(Date);
  });

  it('reports repeats and foreign or unknown IDs without touching them', async () => {
    const { memory, service } = fixture();
    await service.hide('owner', ['p1']);
    const hiddenAt = row(memory, 'p1').hiddenAt;

    const again = await service.hide('owner', ['p1', 'foreign', 'unknown']);
    expect(again.results).toEqual([
      { id: 'p1', status: 'ALREADY_HIDDEN' },
      { id: 'foreign', status: 'NOT_FOUND' },
      { id: 'unknown', status: 'NOT_FOUND' },
    ]);
    expect(again.changedCount).toBe(0);
    expect(row(memory, 'p1').hiddenAt).toBe(hiddenAt);
    expect(row(memory, 'foreign').hiddenAt).toBeNull();

    const none = await service.unhide('owner', ['p2', 'foreign']);
    expect(none.results).toEqual([
      { id: 'p2', status: 'ALREADY_VISIBLE' },
      { id: 'foreign', status: 'NOT_FOUND' },
    ]);
  });

  it('never unhides another user photo', async () => {
    const { memory, service } = fixture();
    row(memory, 'foreign').hiddenAt = new Date('2026-01-01');
    await service.unhide('owner', ['foreign']);
    expect(row(memory, 'foreign').hiddenAt).toEqual(new Date('2026-01-01'));
  });

  it('accepts large batches, counting duplicated IDs once', async () => {
    const { memory, service } = fixture(1_300);
    const ids = Array.from({ length: 1_300 }, (_, index) => `p${index + 1}`);
    const result = await service.hide('owner', [...ids, 'p1', 'p2']);
    expect(result.results).toHaveLength(1_300);
    expect(result.changedCount).toBe(1_300);
    expect(memory.rows('photo').filter((photo) => photo.hiddenAt).length).toBe(1_300);
  });

  it('isolates a failing chunk and still processes the others', async () => {
    const { memory, service } = fixture(700);
    const original = memory.photo.updateMany;
    let calls = 0;
    vi.spyOn(memory.photo, 'updateMany').mockImplementation(async (args: any) => {
      if (++calls === 1) throw new Error('temporary');
      return original(args);
    });
    const ids = Array.from({ length: 700 }, (_, index) => `p${index + 1}`);
    const result = await service.hide('owner', ids);
    expect(result.results.filter((entry) => entry.status === 'FAILED')).toHaveLength(500);
    expect(result.results.filter((entry) => entry.status === 'HIDDEN')).toHaveLength(200);
    expect(result.changedCount).toBe(200);
  });

  it.each([undefined, null, [], [''], [42], 'p1', ['x'.repeat(201)]])(
    'rejects invalid input before touching data: %j',
    async (ids) => {
      const { memory, service } = fixture();
      await expect(service.hide('owner', ids)).rejects.toMatchObject({ status: 400 });
      expect(memory.rows('photo').every((photo) => photo.hiddenAt === null)).toBe(true);
    },
  );

  it(`rejects more than ${PHOTO_BATCH_LIMIT} IDs`, async () => {
    const { service } = fixture();
    const ids = Array.from({ length: PHOTO_BATCH_LIMIT + 1 }, (_, index) => `p${index}`);
    await expect(service.hide('owner', ids)).rejects.toMatchObject({
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
      controller: new AppController(prisma, none, none, none, none, none, none, none, none) as any,
    };
  };

  it('adds the hidden filter to every timeline, count and search query', async () => {
    const { prisma, controller: app } = makeController();
    await app.years('owner');
    await app.yearSummary('owner', '2020');
    await app.months('owner', '2020');
    await app.monthPreviews('owner', '2020');
    await app.days('owner', '2020', '3');
    await app.undated('owner');
    await app.monthPhotos('owner', '2020', '3');
    await app.unknownMonthPhotos('owner', '2020');
    await app.photos('owner', '2020', undefined, undefined, 'YEAR');
    await app.indexedFolders('owner', 'source');
    await app.indexedFolderPhotos('owner', 'folder');
    await app.classificationSummary('owner', 'source');
    await app.pendingPhotos('owner', 'source');
    await app.searchSourcePhotos('owner', 'source');

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
