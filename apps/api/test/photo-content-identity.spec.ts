import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { SourcesController } from '../src/sources.controller';
import { DriveAdapter, DriveItem } from '../src/drive';
import { SyncService } from '../src/sync.service';
import { dropUsers, pgClient, pgUrl, resetUsers } from './support/pg';

const FOLDER = 'application/vnd.google-apps.folder';
const folder = (id: string, name: string): DriveItem => ({
  id,
  name,
  mimeType: FOLDER,
  parents: [],
});
/** A Drive image; `md5` and `size` are its content identity, `id` only its location. */
const image = (id: string, md5: string | null, name = `${id}.jpg`, size = '1000'): DriveItem => ({
  id,
  name,
  mimeType: 'image/jpeg',
  parents: [],
  ...(md5 ? { md5Checksum: md5, size } : {}),
});

class TreeDrive extends DriveAdapter {
  constructor(
    public tree: Record<string, DriveItem[]>,
    private readonly roots: Record<string, string>,
  ) {
    super();
  }
  async listChildren(_: unknown, folderId: string) {
    return { items: this.tree[folderId] ?? [] };
  }
  async getFolder(_: unknown, id: string) {
    return { id, name: this.roots[id] ?? id, mimeType: FOLDER, parents: [] };
  }
  async getThumbnailStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
  async getContentStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
}

const P = 'ci';
const OWNER = `${P}-owner`;
const prisma = pgClient();

async function archive() {
  await resetUsers(prisma, P, false);
  const connection = await prisma.oAuthConnection.findFirstOrThrow({ where: { userId: OWNER } });
  const drive = new TreeDrive({}, {});
  const service = new SyncService(prisma as any, drive, new PhotoDateResolver());
  /** Runs one complete sync of a source whose Drive root holds `tree[rootId]`. */
  const sync = async (
    sourceId: string,
    rootId: string,
    tree: Record<string, DriveItem[]>,
    type: 'GENERIC' | 'GOOGLE_TAKEOUT' = 'GENERIC',
  ) => {
    drive.tree = tree;
    (drive as any).roots = { [rootId]: 'Archive' };
    await prisma.photoSource.upsert({
      where: { id: sourceId },
      create: {
        id: sourceId,
        userId: OWNER,
        oauthConnectionId: connection.id,
        driveFolderId: rootId,
        name: sourceId,
        type,
      },
      update: { type },
    });
    const run = await prisma.syncRun.create({ data: { photoSourceId: sourceId } });
    await service.execute(run.id);
    return prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } });
  };
  const photos = () =>
    prisma.photo.findMany({
      where: { userId: OWNER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const files = () =>
    prisma.photoFile.findMany({
      where: { userId: OWNER },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const photoOf = async (driveFileId: string) => {
    const file = await prisma.photoFile.findFirst({ where: { userId: OWNER, driveFileId } });
    return file ? prisma.photo.findUnique({ where: { id: file.photoId } }) : null;
  };
  const issues = () => prisma.syncIssue.findMany({ where: { run: { source: { userId: OWNER } } } });
  const overrides = () =>
    prisma.manualDateOverride.findMany({ where: { photo: { userId: OWNER } } });
  const exclusions = () => prisma.photoExclusion.findMany({ where: { userId: OWNER } });
  const folderRule = async (driveFolderId: string, rule: Record<string, unknown>) => {
    const folder = await prisma.indexedFolder.findFirstOrThrow({
      where: { userId: OWNER, driveFolderId },
    });
    await prisma.folderDateRule.create({ data: { folderId: folder.id, ...rule } as any });
  };
  /** The source seeded rows point at, for tests that start from rows instead of a sync. */
  const base = () =>
    prisma.photoSource.upsert({
      where: { id: 'source' },
      create: {
        id: 'source',
        userId: OWNER,
        oauthConnectionId: connection.id,
        driveFolderId: 'root',
        name: 'source',
        type: 'GENERIC',
      },
      update: {},
    });
  return { sync, photos, files, photoOf, issues, overrides, exclusions, folderRule, base };
}

afterAll(async () => {
  if (!pgUrl) return;
  await dropUsers(prisma, P);
  await prisma.$disconnect();
});

describe.skipIf(!pgUrl)('photo content identity (PostgreSQL)', () => {
  it('re-extracting an export into the same source adds only the new photos', async () => {
    const a = await archive();
    const first = await a.sync('source', 'root', {
      root: [folder('takeout-1', 'Takeout')],
      'takeout-1': [image('a1', 'aaa'), image('b1', 'bbb')],
    });
    expect(first).toMatchObject({ status: 'SUCCEEDED', indexedCount: 2, removedCount: 0 });
    expect(await a.photos()).toHaveLength(2);

    const second = await a.sync('source', 'root', {
      root: [folder('takeout-1', 'Takeout'), folder('takeout-2', 'Takeout 2')],
      'takeout-1': [image('a1', 'aaa'), image('b1', 'bbb')],
      'takeout-2': [image('a2', 'aaa'), image('b2', 'bbb'), image('c2', 'ccc')],
    });

    expect(second).toMatchObject({ status: 'SUCCEEDED', removedCount: 0 });
    expect((await a.photos()).map((photo) => photo.status)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(await a.photos()).toHaveLength(3);
    expect(await a.files()).toHaveLength(5);
    expect((await a.photoOf('a2'))!.id).toBe((await a.photoOf('a1'))!.id);
    expect((await a.photoOf('c2'))!.contentKey).toBe('md5:ccc:1000');
  });

  it('keeps manual dates, the primary copy and the folder of the first import when a copy attaches', async () => {
    const a = await archive();
    await a.sync('source', 'root', {
      root: [folder('takeout-1', '2001')],
      'takeout-1': [image('a1', 'aaa')],
    });
    const original = (await a.photoOf('a1'))!;
    await prisma.manualDateOverride.create({
      data: { photoId: original.id, dateValue: new Date('1999-05-01'), precision: 'MONTH' },
    });
    await prisma.photo.update({
      where: { id: original.id },
      data: {
        effectiveDateValue: new Date('1999-05-01'),
        effectiveDatePrecision: 'MONTH',
        effectiveDateSource: 'MANUAL',
      },
    });

    await a.sync('source', 'root', {
      root: [folder('takeout-1', '2001'), folder('takeout-2', '2020')],
      'takeout-1': [image('a1', 'aaa')],
      'takeout-2': [image('a2', 'aaa')],
    });

    const photo = (await a.photoOf('a2'))!;
    expect(photo.id).toBe(original.id);
    expect(photo).toMatchObject({
      driveFileId: 'a1',
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'MONTH',
    });
    expect(photo.detectedSource).toBe('FOLDER');
    expect(photo.detectedDate).toEqual(new Date('2001-01-01'));
    expect(await a.overrides()).toHaveLength(1);
  });

  it('treats the same picture in two sources as one photo', async () => {
    const a = await archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx')] });
    const run = await a.sync('source-b', 'root-b', {
      'root-b': [image('x2', 'xxx'), image('y2', 'yyy')],
    });
    expect(run.indexedCount).toBe(2);
    expect(await a.photos()).toHaveLength(2);
    const shared = (await a.photoOf('x1'))!.id;
    expect((await a.files()).filter((file) => file.photoId === shared)).toHaveLength(2);
    expect((await a.files()).map((file) => file.sourceId).sort()).toEqual([
      'source-a',
      'source-b',
      'source-b',
    ]);
  });

  it('keeps every photo ACTIVE when the old export is deleted after importing the new one', async () => {
    const a = await archive();
    await a.sync('source', 'root', {
      root: [folder('takeout-1', 'Takeout'), folder('takeout-2', 'Takeout 2')],
      'takeout-1': [image('a1', 'aaa'), image('b1', 'bbb')],
      'takeout-2': [image('a2', 'aaa'), image('b2', 'bbb')],
    });

    const run = await a.sync('source', 'root', {
      root: [folder('takeout-2', 'Takeout 2')],
      'takeout-2': [image('a2', 'aaa'), image('b2', 'bbb')],
    });

    expect(run).toMatchObject({ status: 'SUCCEEDED', removedCount: 0 });
    expect((await a.photos()).map((photo) => photo.status)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(
      (await a.files())
        .filter((file) => file.status === 'MISSING')
        .map((f) => f.driveFileId)
        .sort(),
    ).toEqual(['a1', 'b1']);
    // The photo now mirrors the surviving copy.
    expect((await a.photos()).map((photo) => photo.driveFileId).sort()).toEqual(['a2', 'b2']);
  });

  it('marks a photo MISSING only when every copy, in every source, is gone', async () => {
    const a = await archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx'), image('only', 'ooo')] });
    await a.sync('source-b', 'root-b', { 'root-b': [image('x2', 'xxx')] });

    // Source A no longer holds either file; X survives through source B.
    const afterA = await a.sync('source-a', 'root-a', { 'root-a': [] });
    expect(afterA.removedCount).toBe(1);
    expect(await a.photoOf('x1')).toMatchObject({
      status: 'ACTIVE',
      driveFileId: 'x2',
      sourceId: 'source-b',
    });
    expect(await a.photoOf('only')).toMatchObject({ status: 'MISSING' });

    const afterB = await a.sync('source-b', 'root-b', { 'root-b': [] });
    expect(afterB.removedCount).toBe(1);
    expect(await a.photoOf('x2')).toMatchObject({ status: 'MISSING' });
  });

  it('does not reconcile copies when the scan was not complete', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    // A sidecar that cannot be parsed makes the run PARTIAL: nothing may be marked missing.
    const partial = await a.sync(
      'source',
      'root',
      { root: [{ id: 'bad', name: 'bad.json', mimeType: 'application/json', parents: [] }] },
      'GOOGLE_TAKEOUT',
    );
    expect(partial.status).toBe('PARTIAL');
    expect(await a.photoOf('a1')).toMatchObject({ status: 'ACTIVE' });
    expect((await a.files())[0]).toMatchObject({ status: 'ACTIVE' });
  });

  it('revives a missing photo when a new copy of the same content appears', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    await a.sync('source', 'root', { root: [] });
    expect(await a.photoOf('a1')).toMatchObject({ status: 'MISSING' });

    await a.sync('source', 'root', {
      root: [folder('again', 'Again')],
      again: [image('a9', 'aaa')],
    });

    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({ status: 'ACTIVE', driveFileId: 'a9' });
  });

  it('turns a legacy removal into a hidden photo carrying its saved manual date', async () => {
    const a = await archive();
    await prisma.photoExclusion.create({
      data: {
        userId: OWNER,
        sourceId: 'source',
        sourceName: 'Archive',
        driveFileId: 'gone',
        manualDateValue: new Date('2003-01-01'),
        manualDatePrecision: 'YEAR',
        manualDateReason: 'Family note',
        restoredAt: null,
        createdAt: new Date('2026-01-02'),
      },
    });

    const run = await a.sync('source', 'root', { root: [image('gone', 'ggg')] });

    expect(run.status).toBe('SUCCEEDED');
    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({
      hiddenAt: new Date('2026-01-02'),
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'YEAR',
    });
    expect(await a.exclusions()).toHaveLength(0);
  });

  it('brings a restored legacy removal back visible', async () => {
    const a = await archive();
    await prisma.photoExclusion.create({
      data: {
        userId: OWNER,
        sourceId: 'source',
        sourceName: 'Archive',
        driveFileId: 'back',
        restoredAt: new Date('2026-02-01'),
        createdAt: new Date('2026-01-02'),
      },
    });
    await a.sync('source', 'root', { root: [image('back', 'bbb')] });
    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0].hiddenAt ?? null).toBeNull();
    expect(await a.exclusions()).toHaveLength(0);
  });

  it('keeps a hidden photo hidden when a new copy of its content appears', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    await prisma.photo.updateMany({
      where: { userId: OWNER },
      data: { hiddenAt: new Date('2026-03-01') },
    });

    await a.sync('source', 'root', {
      root: [folder('again', 'Takeout 2'), image('a1', 'aaa')],
      again: [image('a2', 'aaa')],
    });

    expect(await a.photos()).toHaveLength(1);
    expect(await a.files()).toHaveLength(2);
    expect((await a.photos())[0].hiddenAt).toEqual(new Date('2026-03-01'));
  });

  it('hides an existing visible photo when a legacy removal matches its Drive file', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    await prisma.photoExclusion.create({
      data: {
        userId: OWNER,
        sourceId: 'source',
        sourceName: 'Archive',
        driveFileId: 'a1',
        restoredAt: null,
        createdAt: new Date('2026-01-02'),
      },
    });
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0].hiddenAt).toEqual(new Date('2026-01-02'));
  });

  it('upgrades backfilled provisional keys and merges photos that turn out to be one', async () => {
    const a = await archive();
    // State left by the migration: one photo per Drive file, keys derived from the file id.
    await a.base();
    for (const [id, override] of [
      ['a1', false],
      ['a2', true],
    ] as const) {
      await prisma.photo.create({
        data: {
          id: `photo-${id}`,
          userId: OWNER,
          contentKey: `drive:${id}`,
          driveFileId: id,
          sourceId: 'source',
          fileName: `${id}.jpg`,
          mimeType: 'image/jpeg',
          lastSeenSyncRunId: 'previous',
        },
      });
      await prisma.photoFile.create({
        data: {
          id: `pf_photo-${id}`,
          photoId: `photo-${id}`,
          userId: OWNER,
          sourceId: 'source',
          driveFileId: id,
          fileName: `${id}.jpg`,
          mimeType: 'image/jpeg',
          lastSeenSyncRunId: 'previous',
          createdAt: new Date(0),
        },
      });
      if (override)
        await prisma.manualDateOverride.create({
          data: { photoId: `photo-${id}`, dateValue: new Date('2010-01-01'), precision: 'YEAR' },
        });
    }

    await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('a2', 'aaa')] });

    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({ contentKey: 'md5:aaa:1000', status: 'ACTIVE' });
    expect((await a.files()).map((file) => file.photoId)).toEqual([
      (await a.photos())[0].id,
      (await a.photos())[0].id,
    ]);
    // The manual date of the folded photo is adopted, not lost.
    expect(await a.overrides()).toMatchObject([{ photoId: (await a.photos())[0].id }]);
  });

  it('upgrades a provisional key in place when nothing else owns the content', async () => {
    const a = await archive();
    await a.base();
    await prisma.photo.create({
      data: {
        id: 'photo-a1',
        userId: OWNER,
        contentKey: 'drive:a1',
        driveFileId: 'a1',
        sourceId: 'source',
        fileName: 'a1.jpg',
        mimeType: 'image/jpeg',
      },
    });
    await prisma.photoFile.create({
      data: {
        id: 'pf_photo-a1',
        photoId: 'photo-a1',
        userId: OWNER,
        sourceId: 'source',
        driveFileId: 'a1',
        fileName: 'a1.jpg',
        mimeType: 'image/jpeg',
        createdAt: new Date(0),
      },
    });

    await a.sync('source', 'root', { root: [image('a1', 'AAA', 'a1.jpg', '7')] });

    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({ id: 'photo-a1', contentKey: 'md5:aaa:7' });
    expect((await a.files())[0]).toMatchObject({ md5Checksum: 'aaa', sizeBytes: 7n });
  });

  it('derives the date from the primary copy folder rule, not from a secondary copy folder', async () => {
    const a = await archive();
    const name = 'IMG-20190812-WA0001.jpg';
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
    });
    await a.folderRule('other', {
      dateValue: new Date('2001-01-01'),
      precision: 'YEAR',
      scope: 'DIRECT_OVERRIDE',
    });

    const second = await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
      other: [image('a2', 'aaa', name)],
    });
    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({
      driveFileId: 'a1',
      effectiveDateSource: 'FILENAME',
      lastSeenSyncRunId: second.id,
    });

    // The rule of the primary folder wins on every later sync, whichever copy is visited.
    await a.folderRule('primary', {
      dateValue: new Date('1999-01-01'),
      precision: 'YEAR',
      scope: 'DIRECT_OVERRIDE',
    });
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
      other: [image('a2', 'aaa', name)],
    });
    expect((await a.photos())[0]).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDateValue: new Date('1999-01-01'),
    });
  });

  it('does not mirror run bookkeeping from a secondary copy', async () => {
    const a = await archive();
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa')],
    });
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa')],
      other: [image('a2', 'aaa')],
    });
    expect((await a.photos())[0]).toMatchObject({ driveFileId: 'a1', status: 'ACTIVE' });
    expect((await a.photoOf('a2'))!.id).toBe((await a.photos())[0].id);
  });

  describe('when a tracked file changes content', () => {
    it('detaches the changed copy and keeps the photo with its other copies', async () => {
      const a = await archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('a2', 'aaa')] });
      const original = (await a.photoOf('a1'))!.id;

      await a.sync('source', 'root', { root: [image('a1', 'bbb'), image('a2', 'aaa')] });

      expect(await a.photos()).toHaveLength(2);
      expect((await a.photoOf('a1'))!.contentKey).toBe('md5:bbb:1000');
      expect(await a.photoOf('a2')).toMatchObject({
        id: original,
        contentKey: 'md5:aaa:1000',
        driveFileId: 'a2',
        status: 'ACTIVE',
      });
    });

    it('folds a single-copy photo into the one that owns the new content', async () => {
      const a = await archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('b1', 'bbb')] });
      const survivor = (await a.photoOf('b1'))!;
      const loser = (await a.photoOf('a1'))!;
      await prisma.photo.update({
        where: { id: loser.id },
        data: { hiddenAt: new Date('2026-03-01') },
      });
      await prisma.manualDateOverride.create({
        data: { photoId: loser.id, dateValue: new Date('2010-01-01'), precision: 'YEAR' },
      });

      await a.sync('source', 'root', { root: [image('a1', 'bbb'), image('b1', 'bbb')] });

      expect(await a.photos()).toHaveLength(1);
      expect((await a.photos())[0]).toMatchObject({ id: survivor.id, contentKey: 'md5:bbb:1000' });
      expect((await a.photos())[0].hiddenAt).toEqual(new Date('2026-03-01'));
      expect((await a.files()).map((file) => file.photoId)).toEqual([survivor.id, survivor.id]);
      expect(await a.overrides()).toMatchObject([{ photoId: survivor.id }]);
    });

    it('re-keys a single-copy photo in place so the old bytes no longer attach to it', async () => {
      const a = await archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
      const id = (await a.photos())[0].id;

      await a.sync('source', 'root', { root: [image('a1', 'ccc')] });
      expect(await a.photos()).toHaveLength(1);
      expect((await a.photos())[0]).toMatchObject({ id, contentKey: 'md5:ccc:1000' });

      await a.sync('source', 'root', { root: [image('a1', 'ccc'), image('z', 'aaa')] });
      expect(await a.photos()).toHaveLength(2);
      expect((await a.photoOf('z'))!.id).not.toBe(id);
    });
  });

  it('files without a checksum are identified by their own Drive id only', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [image('p', null), image('q', null)] });
    expect((await a.photos()).map((photo) => photo.contentKey).sort()).toEqual([
      'drive:p',
      'drive:q',
    ]);
  });

  it('creates a single photo when copies of new content are indexed concurrently', async () => {
    const a = await archive();
    const run = await a.sync('source', 'root', {
      root: [image('c1', 'ccc'), image('c2', 'ccc'), image('c3', 'ccc'), image('d1', 'ddd')],
    });
    expect(run).toMatchObject({ status: 'SUCCEEDED', indexedCount: 4 });
    expect(await a.photos()).toHaveLength(2);
    expect(await a.files()).toHaveLength(4);
    expect(await a.issues()).toHaveLength(0);
  });

  it('never replaces stronger date evidence with a weaker copy', async () => {
    const a = await archive();
    const camera = { ...image('a1', 'aaa'), imageTime: '2005-07-04T10:00:00.000Z' };
    await a.sync('source', 'root', { root: [camera] });
    expect(await a.photoOf('a1')).toMatchObject({ detectedSource: 'DRIVE_IMAGE_METADATA' });

    await a.sync('source', 'root', {
      root: [folder('t2', '2020'), camera],
      t2: [image('a2', 'aaa')],
    });

    expect(await a.photoOf('a2')).toMatchObject({
      detectedSource: 'DRIVE_IMAGE_METADATA',
      effectiveDateSource: 'DRIVE_IMAGE_METADATA',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('lets a copy with better evidence improve the photo', async () => {
    const a = await archive();
    await a.sync('source', 'root', { root: [folder('t1', '2001')], t1: [image('a1', 'aaa')] });
    expect(await a.photoOf('a1')).toMatchObject({ detectedSource: 'FOLDER' });

    await a.sync('source', 'root', {
      root: [folder('t1', '2001'), folder('t2', '2020')],
      t1: [image('a1', 'aaa')],
      t2: [{ ...image('a2', 'aaa'), imageTime: '2012-03-04T10:00:00.000Z' }],
    });

    expect(await a.photoOf('a1')).toMatchObject({
      detectedSource: 'DRIVE_IMAGE_METADATA',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('removing a source keeps photos that also live in another source', async () => {
    const a = await archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx'), image('only-a', 'ooo')] });
    await a.sync('source-b', 'root-b', { 'root-b': [image('x2', 'xxx')] });
    const controller = new SourcesController(prisma as any, {} as any, {} as any, {} as any);

    await controller.removeSource(OWNER, 'source-a');

    expect(await a.photos()).toHaveLength(1);
    expect((await a.photos())[0]).toMatchObject({
      status: 'ACTIVE',
      driveFileId: 'x2',
      sourceId: 'source-b',
    });
    expect((await a.files()).map((file) => file.driveFileId)).toEqual(['x2']);
    const remaining = await prisma.photoSource.findMany({
      where: { id: { in: ['source-a', 'source-b'] } },
    });
    expect(remaining.map((source) => source.id)).toEqual(['source-b']);
  });
});
