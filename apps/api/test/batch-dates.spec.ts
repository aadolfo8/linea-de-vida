import { describe, expect, it, vi } from 'vitest';
import { ManualDateService } from '../src/manual-date.service';
import { PHOTO_BATCH_LIMIT } from '../src/photo-ids';
import { MemoryPrisma } from './support/memory-prisma';

const photoRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'owner',
  sourceId: 'source',
  folderId: null,
  status: 'ACTIVE',
  hiddenAt: null,
  detectedDate: null,
  detectedPrecision: 'UNKNOWN',
  detectedSource: 'NONE',
  effectiveDateValue: null,
  effectiveDatePrecision: 'UNKNOWN',
  effectiveDateSource: 'NONE',
  ...extra,
});

function archive(count = 3) {
  const memory = new MemoryPrisma();
  for (let index = 1; index <= count; index++) memory.rows('photo').push(photoRow(`p${index}`));
  memory.rows('photo').push(photoRow('foreign', { userId: 'other' }));
  return { memory, service: new ManualDateService(memory as any) };
}
const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index + 1}`);
const row = (memory: MemoryPrisma, id: string) =>
  memory.rows('photo').find((photo) => photo.id === id)!;

describe('batch manual dates', () => {
  it('sets a date on a batch far above the old limit of 50, chunked, with a result per photo', async () => {
    const { memory, service } = archive(2_000);
    const spy = vi.spyOn(memory, '$transaction');

    const result = await service.setMany('owner', ids(2_000), {
      year: 2012,
      month: 7,
      precision: 'MONTH',
      reason: 'Summer trip',
    });

    expect(result.updatedCount).toBe(2_000);
    expect(result.results).toHaveLength(2_000);
    expect(result.results.every((entry) => entry.status === 'UPDATED')).toBe(true);
    expect(spy.mock.calls.length).toBe(8); // 250 photos per transaction
    expect(memory.rows('manualDateOverride')).toHaveLength(2_000);
    expect(row(memory, 'p1999')).toMatchObject({
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'MONTH',
      effectiveDateValue: new Date('2012-07-01T00:00:00.000Z'),
    });
    expect(memory.rows('manualDateOverride')[0]).toMatchObject({
      precision: 'MONTH',
      reason: 'Summer trip',
    });
  });

  it('replaces an existing manual date and supports YEAR and DAY precision', async () => {
    const { memory, service } = archive();
    await service.setMany('owner', ['p1', 'p2'], { year: 2001, precision: 'YEAR' });
    await service.setMany('owner', ['p1'], { year: 2020, month: 2, day: 29, precision: 'DAY' });
    expect(memory.rows('manualDateOverride')).toHaveLength(2);
    expect(row(memory, 'p1')).toMatchObject({
      effectiveDatePrecision: 'DAY',
      effectiveDateValue: new Date('2020-02-29T00:00:00.000Z'),
    });
    expect(row(memory, 'p2')).toMatchObject({ effectiveDatePrecision: 'YEAR' });
  });

  it('never touches photos of another user and reports them like unknown IDs', async () => {
    const { memory, service } = archive();
    const result = await service.setMany('owner', ['p1', 'foreign', 'ghost'], {
      year: 2001,
      precision: 'YEAR',
    });
    expect(result.results).toEqual([
      { id: 'p1', status: 'UPDATED' },
      { id: 'foreign', status: 'NOT_FOUND' },
      { id: 'ghost', status: 'NOT_FOUND' },
    ]);
    expect(row(memory, 'foreign').effectiveDateSource).toBe('NONE');
    expect(memory.rows('manualDateOverride').map((entry) => entry.photoId)).toEqual(['p1']);
  });

  it('applies dates to hidden photos too, so they are right when shown again', async () => {
    const { memory, service } = archive();
    row(memory, 'p1').hiddenAt = new Date();
    await service.setMany('owner', ['p1'], { year: 2001, precision: 'YEAR' });
    expect(row(memory, 'p1')).toMatchObject({ effectiveDateSource: 'MANUAL' });
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
    const { memory, service } = archive();
    await expect(service.setMany('owner', ['p1'], input as any)).rejects.toMatchObject({
      status: 400,
    });
    expect(memory.rows('manualDateOverride')).toHaveLength(0);
  });

  it('rejects an empty, malformed or oversized ID list', async () => {
    const { service } = archive();
    const date = { year: 2001, precision: 'YEAR' };
    for (const photoIds of [undefined, [], [''], [1], 'p1'])
      await expect(service.setMany('owner', photoIds, date)).rejects.toMatchObject({
        status: 400,
      });
    await expect(service.setMany('owner', ids(PHOTO_BATCH_LIMIT + 1), date)).rejects.toMatchObject({
      status: 400,
      response: { code: 'BATCH_LIMIT_EXCEEDED' },
    });
  });

  it('isolates a failing chunk', async () => {
    const { memory, service } = archive(300);
    const original = memory.manualDateOverride.createMany;
    let calls = 0;
    vi.spyOn(memory.manualDateOverride, 'createMany').mockImplementation(async (args: any) => {
      if (++calls === 1) throw new Error('temporary');
      return original(args);
    });
    const result = await service.setMany('owner', ids(300), { year: 2001, precision: 'YEAR' });
    expect(result.results.filter((entry) => entry.status === 'FAILED')).toHaveLength(250);
    expect(result.updatedCount).toBe(50);
  });
});

describe('batch clear of manual dates', () => {
  function withFolders() {
    const { memory, service } = archive(0);
    memory
      .rows('indexedFolder')
      .push(
        { id: 'root', userId: 'owner', sourceId: 'source', parentId: null },
        { id: 'child', userId: 'owner', sourceId: 'source', parentId: 'root' },
      );
    const manual = {
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'YEAR',
      effectiveDateValue: new Date('1999-01-01T00:00:00.000Z'),
    };
    const add = (id: string, folderId: string | null, extra: Record<string, unknown> = {}) => {
      memory.rows('photo').push(photoRow(id, { folderId, ...manual, ...extra }));
      memory
        .rows('manualDateOverride')
        .push({ id: `o-${id}`, photoId: id, dateValue: new Date('1999-01-01'), precision: 'YEAR' });
    };
    return { memory, service, add };
  }
  const exif = {
    detectedDate: new Date('2010-05-09T00:00:00.000Z'),
    detectedPrecision: 'DAY',
    detectedSource: 'EXIF',
  };

  it('restores each photo to its detection, folder date or nothing', async () => {
    const { memory, service, add } = withFolders();
    add('camera', null, exif);
    add('plain', null);
    add('in-fallback', 'child');
    add('in-fallback-camera', 'child', exif);
    memory.rows('folderDateRule').push({
      id: 'rule',
      folderId: 'root',
      dateValue: new Date('2005-01-01T00:00:00.000Z'),
      precision: 'YEAR',
      scope: 'FALLBACK_DESCENDANTS',
    });

    const result = await service.clearMany('owner', [
      'camera',
      'plain',
      'in-fallback',
      'in-fallback-camera',
    ]);

    expect(result.clearedCount).toBe(4);
    expect(memory.rows('manualDateOverride')).toHaveLength(0);
    expect(row(memory, 'camera')).toMatchObject({
      effectiveDateSource: 'EXIF',
      effectiveDatePrecision: 'DAY',
    });
    expect(row(memory, 'plain')).toMatchObject({
      effectiveDateSource: 'NONE',
      effectiveDatePrecision: 'UNKNOWN',
      effectiveDateValue: null,
    });
    expect(row(memory, 'in-fallback')).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDateValue: new Date('2005-01-01T00:00:00.000Z'),
    });
    // A fallback folder date never replaces camera evidence.
    expect(row(memory, 'in-fallback-camera')).toMatchObject({ effectiveDateSource: 'EXIF' });
  });

  it('lets an overriding folder date win over camera dates once the manual date is gone', async () => {
    const { memory, service, add } = withFolders();
    add('camera', 'child', exif);
    memory.rows('folderDateRule').push({
      id: 'rule',
      folderId: 'root',
      dateValue: new Date('2005-06-07T00:00:00.000Z'),
      precision: 'DAY',
      scope: 'ALL_DESCENDANTS',
    });
    await service.clearMany('owner', ['camera']);
    expect(row(memory, 'camera')).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('reports photos without a manual date, foreign photos and unknown IDs', async () => {
    const { memory, service, add } = withFolders();
    add('manual', null);
    memory.rows('photo').push(photoRow('automatic'), photoRow('foreign', { userId: 'other' }));
    const result = await service.clearMany('owner', ['manual', 'automatic', 'foreign', 'ghost']);
    expect(result.results).toEqual([
      { id: 'manual', status: 'CLEARED' },
      { id: 'automatic', status: 'NO_MANUAL_DATE' },
      { id: 'foreign', status: 'NOT_FOUND' },
      { id: 'ghost', status: 'NOT_FOUND' },
    ]);
    expect(result.clearedCount).toBe(1);
    expect(row(memory, 'foreign').effectiveDateSource).toBe('NONE');
  });

  it('clears more photos than a single transaction handles', async () => {
    const { memory, service, add } = withFolders();
    for (let index = 0; index < 600; index++) add(`m${index}`, null);
    const result = await service.clearMany(
      'owner',
      Array.from({ length: 600 }, (_, index) => `m${index}`),
    );
    expect(result.clearedCount).toBe(600);
    expect(memory.rows('manualDateOverride')).toHaveLength(0);
    expect(memory.rows('photo').every((photo) => photo.effectiveDateSource === 'NONE')).toBe(true);
  });
});
