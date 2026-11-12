import { afterAll, describe, expect, it } from 'vitest';
import { OrderingService, originKind } from '../src/ordering.service';
import { dropUsers, pgClient, pgUrl, photoRow, resetUsers } from './support/pg';

const P = 'os';
const OWNER = `${P}-owner`;
const OTHER = `${P}-other`;
const prisma = pgClient();

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
  status?: string;
};

/** Counts the photo queries a callback makes, by wrapping the client instead of patching it. */
function observed(record: (name: string, args: unknown) => void) {
  return new Proxy(prisma, {
    get: (target, key) =>
      key === 'photo'
        ? new Proxy(target.photo, {
            get: (photo, method) =>
              typeof (photo as any)[method] === 'function'
                ? (...args: unknown[]) => {
                    record(String(method), args[0]);
                    return (photo as any)[method](...args);
                  }
                : (photo as any)[method],
          })
        : (target as any)[key],
  });
}

const row = (id: string) => prisma.photo.findUniqueOrThrow({ where: { id } });
const rule = (folderId: string, scope: string, dateValue: string, precision: string) =>
  prisma.folderDateRule.create({
    data: {
      folderId,
      dateValue: new Date(dateValue),
      precision: precision as any,
      scope: scope as any,
    },
  });

async function archive() {
  await resetUsers(prisma, P);
  const connection = await prisma.oAuthConnection.findFirstOrThrow({ where: { userId: OWNER } });
  for (const [id, userId] of [
    ['source', OWNER],
    ['source-2', OWNER],
    ['foreign-source', OTHER],
  ] as const)
    await prisma.photoSource.create({
      data: {
        id,
        userId,
        oauthConnectionId: connection.id,
        driveFolderId: `drive-${id}`,
        name: id,
        type: 'GENERIC',
      },
    });
  // Family
  // ├── 2001
  // │   └── Trip
  // └── Phone
  const folder = (
    id: string,
    name: string,
    parentId: string | null,
    path: string[],
    sourceId = 'source',
    userId = OWNER,
  ) =>
    prisma.indexedFolder.create({
      data: { id, userId, sourceId, name, parentId, path, driveFolderId: `drive-${id}` },
    });
  await folder('family', 'Family', null, ['Family']);
  await folder('y2001', '2001', 'family', ['Family', '2001']);
  await folder('trip', 'Trip', 'y2001', ['Family', '2001', 'Trip']);
  await folder('phone', 'Phone', 'family', ['Family', 'Phone']);
  await folder('other-source-folder', 'Elsewhere', null, ['Elsewhere'], 'source-2');
  await folder('foreign-folder', 'Mine', null, ['Mine'], 'foreign-source', OTHER);
  const photo = async (seed: PhotoSeed) => {
    const date = seed.date === undefined ? null : seed.date;
    await prisma.photo.create({
      data: photoRow(P, seed.id, {
        userId: seed.userId ?? OWNER,
        sourceId: seed.sourceId ?? 'source',
        folderId: seed.folderId === undefined ? null : seed.folderId,
        fileName: seed.fileName ?? `${seed.id}.jpg`,
        status: seed.status ?? 'ACTIVE',
        hiddenAt: seed.hidden ? new Date('2026-01-01') : null,
        detectedSource: seed.detectedSource ?? 'NONE',
        effectiveDateValue: date ? new Date(date) : null,
        effectiveDatePrecision: date ? (seed.precision ?? 'DAY') : 'UNKNOWN',
        effectiveDateSource: date ? (seed.origin ?? 'EXIF') : 'NONE',
      }),
    });
    if (seed.override)
      await prisma.manualDateOverride.create({
        data: { photoId: seed.id, dateValue: new Date('2001-01-01'), precision: 'YEAR' },
      });
  };
  await photo({ id: 'u1', folderId: 'phone', fileName: 'a.jpg' });
  await photo({ id: 'u2', folderId: 'phone', fileName: 'b.jpg' });
  await photo({ id: 'u3', folderId: 'trip', fileName: 'c.jpg' });
  await photo({ id: 'u4', folderId: null, fileName: 'd.jpg' });
  await photo({
    id: 'y1',
    folderId: 'y2001',
    date: '2001-01-01',
    precision: 'YEAR',
    origin: 'FOLDER',
  });
  await photo({
    id: 'y2',
    folderId: 'trip',
    date: '2001-01-01',
    precision: 'YEAR',
    origin: 'FOLDER_RULE',
  });
  await photo({ id: 'd1', folderId: 'trip', date: '2001-07-04', precision: 'DAY', origin: 'EXIF' });
  await photo({
    id: 'd2',
    folderId: 'phone',
    date: '2019-08-12',
    precision: 'DAY',
    origin: 'FILENAME',
  });
  await photo({
    id: 'm1',
    folderId: 'phone',
    date: '2019-03-01',
    precision: 'MONTH',
    origin: 'MANUAL',
  });
  await photo({ id: 'h1', folderId: 'trip', hidden: true });
  await photo({ id: 'h2', folderId: 'phone', date: '2020-02-02', hidden: true });
  await photo({
    id: 'e1',
    folderId: 'other-source-folder',
    sourceId: 'source-2',
    fileName: 'e.jpg',
  });
  await photo({ id: 'x1', folderId: 'foreign-folder', userId: OTHER, sourceId: 'foreign-source' });
  await photo({ id: 'missing', folderId: 'phone', fileName: 'missing.jpg', status: 'MISSING' });
  return { service: new OrderingService(prisma as any) };
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe.skipIf(!pgUrl)('OrderingService.piles', () => {
  it('counts the four piles for the whole archive, ignoring other users and missing photos', async () => {
    const { service } = await archive();
    expect(await service.piles(OWNER, {})).toEqual({
      undated: 5,
      yearOnly: 2,
      dated: 3,
      hidden: 2,
      total: 10,
    });
  });

  it('filters by source', async () => {
    const { service } = await archive();
    expect(await service.piles(OWNER, { sourceId: 'source-2' })).toMatchObject({
      undated: 1,
      yearOnly: 0,
      dated: 0,
      hidden: 0,
    });
  });

  it('filters by folder, with or without subfolders', async () => {
    const { service } = await archive();
    expect(await service.piles(OWNER, { folderId: 'y2001' })).toEqual({
      undated: 1, // u3 in Trip
      yearOnly: 2,
      dated: 1,
      hidden: 1,
      total: 4,
    });
    expect(await service.piles(OWNER, { folderId: 'y2001', includeSubfolders: false })).toEqual({
      undated: 0,
      yearOnly: 1,
      dated: 0,
      hidden: 0,
      total: 1,
    });
  });

  it('refuses sources and folders of another user', async () => {
    const { service } = await archive();
    await expect(service.piles(OWNER, { sourceId: 'foreign-source' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.piles(OWNER, { folderId: 'foreign-folder' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.piles(OWNER, { sourceId: 'source-2', folderId: 'phone' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe.skipIf(!pgUrl)('OrderingService.folderTree', () => {
  it('nests folders with own and subtree counts of photos and photos still to date', async () => {
    const { service } = await archive();
    const tree = await service.folderTree(OWNER, 'source');

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
    const { service } = await archive();
    await rule('phone', 'DIRECT_OVERRIDE', '2019-08-12', 'DAY');
    const tree = await service.folderTree(OWNER, 'source');
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
    const { service } = await archive();
    // A real parent link cannot dangle (deleting the parent clears it), so the orphan is a folder
    // whose parent was removed.
    await prisma.indexedFolder.update({ where: { id: 'trip' }, data: { parentId: null } });
    const tree = await service.folderTree(OWNER, 'source');
    expect(tree.items.map((node) => node.name)).toEqual(['Family', 'Trip']);
  });

  it('survives a parent cycle', async () => {
    const { service } = await archive();
    await prisma.indexedFolder.update({ where: { id: 'family' }, data: { parentId: 'trip' } });
    const tree = await service.folderTree(OWNER, 'source');
    expect(tree.folderCount).toBe(4);
    expect(tree.items.length).toBeGreaterThan(0);
  });

  it('refuses a source of another user', async () => {
    const { service } = await archive();
    await expect(service.folderTree(OWNER, 'foreign-source')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('builds a tree of thousands of folders from a handful of queries', async () => {
    await archive();
    await prisma.photo.deleteMany({ where: { userId: OWNER } });
    await prisma.indexedFolder.deleteMany({ where: { userId: OWNER } });
    await prisma.indexedFolder.createMany({
      data: Array.from({ length: 4_000 }, (_, index) => ({
        id: `f${index}`,
        userId: OWNER,
        sourceId: 'source',
        name: `Folder ${index}`,
        parentId: null,
        path: [`Folder ${index}`],
        driveFolderId: `drive-f${index}`,
      })),
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "IndexedFolder" SET "parentId" = 'f' || (CAST(substring("id" from 2) AS int) - 1) / 5
       WHERE "userId" = '${OWNER}' AND "id" <> 'f0'`,
    );
    const calls: string[] = [];
    const service = new OrderingService(observed((name) => calls.push(name)) as any);
    const tree = await service.folderTree(OWNER, 'source');
    expect(tree.folderCount).toBe(4_000);
    expect(calls.length).toBeLessThanOrEqual(4);
  });
});

describe.skipIf(!pgUrl)('OrderingService.folder', () => {
  it('returns the breadcrumb root-first with counts and child folders', async () => {
    const { service } = await archive();
    const folder = await service.folder(OWNER, 'trip');
    expect(folder.breadcrumb).toEqual([
      { id: 'family', name: 'Family' },
      { id: 'y2001', name: '2001' },
      { id: 'trip', name: 'Trip' },
    ]);
    expect(folder).toMatchObject({ sourceId: 'source', photoCount: 3, toDateCount: 2 });
    const parent = await service.folder(OWNER, 'y2001');
    expect(parent.childFolders).toEqual([
      { id: 'trip', name: 'Trip', subtreePhotoCount: 3, subtreeToDateCount: 2 },
    ]);
  });

  it('refuses a folder of another user', async () => {
    const { service } = await archive();
    await expect(service.folder(OWNER, 'foreign-folder')).rejects.toMatchObject({ status: 404 });
  });
});

describe.skipIf(!pgUrl)('OrderingService.photos', () => {
  it('lists each pile with date, precision, origin and hidden flag', async () => {
    const { service } = await archive();
    const dated = await service.photos(OWNER, { pile: 'dated' });
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

    const year = await service.photos(OWNER, { pile: 'yearOnly' });
    expect(ids(year.items).sort()).toEqual(['y1', 'y2']);
    expect(year.items.map((item) => item.effectiveDate.originKind).sort()).toEqual([
      'folder',
      'folder',
    ]);

    const undated = await service.photos(OWNER, { pile: 'undated' });
    expect(ids(undated.items)).toEqual(['u1', 'u2', 'u3', 'u4', 'e1']);

    const hidden = await service.photos(OWNER, { pile: 'hidden', order: 'newest' });
    expect(ids(hidden.items)).toEqual(['h2', 'h1']);
    expect(hidden.items.every((item) => item.hidden)).toBe(true);
  });

  it('orders by name or newest first, and filters by source and folder subtree', async () => {
    const { service } = await archive();
    await prisma.photo.update({ where: { id: 'u1' }, data: { fileName: 'z.jpg' } });
    const byName = await service.photos(OWNER, {
      pile: 'undated',
      order: 'name',
      folderId: 'family',
    });
    expect(byName.items.map((item) => item.fileName)).toEqual(['b.jpg', 'c.jpg', 'z.jpg']);
    const onlyTrip = await service.photos(OWNER, {
      pile: 'undated',
      folderId: 'trip',
      includeSubfolders: false,
    });
    expect(ids(onlyTrip.items)).toEqual(['u3']);
    const source2 = await service.photos(OWNER, { pile: 'undated', sourceId: 'source-2' });
    expect(ids(source2.items)).toEqual(['e1']);
    const newest = await service.photos(OWNER, { pile: 'dated', folderId: 'y2001' });
    expect(ids(newest.items)).toEqual(['d1']);
  });

  it('paginates with a stable cursor and never repeats or skips a photo', async () => {
    const { service } = await archive();
    await prisma.photo.createMany({
      data: Array.from({ length: 25 }, (_, index) =>
        photoRow(P, `bulk-${String(index).padStart(2, '0')}`, {
          folderId: 'trip',
          // Many photos share a date: the id breaks ties.
          effectiveDateValue: new Date(index % 3 === 0 ? '2010-05-05' : '2010-05-06'),
          effectiveDatePrecision: 'DAY',
          effectiveDateSource: 'EXIF',
          fileName: `bulk-${index % 7}.jpg`,
        }),
      ),
    });
    for (const order of ['newest', 'name'] as const) {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await service.photos(OWNER, { pile: 'dated', order, limit: '7', cursor });
        seen.push(...ids(page.items));
        cursor = page.nextCursor ?? undefined;
        pages++;
      } while (cursor);
      expect(pages).toBe(Math.ceil(28 / 7));
      expect(new Set(seen).size).toBe(28);
    }
  });

  it('keeps the newest-first cursor correct across the dated/undated boundary of the hidden pile', async () => {
    const { service } = await archive();
    const first = await service.photos(OWNER, { pile: 'hidden', order: 'newest', limit: '1' });
    expect(ids(first.items)).toEqual(['h2']);
    const second = await service.photos(OWNER, {
      pile: 'hidden',
      order: 'newest',
      limit: '1',
      cursor: first.nextCursor!,
    });
    expect(ids(second.items)).toEqual(['h1']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an invalid pile, order and a cursor from another listing', async () => {
    const { service } = await archive();
    await expect(service.photos(OWNER, { pile: 'all' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'INVALID_PILE' },
    });
    await expect(service.photos(OWNER, {})).rejects.toMatchObject({ status: 400 });
    await expect(service.photos(OWNER, { pile: 'dated', order: 'random' })).rejects.toMatchObject({
      status: 400,
    });
    const page = await service.photos(OWNER, { pile: 'undated', limit: '1' });
    await expect(
      service.photos(OWNER, { pile: 'dated', cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_CURSOR' } });
    await expect(
      service.photos(OWNER, { pile: 'dated', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('validates the page size as a whole number and clamps it', async () => {
    const { service } = await archive();
    for (const limit of ['1.5', 'abc', '', '-3', '1e3'])
      await expect(service.photos(OWNER, { pile: 'dated', limit })).rejects.toMatchObject({
        status: 400,
        response: { code: 'INVALID_LIMIT' },
      });
    expect((await service.photos(OWNER, { pile: 'dated', limit: '0' })).items).toHaveLength(1);
    await expect(service.photos(OWNER, { pile: 'dated', limit: '999' })).resolves.toBeDefined();
  });

  it('rejects a cursor whose date cannot be read', async () => {
    const { service } = await archive();
    const first = await service.photos(OWNER, { pile: 'dated', order: 'newest', limit: '1' });
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...decoded, value: 'not-a-date' })).toString(
      'base64url',
    );
    await expect(
      service.photos(OWNER, { pile: 'dated', order: 'newest', limit: '1', cursor: forged }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_CURSOR' } });
  });

  it('never returns photos of another user', async () => {
    const { service } = await archive();
    const everything = await Promise.all(
      (['undated', 'yearOnly', 'dated', 'hidden'] as const).map((pile) =>
        service.photos(OWNER, { pile, limit: '200' }),
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

describe.skipIf(!pgUrl)('OrderingService filename suggestions', () => {
  async function withNames() {
    const { service } = await archive();
    const rename = (id: string, fileName: string, extra: Record<string, unknown> = {}) =>
      prisma.photo.update({ where: { id }, data: { fileName, ...extra } });
    await rename('u1', 'IMG-20190812-WA0001.jpg');
    await rename('u2', 'IMG-20190813-WA0002.jpg');
    await rename('u3', 'PXL_20200101_101010101.jpg');
    await rename('u4', 'Screenshot_2018-03-04-10-11-12.png');
    // Year-only from a folder name: the file name is stronger evidence.
    await rename('y1', 'IMG_20010704_101010.jpg', { detectedSource: 'FOLDER' });
    // Already dated by the camera, manual, or hidden: not suggestions.
    await rename('d1', 'IMG-20190812-WA0099.jpg');
    await rename('m1', 'IMG-20190812-WA0100.jpg');
    await rename('h1', 'IMG-20190812-WA0101.jpg');
    // Undated but with an override (e.g. a manual year): the user's choice stands.
    await rename('y2', 'IMG-20190812-WA0102.jpg', { detectedSource: 'FOLDER' });
    await prisma.manualDateOverride.create({
      data: { photoId: 'y2', dateValue: new Date('2001-01-01'), precision: 'YEAR' },
    });
    // The name carries no date.
    await rename('e1', 'IMG_1234.jpg');
    return { service };
  }

  it('groups photos still to date by the kind of name, with counts, range and examples', async () => {
    const { service } = await withNames();
    const result = await service.filenameSuggestions(OWNER, {});
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
    const { service } = await withNames();
    expect((await service.filenameSuggestions(OWNER, { folderId: 'phone' })).totalCount).toBe(2);
    expect(
      (await service.filenameSuggestions(OWNER, { folderId: 'family', includeSubfolders: false }))
        .totalCount,
    ).toBe(0);
    expect((await service.filenameSuggestions(OWNER, { sourceId: 'source-2' })).totalCount).toBe(0);
  });

  it('does not suggest what an overriding folder date would win over anyway', async () => {
    const { service } = await withNames();
    await rule('phone', 'ALL_DESCENDANTS', '2005-01-01', 'YEAR');
    const result = await service.filenameSuggestions(OWNER, {});
    expect(result.totalCount).toBe(3); // u1 and u2 live in Phone
    await prisma.folderDateRule.update({
      where: { folderId: 'phone' },
      data: { scope: 'FALLBACK_DESCENDANTS' },
    });
    expect((await service.filenameSuggestions(OWNER, {})).totalCount).toBe(5);
  });

  it('accepts suggestions as detected dates, not manual ones', async () => {
    const { service } = await withNames();
    const result = await service.acceptFilenameSuggestions(OWNER, {});
    expect(result).toEqual({ appliedCount: 5 });
    const u1 = await row('u1');
    expect(u1).toMatchObject({
      detectedSource: 'FILENAME',
      detectedPrecision: 'DAY',
      detectedDate: new Date('2019-08-12'),
      effectiveDateSource: 'FILENAME',
      effectiveDatePrecision: 'DAY',
      effectiveDateValue: new Date('2019-08-12'),
    });
    expect(await prisma.manualDateOverride.count({ where: { photo: { userId: OWNER } } })).toBe(1);
    const y1 = await row('y1');
    expect(y1).toMatchObject({
      effectiveDateValue: new Date('2001-07-04'),
      detectedSource: 'FILENAME',
    });
    // Untouched: camera-dated, hidden, overridden, no date in the name.
    for (const id of ['d1', 'm1', 'h1', 'y2', 'e1'])
      expect((await row(id)).detectedSource).not.toBe('FILENAME');
    // Nothing is left to suggest, and a second accept is a no-op.
    expect((await service.filenameSuggestions(OWNER, {})).totalCount).toBe(0);
    expect(await service.acceptFilenameSuggestions(OWNER, {})).toEqual({ appliedCount: 0 });
  });

  it('accepts only the chosen kinds and photos', async () => {
    const { service } = await withNames();
    expect(await service.acceptFilenameSuggestions(OWNER, { kinds: ['whatsapp'] })).toEqual({
      appliedCount: 2,
    });
    expect(
      await service.acceptFilenameSuggestions(OWNER, { photoIds: ['u3', 'u4', 'e1', 'ghost'] }),
    ).toEqual({ appliedCount: 2 });
    expect((await row('y1')).detectedSource).toBe('FOLDER');
  });

  it('pushes explicit photo IDs into the query instead of scanning the whole scope', async () => {
    await withNames();
    const queries: Array<{ name: string; args: any }> = [];
    const service = new OrderingService(
      observed((name, args) => queries.push({ name, args })) as any,
    );
    await service.acceptFilenameSuggestions(OWNER, { photoIds: ['u3'] });
    const scanned = queries
      .filter((query) => query.name === 'findMany')
      .map((q) => q.args.where.id);
    expect(scanned[0]).toMatchObject({ in: ['u3'] });
  });

  it('validates the input and never touches another user', async () => {
    const { service } = await withNames();
    await expect(
      service.acceptFilenameSuggestions(OWNER, { kinds: ['nonsense'] }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.acceptFilenameSuggestions(OWNER, { kinds: 'whatsapp' }),
    ).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.acceptFilenameSuggestions(OWNER, { photoIds: [] })).rejects.toMatchObject({
      status: 400,
    });
    await prisma.photo.update({
      where: { id: 'x1' },
      data: { fileName: 'IMG-20190812-WA0500.jpg' },
    });
    await service.acceptFilenameSuggestions(OWNER, { photoIds: ['x1'] });
    expect((await row('x1')).detectedSource).toBe('NONE');
    await expect(
      service.filenameSuggestions(OWNER, { sourceId: 'foreign-source' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

afterAll(async () => {
  if (!pgUrl) return;
  await dropUsers(prisma, P);
  await prisma.$disconnect();
});
