import { describe, expect, it } from 'vitest';
import { OrderingService, originKind } from '../src/ordering.service';
import { MemoryPrisma } from './support/memory-prisma';

type PhotoSeed = {
  id: string;
  folderId?: string | null;
  fileName?: string;
  date?: string | null;
  precision?: 'YEAR' | 'MONTH' | 'DAY';
  origin?: string;
  hidden?: boolean;
  userId?: string;
  sourceId?: string;
  detectedSource?: string;
  override?: boolean;
};

function archive() {
  const memory = new MemoryPrisma();
  memory
    .rows('photoSource')
    .push(
      { id: 'source', userId: 'owner' },
      { id: 'source-2', userId: 'owner' },
      { id: 'foreign-source', userId: 'other' },
    );
  // Family
  // ├── 2001
  // │   └── Trip
  // └── Phone
  const folder = (id: string, name: string, parentId: string | null, path: string[], extra = {}) =>
    memory.rows('indexedFolder').push({
      id,
      userId: 'owner',
      sourceId: 'source',
      name,
      parentId,
      path,
      status: 'ACTIVE',
      ...extra,
    });
  folder('family', 'Family', null, ['Family']);
  folder('y2001', '2001', 'family', ['Family', '2001'], { ownRule: true });
  folder('trip', 'Trip', 'y2001', ['Family', '2001', 'Trip']);
  folder('phone', 'Phone', 'family', ['Family', 'Phone']);
  folder('other-source-folder', 'Elsewhere', null, ['Elsewhere'], { sourceId: 'source-2' });
  memory.rows('indexedFolder').push({
    id: 'foreign-folder',
    userId: 'other',
    sourceId: 'foreign-source',
    name: 'Mine',
    parentId: null,
    path: ['Mine'],
    status: 'ACTIVE',
  });
  const photo = (seed: PhotoSeed) => {
    const date = seed.date === undefined ? null : seed.date;
    memory.rows('photo').push({
      id: seed.id,
      userId: seed.userId ?? 'owner',
      sourceId: seed.sourceId ?? 'source',
      folderId: seed.folderId === undefined ? null : seed.folderId,
      fileName: seed.fileName ?? `${seed.id}.jpg`,
      status: 'ACTIVE',
      hiddenAt: seed.hidden ? new Date('2026-01-01') : null,
      imageMetadata: null,
      detectedSource: seed.detectedSource ?? 'NONE',
      detectedDate: null,
      detectedPrecision: 'UNKNOWN',
      effectiveDateValue: date ? new Date(date) : null,
      effectiveDatePrecision: date ? (seed.precision ?? 'DAY') : 'UNKNOWN',
      effectiveDateSource: date ? (seed.origin ?? 'EXIF') : 'NONE',
    });
    if (seed.override)
      memory.rows('manualDateOverride').push({ id: `o-${seed.id}`, photoId: seed.id });
  };
  photo({ id: 'u1', folderId: 'phone', fileName: 'a.jpg' });
  photo({ id: 'u2', folderId: 'phone', fileName: 'b.jpg' });
  photo({ id: 'u3', folderId: 'trip', fileName: 'c.jpg' });
  photo({ id: 'u4', folderId: null, fileName: 'd.jpg' });
  photo({ id: 'y1', folderId: 'y2001', date: '2001-01-01', precision: 'YEAR', origin: 'FOLDER' });
  photo({
    id: 'y2',
    folderId: 'trip',
    date: '2001-01-01',
    precision: 'YEAR',
    origin: 'FOLDER_RULE',
  });
  photo({ id: 'd1', folderId: 'trip', date: '2001-07-04', precision: 'DAY', origin: 'EXIF' });
  photo({ id: 'd2', folderId: 'phone', date: '2019-08-12', precision: 'DAY', origin: 'FILENAME' });
  photo({ id: 'm1', folderId: 'phone', date: '2019-03-01', precision: 'MONTH', origin: 'MANUAL' });
  photo({ id: 'h1', folderId: 'trip', hidden: true });
  photo({ id: 'h2', folderId: 'phone', date: '2020-02-02', hidden: true });
  photo({ id: 'e1', folderId: 'other-source-folder', sourceId: 'source-2', fileName: 'e.jpg' });
  photo({ id: 'x1', folderId: 'foreign-folder', userId: 'other', sourceId: 'foreign-source' });
  memory.rows('photo').push({
    ...memory.rows('photo')[0],
    id: 'missing',
    status: 'MISSING',
    fileName: 'missing.jpg',
  });
  return { memory, service: new OrderingService(memory as any) };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe('OrderingService.piles', () => {
  it('counts the four piles for the whole archive, ignoring other users and missing photos', async () => {
    const { service } = archive();
    expect(await service.piles('owner', {})).toEqual({
      undated: 5,
      yearOnly: 2,
      dated: 3,
      hidden: 2,
      total: 10,
    });
  });

  it('filters by source', async () => {
    const { service } = archive();
    expect(await service.piles('owner', { sourceId: 'source-2' })).toMatchObject({
      undated: 1,
      yearOnly: 0,
      dated: 0,
      hidden: 0,
    });
  });

  it('filters by folder, with or without subfolders', async () => {
    const { service } = archive();
    expect(await service.piles('owner', { folderId: 'y2001' })).toEqual({
      undated: 1, // u3 in Trip
      yearOnly: 2,
      dated: 1,
      hidden: 1,
      total: 4,
    });
    expect(await service.piles('owner', { folderId: 'y2001', includeSubfolders: false })).toEqual({
      undated: 0,
      yearOnly: 1,
      dated: 0,
      hidden: 0,
      total: 1,
    });
  });

  it('refuses sources and folders of another user', async () => {
    const { service } = archive();
    await expect(service.piles('owner', { sourceId: 'foreign-source' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.piles('owner', { folderId: 'foreign-folder' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.piles('owner', { sourceId: 'source-2', folderId: 'phone' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('OrderingService.folderTree', () => {
  it('nests folders with own and subtree counts of photos and photos still to date', async () => {
    const { service } = archive();
    const tree = await service.folderTree('owner', 'source');

    expect(tree.items.map((node) => node.name)).toEqual(['Family']);
    const family = tree.items[0]!;
    expect(family.children.map((node) => node.name)).toEqual(['2001', 'Phone']);
    const [y2001, phone] = family.children;
    const trip = y2001!.children[0]!;

    expect(trip).toMatchObject({
      id: 'trip',
      depth: 2,
      path: ['Family', '2001', 'Trip'],
      photoCount: 3, // u3, y2, d1 (h1 is hidden)
      toDateCount: 2, // u3 undated + y2 year-only
      subtreePhotoCount: 3,
      subtreeToDateCount: 2,
    });
    expect(y2001).toMatchObject({
      photoCount: 1,
      toDateCount: 1,
      subtreePhotoCount: 4,
      subtreeToDateCount: 3,
    });
    expect(phone).toMatchObject({
      photoCount: 4, // u1, u2, d2, m1 (h2 hidden)
      toDateCount: 2,
      subtreePhotoCount: 4,
      subtreeToDateCount: 2,
    });
    expect(family).toMatchObject({
      photoCount: 0,
      subtreePhotoCount: 8,
      subtreeToDateCount: 5,
      depth: 0,
    });
    expect(tree.unfiled).toEqual({ photoCount: 1, toDateCount: 1 });
    expect(tree.totals).toEqual({ photoCount: 9, toDateCount: 6 });
    expect(tree.folderCount).toBe(4);
  });

  it('exposes the folder date rule as the two simple choices', async () => {
    const { service, memory } = archive();
    memory.rows('folderDateRule').push({
      id: 'rule',
      folderId: 'phone',
      dateValue: new Date('2019-08-12'),
      precision: 'DAY',
      scope: 'DIRECT_OVERRIDE',
    });
    const tree = await service.folderTree('owner', 'source');
    const phone = tree.items[0]!.children[1]!;
    expect(phone.dateRule).toMatchObject({
      precision: 'DAY',
      scope: 'DIRECT_OVERRIDE',
      includeSubfolders: false,
      overrideCameraDates: true,
    });
    expect(tree.items[0]!.children[0]!.dateRule).toBeNull();
  });

  it('shows an orphaned folder as a root instead of dropping it', async () => {
    const { service, memory } = archive();
    memory.rows('indexedFolder').find((folder) => folder.id === 'trip')!.parentId = 'gone';
    const tree = await service.folderTree('owner', 'source');
    expect(tree.items.map((node) => node.name)).toEqual(['Family', 'Trip']);
  });

  it('survives a parent cycle', async () => {
    const { service, memory } = archive();
    memory.rows('indexedFolder').find((folder) => folder.id === 'family')!.parentId = 'trip';
    const tree = await service.folderTree('owner', 'source');
    expect(tree.folderCount).toBe(4);
    expect(tree.items.length).toBeGreaterThan(0);
  });

  it('refuses a source of another user', async () => {
    const { service } = archive();
    await expect(service.folderTree('owner', 'foreign-source')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('builds a tree of thousands of folders from a handful of queries', async () => {
    const { service, memory } = archive();
    memory.rows('indexedFolder').length = 0;
    memory.rows('photo').length = 0;
    for (let index = 0; index < 4_000; index++)
      memory.rows('indexedFolder').push({
        id: `f${index}`,
        userId: 'owner',
        sourceId: 'source',
        name: `Folder ${index}`,
        parentId: index === 0 ? null : `f${Math.floor((index - 1) / 5)}`,
        path: [`Folder ${index}`],
        status: 'ACTIVE',
      });
    const calls: string[] = [];
    for (const name of ['findMany', 'groupBy', 'count'] as const) {
      const original = (memory.photo as any)[name];
      (memory.photo as any)[name] = (...args: unknown[]) => (calls.push(name), original(...args));
    }
    const tree = await service.folderTree('owner', 'source');
    expect(tree.folderCount).toBe(4_000);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

describe('OrderingService.folder', () => {
  it('returns the breadcrumb root-first with counts and child folders', async () => {
    const { service } = archive();
    const folder = await service.folder('owner', 'trip');
    expect(folder.breadcrumb).toEqual([
      { id: 'family', name: 'Family' },
      { id: 'y2001', name: '2001' },
      { id: 'trip', name: 'Trip' },
    ]);
    expect(folder).toMatchObject({ sourceId: 'source', photoCount: 3, toDateCount: 2 });
    const parent = await service.folder('owner', 'y2001');
    expect(parent.childFolders).toEqual([
      { id: 'trip', name: 'Trip', subtreePhotoCount: 3, subtreeToDateCount: 2 },
    ]);
  });

  it('refuses a folder of another user', async () => {
    const { service } = archive();
    await expect(service.folder('owner', 'foreign-folder')).rejects.toMatchObject({ status: 404 });
  });
});

describe('OrderingService.photos', () => {
  it('lists each pile with date, precision, origin and hidden flag', async () => {
    const { service } = archive();
    const dated = await service.photos('owner', { pile: 'dated' });
    expect(ids(dated.items)).toEqual(['d2', 'm1', 'd1']);
    expect(dated.items[0]).toEqual({
      id: 'd2',
      fileName: 'd2.jpg',
      thumbnailUrl: '/v1/photos/d2/thumbnail',
      effectiveDate: {
        value: new Date('2019-08-12'),
        precision: 'DAY',
        origin: 'FILENAME',
        originKind: 'filename',
      },
      hidden: false,
      folderId: 'phone',
    });
    expect(dated.items[1]!.effectiveDate.originKind).toBe('manual');

    const year = await service.photos('owner', { pile: 'yearOnly' });
    expect(ids(year.items).sort()).toEqual(['y1', 'y2']);
    expect(year.items.map((item) => item.effectiveDate.originKind).sort()).toEqual([
      'folder',
      'folder',
    ]);

    const undated = await service.photos('owner', { pile: 'undated' });
    expect(ids(undated.items)).toEqual(['u1', 'u2', 'u3', 'u4', 'e1']);

    const hidden = await service.photos('owner', { pile: 'hidden', order: 'newest' });
    expect(ids(hidden.items)).toEqual(['h2', 'h1']);
    expect(hidden.items.every((item) => item.hidden)).toBe(true);
  });

  it('orders by name or newest first, and filters by source and folder subtree', async () => {
    const { service, memory } = archive();
    memory.rows('photo').find((photo) => photo.id === 'u1')!.fileName = 'z.jpg';
    const byName = await service.photos('owner', {
      pile: 'undated',
      order: 'name',
      folderId: 'family',
    });
    expect(byName.items.map((item) => item.fileName)).toEqual(['b.jpg', 'c.jpg', 'z.jpg']);
    const onlyTrip = await service.photos('owner', {
      pile: 'undated',
      folderId: 'trip',
      includeSubfolders: false,
    });
    expect(ids(onlyTrip.items)).toEqual(['u3']);
    const source2 = await service.photos('owner', { pile: 'undated', sourceId: 'source-2' });
    expect(ids(source2.items)).toEqual(['e1']);
    const newest = await service.photos('owner', { pile: 'dated', folderId: 'y2001' });
    expect(ids(newest.items)).toEqual(['d1']);
  });

  it('paginates with a stable cursor and never repeats or skips a photo', async () => {
    const { service, memory } = archive();
    for (let index = 0; index < 25; index++)
      memory.rows('photo').push({
        ...memory.rows('photo').find((photo) => photo.id === 'd1')!,
        id: `bulk-${String(index).padStart(2, '0')}`,
        // Many photos share a date: the id breaks ties.
        effectiveDateValue: new Date(index % 3 === 0 ? '2010-05-05' : '2010-05-06'),
        fileName: `bulk-${index % 7}.jpg`,
      });
    for (const order of ['newest', 'name'] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await service.photos('owner', { pile: 'dated', order, limit: '7', cursor });
        seen.push(...ids(page.items));
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect(pages).toBe(Math.ceil(28 / 7));
      expect(new Set(seen).size).toBe(28);
    }
  });

  it('keeps the newest-first cursor correct across the dated/undated boundary of the hidden pile', async () => {
    const { service } = archive();
    const first = await service.photos('owner', { pile: 'hidden', order: 'newest', limit: '1' });
    expect(ids(first.items)).toEqual(['h2']);
    const second = await service.photos('owner', {
      pile: 'hidden',
      order: 'newest',
      limit: '1',
      cursor: first.nextCursor!,
    });
    expect(ids(second.items)).toEqual(['h1']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an invalid pile, order and a cursor from another listing', async () => {
    const { service } = archive();
    await expect(service.photos('owner', { pile: 'all' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_PILE' },
    });
    await expect(service.photos('owner', {})).rejects.toMatchObject({ status: 400 });
    await expect(service.photos('owner', { pile: 'dated', order: 'random' })).rejects.toMatchObject(
      {
        status: 400,
      },
    );
    const page = await service.photos('owner', { pile: 'undated', limit: '1' });
    await expect(
      service.photos('owner', { pile: 'dated', cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_CURSOR' } });
    await expect(
      service.photos('owner', { pile: 'dated', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('never returns photos of another user', async () => {
    const { service } = archive();
    const everything = await Promise.all(
      (['undated', 'yearOnly', 'dated', 'hidden'] as const).map((pile) =>
        service.photos('owner', { pile, limit: '200' }),
      ),
    );
    expect(everything.flatMap((page) => ids(page.items))).not.toContain('x1');
  });
});

describe('originKind', () => {
  it.each([
    ['EXIF', 'camera'],
    ['DRIVE_IMAGE_METADATA', 'camera'],
    ['TAKEOUT', 'google'],
    ['FILENAME', 'filename'],
    ['FOLDER', 'folder'],
    ['FOLDER_RULE', 'folder'],
    ['MANUAL', 'manual'],
    ['NONE', 'none'],
  ] as const)('%s -> %s', (source, kind) => expect(originKind(source)).toBe(kind));
});

describe('OrderingService filename suggestions', () => {
  function withNames() {
    const { memory, service } = archive();
    const rename = (id: string, fileName: string, extra: Record<string, unknown> = {}) =>
      Object.assign(
        memory.rows('photo').find((photo) => photo.id === id)!,
        { fileName, ...extra },
      );
    rename('u1', 'IMG-20190812-WA0001.jpg');
    rename('u2', 'IMG-20190813-WA0002.jpg');
    rename('u3', 'PXL_20200101_101010101.jpg');
    rename('u4', 'Screenshot_2018-03-04-10-11-12.png');
    // Year-only from a folder name: the file name is stronger evidence.
    rename('y1', 'IMG_20010704_101010.jpg', { detectedSource: 'FOLDER' });
    // Already dated by the camera, manual, or hidden: not suggestions.
    rename('d1', 'IMG-20190812-WA0099.jpg');
    rename('m1', 'IMG-20190812-WA0100.jpg');
    rename('h1', 'IMG-20190812-WA0101.jpg');
    // Undated but with an override (e.g. a manual year): the user's choice stands.
    rename('y2', 'IMG-20190812-WA0102.jpg', { detectedSource: 'FOLDER' });
    memory.rows('manualDateOverride').push({ id: 'o', photoId: 'y2' });
    // The name carries no date.
    rename('e1', 'IMG_1234.jpg');
    return { memory, service };
  }

  it('groups photos still to date by the kind of name, with counts, range and examples', async () => {
    const { service } = withNames();
    const result = await service.filenameSuggestions('owner', {});
    expect(result.totalCount).toBe(5);
    expect(result.groups).toEqual([
      {
        kind: 'whatsapp',
        photoCount: 2,
        earliest: new Date('2019-08-12'),
        latest: new Date('2019-08-13'),
        examples: [
          { id: 'u1', fileName: 'IMG-20190812-WA0001.jpg', date: new Date('2019-08-12') },
          { id: 'u2', fileName: 'IMG-20190813-WA0002.jpg', date: new Date('2019-08-13') },
        ],
      },
      expect.objectContaining({ kind: 'android-camera', photoCount: 1 }),
      expect.objectContaining({ kind: 'pixel', photoCount: 1 }),
      expect.objectContaining({ kind: 'screenshot', photoCount: 1 }),
    ]);
  });

  it('respects the source and folder filters', async () => {
    const { service } = withNames();
    expect((await service.filenameSuggestions('owner', { folderId: 'phone' })).totalCount).toBe(2);
    expect(
      (await service.filenameSuggestions('owner', { folderId: 'family', includeSubfolders: false }))
        .totalCount,
    ).toBe(0);
    expect((await service.filenameSuggestions('owner', { sourceId: 'source-2' })).totalCount).toBe(
      0,
    );
  });

  it('does not suggest what an overriding folder date would win over anyway', async () => {
    const { service, memory } = withNames();
    memory.rows('folderDateRule').push({
      id: 'rule',
      folderId: 'phone',
      dateValue: new Date('2005-01-01'),
      precision: 'YEAR',
      scope: 'ALL_DESCENDANTS',
    });
    const result = await service.filenameSuggestions('owner', {});
    expect(result.totalCount).toBe(3); // u1 and u2 live in Phone
    const fallback = memory.rows('folderDateRule')[0]!;
    fallback.scope = 'FALLBACK_DESCENDANTS';
    expect((await service.filenameSuggestions('owner', {})).totalCount).toBe(5);
  });

  it('accepts suggestions as detected dates, not manual ones', async () => {
    const { service, memory } = withNames();
    const result = await service.acceptFilenameSuggestions('owner', {});
    expect(result).toEqual({ appliedCount: 5 });
    const u1 = memory.rows('photo').find((photo) => photo.id === 'u1')!;
    expect(u1).toMatchObject({
      detectedSource: 'FILENAME',
      detectedPrecision: 'DAY',
      detectedDate: new Date('2019-08-12'),
      effectiveDateSource: 'FILENAME',
      effectiveDatePrecision: 'DAY',
      effectiveDateValue: new Date('2019-08-12'),
    });
    expect(memory.rows('manualDateOverride')).toHaveLength(1);
    const y1 = memory.rows('photo').find((photo) => photo.id === 'y1')!;
    expect(y1).toMatchObject({
      effectiveDateValue: new Date('2001-07-04'),
      detectedSource: 'FILENAME',
    });
    // Untouched: camera-dated, hidden, overridden, no date in the name.
    for (const id of ['d1', 'm1', 'h1', 'y2', 'e1'])
      expect(memory.rows('photo').find((photo) => photo.id === id)!.detectedSource).not.toBe(
        'FILENAME',
      );
    // Nothing is left to suggest, and a second accept is a no-op.
    expect((await service.filenameSuggestions('owner', {})).totalCount).toBe(0);
    expect(await service.acceptFilenameSuggestions('owner', {})).toEqual({ appliedCount: 0 });
  });

  it('accepts only the chosen kinds and photos', async () => {
    const { service, memory } = withNames();
    expect(await service.acceptFilenameSuggestions('owner', { kinds: ['whatsapp'] })).toEqual({
      appliedCount: 2,
    });
    expect(
      await service.acceptFilenameSuggestions('owner', { photoIds: ['u3', 'u4', 'e1', 'ghost'] }),
    ).toEqual({ appliedCount: 2 });
    expect(memory.rows('photo').find((photo) => photo.id === 'y1')!.detectedSource).toBe('FOLDER');
  });

  it('validates the input and never touches another user', async () => {
    const { service, memory } = withNames();
    await expect(
      service.acceptFilenameSuggestions('owner', { kinds: ['nonsense'] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.acceptFilenameSuggestions('owner', { kinds: 'whatsapp' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      service.acceptFilenameSuggestions('owner', { photoIds: [] }),
    ).rejects.toMatchObject({
      status: 400,
    });
    memory.rows('photo').find((photo) => photo.id === 'x1')!.fileName = 'IMG-20190812-WA0500.jpg';
    await service.acceptFilenameSuggestions('owner', { photoIds: ['x1'] });
    expect(memory.rows('photo').find((photo) => photo.id === 'x1')!.detectedSource).toBe('NONE');
    await expect(
      service.filenameSuggestions('owner', { sourceId: 'foreign-source' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
