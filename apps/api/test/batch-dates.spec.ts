/**
 * Batch manual dates against a real PostgreSQL (TEST_DATABASE_URL, migrations applied): the same
 * behaviour the in-memory double used to assert, now through the real queries and constraints.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ManualDateService } from '../src/manual-date.service';
import { PHOTO_BATCH_LIMIT } from '../src/photo-ids';

const url = process.env.TEST_DATABASE_URL;
const OWNER = 'bd-owner';
const OTHER = 'bd-other';

describe.skipIf(!url)('batch manual dates (PostgreSQL)', () => {
  const prisma = url
    ? new PrismaClient({ datasources: { db: { url } } })
    : (undefined as unknown as PrismaClient);
  const service = new ManualDateService(prisma as any);
  /** A service whose transactions can be counted or made to fail, without patching the client. */
  const serviceWith = (onTransaction: (call: number) => void) => {
    let calls = 0;
    const wrapped = new Proxy(prisma, {
      get: (target, key) =>
        key === '$transaction'
          ? (...args: unknown[]) => {
              onTransaction(++calls);
              return (target.$transaction as (...a: unknown[]) => unknown)(...args);
            }
          : (target as any)[key],
    });
    return { service: new ManualDateService(wrapped as any), calls: () => calls };
  };

  const photoData = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    userId: OWNER,
    contentKey: `md5:${id}`,
    driveFileId: `d-${id}`,
    sourceId: 'bd-source',
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    ...extra,
  });
  const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index + 1}`);
  const photo = (id: string) => prisma.photo.findUniqueOrThrow({ where: { id } });
  const overrides = () =>
    prisma.manualDateOverride.findMany({ where: { photo: { userId: OWNER } } });

  const seed = async (count = 3) => {
    await prisma.photo.createMany({ data: ids(count).map((id) => photoData(id)) });
    await prisma.photo.create({
      data: photoData('foreign', { userId: OTHER, driveFileId: 'd-foreign' }),
    });
  };

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    for (const id of [OWNER, OTHER])
      await prisma.user.create({ data: { id, email: `${id}@example.test`, displayName: id } });
    const connection = await prisma.oAuthConnection.create({
      data: { userId: OWNER, provider: 'google', googleAccountId: 'bd', grantedScopes: [] },
    });
    await prisma.photoSource.create({
      data: {
        id: 'bd-source',
        userId: OWNER,
        oauthConnectionId: connection.id,
        driveFolderId: 'root',
        name: 'Archive',
        type: 'GENERIC',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    await prisma.$disconnect();
  });

  describe('set', () => {
    it('sets a date on a batch far above the old limit of 50, chunked, with a result per photo', async () => {
      await seed(2_000);
      const counted = serviceWith(() => undefined);
      const result = await counted.service.setMany(OWNER, ids(2_000), {
        year: 2012,
        month: 7,
        precision: 'MONTH',
        reason: 'Summer trip',
      });

      expect(result.updatedCount).toBe(2_000);
      expect(result.results).toHaveLength(2_000);
      expect(result.results.every((entry) => entry.status === 'UPDATED')).toBe(true);
      expect(counted.calls()).toBe(8); // 250 photos per transaction
      expect(await overrides()).toHaveLength(2_000);
      expect(await photo('p1999')).toMatchObject({
        effectiveDateSource: 'MANUAL',
        effectiveDatePrecision: 'MONTH',
        effectiveDateValue: new Date('2012-07-01T00:00:00.000Z'),
      });
      expect((await overrides())[0]).toMatchObject({ precision: 'MONTH', reason: 'Summer trip' });
    }, 60_000);

    it('replaces an existing manual date and supports YEAR and DAY precision', async () => {
      await seed();
      await service.setMany(OWNER, ['p1', 'p2'], { year: 2001, precision: 'YEAR' });
      await service.setMany(OWNER, ['p1'], { year: 2020, month: 2, day: 29, precision: 'DAY' });
      expect(await overrides()).toHaveLength(2);
      expect(await photo('p1')).toMatchObject({
        effectiveDatePrecision: 'DAY',
        effectiveDateValue: new Date('2020-02-29T00:00:00.000Z'),
      });
      expect(await photo('p2')).toMatchObject({ effectiveDatePrecision: 'YEAR' });
    });

    it('never touches photos of another user and reports them like unknown IDs', async () => {
      await seed();
      const result = await service.setMany(OWNER, ['p1', 'foreign', 'ghost'], {
        year: 2001,
        precision: 'YEAR',
      });
      expect(result.results).toEqual([
        { id: 'p1', status: 'UPDATED' },
        { id: 'foreign', status: 'NOT_FOUND' },
        { id: 'ghost', status: 'NOT_FOUND' },
      ]);
      expect((await photo('foreign')).effectiveDateSource).toBe('NONE');
      expect((await overrides()).map((entry) => entry.photoId)).toEqual(['p1']);
    });

    it('applies dates to hidden photos too, so they are right when shown again', async () => {
      await seed();
      await prisma.photo.update({ where: { id: 'p1' }, data: { hiddenAt: new Date() } });
      await service.setMany(OWNER, ['p1'], { year: 2001, precision: 'YEAR' });
      expect(await photo('p1')).toMatchObject({ effectiveDateSource: 'MANUAL' });
    });

    it.each([
      [{ year: 1899, precision: 'YEAR' }],
      [{ year: 2101, precision: 'YEAR' }],
      [{ year: 2020, month: 13, precision: 'MONTH' }],
      [{ year: 2021, month: 2, day: 29, precision: 'DAY' }],
      [{ year: 2020, month: 4, day: 31, precision: 'DAY' }],
      [{ year: 2020, month: 5, precision: 'YEAR' }],
      [{ year: 2020, precision: 'MONTH' }],
      [{ year: 2020, month: 5, precision: 'DAY' }],
      [{ year: 2020, precision: 'WEEK' }],
      [{ year: 'x', precision: 'YEAR' }],
    ])('rejects the invalid date %j before changing anything', async (input) => {
      await seed();
      await expect(service.setMany(OWNER, ['p1'], input as any)).rejects.toMatchObject({
        status: 400,
      });
      expect(await overrides()).toHaveLength(0);
    });

    it('rejects an empty, malformed or oversized ID list', async () => {
      const date = { year: 2001, precision: 'YEAR' };
      for (const photoIds of [undefined, [], [''], [1], 'p1'])
        await expect(service.setMany(OWNER, photoIds, date)).rejects.toMatchObject({ status: 400 });
      await expect(service.setMany(OWNER, ids(PHOTO_BATCH_LIMIT + 1), date)).rejects.toMatchObject({
        status: 400,
        response: { code: 'BATCH_LIMIT_EXCEEDED' },
      });
    });

    it('isolates a failing chunk', async () => {
      await seed(300);
      const failing = serviceWith((call) => {
        if (call === 1) throw new Error('temporary');
      });
      const result = await failing.service.setMany(OWNER, ids(300), {
        year: 2001,
        precision: 'YEAR',
      });
      expect(result.results.filter((entry) => entry.status === 'FAILED')).toHaveLength(250);
      expect(result.updatedCount).toBe(50);
    });
  });

  describe('clear', () => {
    const manual = {
      effectiveDateSource: 'MANUAL' as const,
      effectiveDatePrecision: 'YEAR' as const,
      effectiveDateValue: new Date('1999-01-01T00:00:00.000Z'),
    };
    const exif = {
      detectedDate: new Date('2010-05-09T00:00:00.000Z'),
      detectedPrecision: 'DAY' as const,
      detectedSource: 'EXIF' as const,
    };
    const folders = async () => {
      await prisma.indexedFolder.create({
        data: {
          id: 'bd-root',
          userId: OWNER,
          sourceId: 'bd-source',
          driveFolderId: 'fr',
          name: 'root',
          path: ['root'],
        },
      });
      await prisma.indexedFolder.create({
        data: {
          id: 'bd-child',
          userId: OWNER,
          sourceId: 'bd-source',
          driveFolderId: 'fc',
          parentId: 'bd-root',
          name: 'child',
          path: ['root', 'child'],
        },
      });
    };
    const addManual = async (id: string, folderId: string | null, extra = {}) => {
      await prisma.photo.create({ data: { ...photoData(id), folderId, ...manual, ...extra } });
      await prisma.manualDateOverride.create({
        data: { photoId: id, dateValue: new Date('1999-01-01'), precision: 'YEAR' },
      });
    };

    it('restores each photo to its detection, folder date or nothing', async () => {
      await folders();
      await addManual('camera', null, exif);
      await addManual('plain', null);
      await addManual('in-fallback', 'bd-child');
      await addManual('in-fallback-camera', 'bd-child', exif);
      await prisma.folderDateRule.create({
        data: {
          folderId: 'bd-root',
          dateValue: new Date('2005-01-01T00:00:00.000Z'),
          precision: 'YEAR',
          scope: 'FALLBACK_DESCENDANTS',
        },
      });

      const result = await service.clearMany(OWNER, [
        'camera',
        'plain',
        'in-fallback',
        'in-fallback-camera',
      ]);

      expect(result.clearedCount).toBe(4);
      expect(await overrides()).toHaveLength(0);
      expect(await photo('camera')).toMatchObject({
        effectiveDateSource: 'EXIF',
        effectiveDatePrecision: 'DAY',
      });
      expect(await photo('plain')).toMatchObject({
        effectiveDateSource: 'NONE',
        effectiveDatePrecision: 'UNKNOWN',
        effectiveDateValue: null,
      });
      expect(await photo('in-fallback')).toMatchObject({
        effectiveDateSource: 'FOLDER_RULE',
        effectiveDateValue: new Date('2005-01-01T00:00:00.000Z'),
      });
      // A fallback folder date never replaces camera evidence.
      expect(await photo('in-fallback-camera')).toMatchObject({ effectiveDateSource: 'EXIF' });
    });

    it('lets an overriding folder date win over camera dates once the manual date is gone', async () => {
      await folders();
      await addManual('camera', 'bd-child', exif);
      await prisma.folderDateRule.create({
        data: {
          folderId: 'bd-root',
          dateValue: new Date('2005-06-07T00:00:00.000Z'),
          precision: 'DAY',
          scope: 'ALL_DESCENDANTS',
        },
      });
      await service.clearMany(OWNER, ['camera']);
      expect(await photo('camera')).toMatchObject({
        effectiveDateSource: 'FOLDER_RULE',
        effectiveDatePrecision: 'DAY',
      });
    });

    it('reports photos without a manual date, foreign photos and unknown IDs', async () => {
      await addManual('manual', null);
      await prisma.photo.create({ data: photoData('automatic') });
      await prisma.photo.create({
        data: photoData('foreign', { userId: OTHER, driveFileId: 'd-foreign' }),
      });
      const result = await service.clearMany(OWNER, ['manual', 'automatic', 'foreign', 'ghost']);
      expect(result.results).toEqual([
        { id: 'manual', status: 'CLEARED' },
        { id: 'automatic', status: 'NO_MANUAL_DATE' },
        { id: 'foreign', status: 'NOT_FOUND' },
        { id: 'ghost', status: 'NOT_FOUND' },
      ]);
      expect(result.clearedCount).toBe(1);
      expect((await photo('foreign')).effectiveDateSource).toBe('NONE');
    });

    it('clears more photos than a single transaction handles', async () => {
      const names = Array.from({ length: 600 }, (_, index) => `m${index}`);
      await prisma.photo.createMany({
        data: names.map((id) => ({ ...photoData(id), ...manual })),
      });
      await prisma.manualDateOverride.createMany({
        data: names.map((photoId) => ({
          photoId,
          dateValue: new Date('1999-01-01'),
          precision: 'YEAR' as const,
        })),
      });
      const result = await service.clearMany(OWNER, names);
      expect(result.clearedCount).toBe(600);
      expect(await overrides()).toHaveLength(0);
      const left = await prisma.photo.count({
        where: { userId: OWNER, effectiveDateSource: { not: 'NONE' } },
      });
      expect(left).toBe(0);
    }, 60_000);
  });
});
