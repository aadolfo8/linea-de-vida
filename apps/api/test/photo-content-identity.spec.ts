import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { SourcesController } from '../src/sources.controller';
import { DriveAdapter, DriveItem } from '../src/drive';
import { SyncService } from '../src/sync.service';
import { MemoryPrisma } from './support/memory-prisma';

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

function archive() {
  const memory = new MemoryPrisma();
  const runs = new Map<string, any>();
  const issues: any[] = [];
  const folders = new Map<string, any>();
  const prisma: any = {
    photo: memory.photo,
    photoFile: memory.photoFile,
    photoExclusion: memory.photoExclusion,
    manualDateOverride: memory.manualDateOverride,
    indexedFolder: {
      findUnique: async ({ where }: any) =>
        where.id
          ? ([...folders.values()].find((entry) => entry.id === where.id) ?? null)
          : (folders.get(where.userId_driveFolderId.driveFolderId) ?? null),
      findFirst: async () => null,
      upsert: async ({ where, create, update }: any) => {
        const id = where.userId_driveFolderId.driveFolderId;
        const value = folders.get(id) ?? { id: `folder-${id}` };
        Object.assign(value, folders.has(id) ? update : create);
        folders.set(id, value);
        return { ...value, dateRule: value.dateRule ?? null };
      },
      updateMany: async ({ where, data }: any) => {
        for (const entry of folders.values())
          if (
            entry.sourceId === where.sourceId &&
            entry.lastSeenSyncRunId !== where.lastSeenSyncRunId.not
          )
            Object.assign(entry, data);
      },
    },
    syncRun: {
      findUnique: async ({ where }: any) => runs.get(where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(runs.get(where.id), data),
    },
    syncIssue: {
      findFirst: async () => null,
      create: async ({ data }: any) => issues.push(data),
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (operation: any) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
  };
  const drive = new TreeDrive({}, {});
  const service = new SyncService(prisma, drive, new PhotoDateResolver());
  let runCounter = 0;
  /** Runs one complete sync of a source whose Drive root holds `tree[rootId]`. */
  const sync = async (
    sourceId: string,
    rootId: string,
    tree: Record<string, DriveItem[]>,
    type: 'GENERIC' | 'GOOGLE_TAKEOUT' = 'GENERIC',
  ) => {
    drive.tree = tree;
    (drive as any).roots = { [rootId]: 'Archive' };
    const id = `run-${++runCounter}`;
    runs.set(id, {
      id,
      status: 'QUEUED',
      source: {
        id: sourceId,
        userId: 'owner',
        driveFolderId: rootId,
        type,
        connection: { refreshTokenCiphertext: null },
      },
      foundCount: 0,
      processedCount: 0,
      indexedCount: 0,
      issueCount: 0,
      removedCount: 0,
      checkpoint: null,
    });
    await service.execute(id);
    return runs.get(id);
  };
  const photos = () => memory.rows('photo');
  const files = () => memory.rows('photoFile');
  const photoOf = (driveFileId: string) =>
    photos().find(
      (photo) => photo.id === files().find((f) => f.driveFileId === driveFileId)?.photoId,
    );
  return { memory, sync, photos, files, photoOf, issues, prisma, folders };
}

describe('photo content identity', () => {
  it('re-extracting an export into the same source adds only the new photos', async () => {
    const a = archive();
    const first = await a.sync('source', 'root', {
      root: [folder('takeout-1', 'Takeout')],
      'takeout-1': [image('a1', 'aaa'), image('b1', 'bbb')],
    });
    expect(first).toMatchObject({ status: 'SUCCEEDED', indexedCount: 2, removedCount: 0 });
    expect(a.photos()).toHaveLength(2);

    const second = await a.sync('source', 'root', {
      root: [folder('takeout-1', 'Takeout'), folder('takeout-2', 'Takeout 2')],
      'takeout-1': [image('a1', 'aaa'), image('b1', 'bbb')],
      'takeout-2': [image('a2', 'aaa'), image('b2', 'bbb'), image('c2', 'ccc')],
    });

    expect(second).toMatchObject({ status: 'SUCCEEDED', removedCount: 0 });
    expect(a.photos().map((photo) => photo.status)).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);
    expect(a.photos()).toHaveLength(3);
    expect(a.files()).toHaveLength(5);
    expect(a.photoOf('a2')!.id).toBe(a.photoOf('a1')!.id);
    expect(a.photoOf('c2')!.contentKey).toBe('md5:ccc:1000');
  });

  it('keeps manual dates, the primary copy and the folder of the first import when a copy attaches', async () => {
    const a = archive();
    await a.sync('source', 'root', {
      root: [folder('takeout-1', '2001')],
      'takeout-1': [image('a1', 'aaa')],
    });
    const original = a.photoOf('a1')!;
    a.memory.rows('manualDateOverride').push({
      id: 'override',
      photoId: original.id,
      dateValue: new Date('1999-05-01'),
      precision: 'MONTH',
    });
    original.effectiveDateValue = new Date('1999-05-01');
    original.effectiveDatePrecision = 'MONTH';
    original.effectiveDateSource = 'MANUAL';

    await a.sync('source', 'root', {
      root: [folder('takeout-1', '2001'), folder('takeout-2', '2020')],
      'takeout-1': [image('a1', 'aaa')],
      'takeout-2': [image('a2', 'aaa')],
    });

    const photo = a.photoOf('a2')!;
    expect(photo.id).toBe(original.id);
    expect(photo).toMatchObject({
      driveFileId: 'a1',
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'MONTH',
    });
    expect(photo.detectedSource).toBe('FOLDER');
    expect(photo.detectedDate).toEqual(new Date('2001-01-01'));
    expect(a.memory.rows('manualDateOverride')).toHaveLength(1);
  });

  it('treats the same picture in two sources as one photo', async () => {
    const a = archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx')] });
    const run = await a.sync('source-b', 'root-b', {
      'root-b': [image('x2', 'xxx'), image('y2', 'yyy')],
    });
    expect(run.indexedCount).toBe(2);
    expect(a.photos()).toHaveLength(2);
    expect(a.files().filter((file) => file.photoId === a.photoOf('x1')!.id)).toHaveLength(2);
    expect(
      a
        .files()
        .map((file) => file.sourceId)
        .sort(),
    ).toEqual(['source-a', 'source-b', 'source-b']);
  });

  it('keeps every photo ACTIVE when the old export is deleted after importing the new one', async () => {
    const a = archive();
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
    expect(a.photos().map((photo) => photo.status)).toEqual(['ACTIVE', 'ACTIVE']);
    expect(
      a
        .files()
        .filter((file) => file.status === 'MISSING')
        .map((f) => f.driveFileId),
    ).toEqual(['a1', 'b1']);
    // The photo now mirrors the surviving copy.
    expect(a.photos().map((photo) => photo.driveFileId)).toEqual(['a2', 'b2']);
  });

  it('marks a photo MISSING only when every copy, in every source, is gone', async () => {
    const a = archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx'), image('only', 'ooo')] });
    await a.sync('source-b', 'root-b', { 'root-b': [image('x2', 'xxx')] });

    // Source A no longer holds either file; X survives through source B.
    const afterA = await a.sync('source-a', 'root-a', { 'root-a': [] });
    expect(afterA.removedCount).toBe(1);
    expect(a.photoOf('x1')).toMatchObject({
      status: 'ACTIVE',
      driveFileId: 'x2',
      sourceId: 'source-b',
    });
    expect(a.photoOf('only')).toMatchObject({ status: 'MISSING' });

    const afterB = await a.sync('source-b', 'root-b', { 'root-b': [] });
    expect(afterB.removedCount).toBe(1);
    expect(a.photoOf('x2')).toMatchObject({ status: 'MISSING' });
  });

  it('does not reconcile copies when the scan was not complete', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    // A sidecar that cannot be parsed makes the run PARTIAL: nothing may be marked missing.
    const partial = await a.sync(
      'source',
      'root',
      { root: [{ id: 'bad', name: 'bad.json', mimeType: 'application/json', parents: [] }] },
      'GOOGLE_TAKEOUT',
    );
    expect(partial.status).toBe('PARTIAL');
    expect(a.photoOf('a1')).toMatchObject({ status: 'ACTIVE' });
    expect(a.files()[0]).toMatchObject({ status: 'ACTIVE' });
  });

  it('revives a missing photo when a new copy of the same content appears', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    await a.sync('source', 'root', { root: [] });
    expect(a.photoOf('a1')).toMatchObject({ status: 'MISSING' });

    await a.sync('source', 'root', {
      root: [folder('again', 'Again')],
      again: [image('a9', 'aaa')],
    });

    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({ status: 'ACTIVE', driveFileId: 'a9' });
  });

  it('turns a legacy removal into a hidden photo carrying its saved manual date', async () => {
    const a = archive();
    a.memory.rows('photoExclusion').push({
      id: 'tombstone',
      userId: 'owner',
      driveFileId: 'gone',
      manualDateValue: new Date('2003-01-01'),
      manualDatePrecision: 'YEAR',
      manualDateReason: 'Family note',
      restoredAt: null,
      createdAt: new Date('2026-01-02'),
    });

    const run = await a.sync('source', 'root', { root: [image('gone', 'ggg')] });

    expect(run.status).toBe('SUCCEEDED');
    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({
      hiddenAt: new Date('2026-01-02'),
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'YEAR',
    });
    expect(a.memory.rows('photoExclusion')).toHaveLength(0);
  });

  it('brings a restored legacy removal back visible', async () => {
    const a = archive();
    a.memory.rows('photoExclusion').push({
      id: 'tombstone',
      userId: 'owner',
      driveFileId: 'back',
      restoredAt: new Date('2026-02-01'),
      createdAt: new Date('2026-01-02'),
    });
    await a.sync('source', 'root', { root: [image('back', 'bbb')] });
    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0].hiddenAt ?? null).toBeNull();
    expect(a.memory.rows('photoExclusion')).toHaveLength(0);
  });

  it('keeps a hidden photo hidden when a new copy of its content appears', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    a.photos()[0].hiddenAt = new Date('2026-03-01');

    await a.sync('source', 'root', {
      root: [folder('again', 'Takeout 2'), image('a1', 'aaa')],
      again: [image('a2', 'aaa')],
    });

    expect(a.photos()).toHaveLength(1);
    expect(a.files()).toHaveLength(2);
    expect(a.photos()[0].hiddenAt).toEqual(new Date('2026-03-01'));
  });

  it('hides an existing visible photo when a legacy removal matches its Drive file', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    a.memory.rows('photoExclusion').push({
      id: 'tombstone',
      userId: 'owner',
      driveFileId: 'a1',
      restoredAt: null,
      createdAt: new Date('2026-01-02'),
    });
    await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0].hiddenAt).toEqual(new Date('2026-01-02'));
  });

  it('upgrades backfilled provisional keys and merges photos that turn out to be one', async () => {
    const a = archive();
    // State left by the migration: one photo per Drive file, keys derived from the file id.
    for (const [id, override] of [
      ['a1', false],
      ['a2', true],
    ] as const) {
      a.memory.rows('photo').push({
        id: `photo-${id}`,
        userId: 'owner',
        contentKey: `drive:${id}`,
        driveFileId: id,
        sourceId: 'source',
        folderId: null,
        status: 'ACTIVE',
        detectedSource: 'NONE',
        lastSeenSyncRunId: 'previous',
      });
      a.memory.rows('photoFile').push({
        id: `pf_photo-${id}`,
        photoId: `photo-${id}`,
        userId: 'owner',
        sourceId: 'source',
        driveFileId: id,
        status: 'ACTIVE',
        lastSeenSyncRunId: 'previous',
        createdAt: new Date(0),
      });
      if (override)
        a.memory.rows('manualDateOverride').push({
          id: 'override',
          photoId: `photo-${id}`,
          dateValue: new Date('2010-01-01'),
          precision: 'YEAR',
        });
    }

    await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('a2', 'aaa')] });

    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({ contentKey: 'md5:aaa:1000', status: 'ACTIVE' });
    expect(a.files().map((file) => file.photoId)).toEqual([a.photos()[0].id, a.photos()[0].id]);
    // The manual date of the folded photo is adopted, not lost.
    expect(a.memory.rows('manualDateOverride')).toMatchObject([{ photoId: a.photos()[0].id }]);
  });

  it('upgrades a provisional key in place when nothing else owns the content', async () => {
    const a = archive();
    a.memory.rows('photo').push({
      id: 'photo-a1',
      userId: 'owner',
      contentKey: 'drive:a1',
      driveFileId: 'a1',
      sourceId: 'source',
      status: 'ACTIVE',
      detectedSource: 'NONE',
    });
    a.memory.rows('photoFile').push({
      id: 'pf_photo-a1',
      photoId: 'photo-a1',
      userId: 'owner',
      sourceId: 'source',
      driveFileId: 'a1',
      status: 'ACTIVE',
      createdAt: new Date(0),
    });

    await a.sync('source', 'root', { root: [image('a1', 'AAA', 'a1.jpg', '7')] });

    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({ id: 'photo-a1', contentKey: 'md5:aaa:7' });
    expect(a.files()[0]).toMatchObject({ md5Checksum: 'aaa', sizeBytes: 7n });
  });

  it('derives the date from the primary copy folder rule, not from a secondary copy folder', async () => {
    const a = archive();
    const name = 'IMG-20190812-WA0001.jpg';
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
    });
    a.folders.get('other').dateRule = {
      dateValue: new Date('2001-01-01'),
      precision: 'YEAR',
      scope: 'DIRECT_OVERRIDE',
    };

    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
      other: [image('a2', 'aaa', name)],
    });
    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({
      driveFileId: 'a1',
      effectiveDateSource: 'FILENAME',
      lastSeenSyncRunId: 'run-2',
    });

    // The rule of the primary folder wins on every later sync, whichever copy is visited.
    a.folders.get('primary').dateRule = {
      dateValue: new Date('1999-01-01'),
      precision: 'YEAR',
      scope: 'DIRECT_OVERRIDE',
    };
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa', name)],
      other: [image('a2', 'aaa', name)],
    });
    expect(a.photos()[0]).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDateValue: new Date('1999-01-01'),
    });
  });

  it('does not mirror run bookkeeping from a secondary copy', async () => {
    const a = archive();
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa')],
    });
    await a.sync('source', 'root', {
      root: [folder('primary', 'Primary'), folder('other', 'Other')],
      primary: [image('a1', 'aaa')],
      other: [image('a2', 'aaa')],
    });
    expect(a.photos()[0]).toMatchObject({ driveFileId: 'a1', status: 'ACTIVE' });
    expect(a.photoOf('a2')!.id).toBe(a.photos()[0].id);
  });

  describe('when a tracked file changes content', () => {
    it('detaches the changed copy and keeps the photo with its other copies', async () => {
      const a = archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('a2', 'aaa')] });
      const original = a.photoOf('a1')!.id;

      await a.sync('source', 'root', { root: [image('a1', 'bbb'), image('a2', 'aaa')] });

      expect(a.photos()).toHaveLength(2);
      expect(a.photoOf('a1')!.contentKey).toBe('md5:bbb:1000');
      expect(a.photoOf('a2')).toMatchObject({
        id: original,
        contentKey: 'md5:aaa:1000',
        driveFileId: 'a2',
        status: 'ACTIVE',
      });
    });

    it('folds a single-copy photo into the one that owns the new content', async () => {
      const a = archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa'), image('b1', 'bbb')] });
      const survivor = a.photoOf('b1')!;
      const loser = a.photoOf('a1')!;
      loser.hiddenAt = new Date('2026-03-01');
      a.memory.rows('manualDateOverride').push({
        id: 'override',
        photoId: loser.id,
        dateValue: new Date('2010-01-01'),
        precision: 'YEAR',
      });

      await a.sync('source', 'root', { root: [image('a1', 'bbb'), image('b1', 'bbb')] });

      expect(a.photos()).toHaveLength(1);
      expect(a.photos()[0]).toMatchObject({ id: survivor.id, contentKey: 'md5:bbb:1000' });
      expect(a.photos()[0].hiddenAt).toEqual(new Date('2026-03-01'));
      expect(a.files().map((file) => file.photoId)).toEqual([survivor.id, survivor.id]);
      expect(a.memory.rows('manualDateOverride')).toMatchObject([{ photoId: survivor.id }]);
    });

    it('re-keys a single-copy photo in place so the old bytes no longer attach to it', async () => {
      const a = archive();
      await a.sync('source', 'root', { root: [image('a1', 'aaa')] });
      const id = a.photos()[0].id;

      await a.sync('source', 'root', { root: [image('a1', 'ccc')] });
      expect(a.photos()).toHaveLength(1);
      expect(a.photos()[0]).toMatchObject({ id, contentKey: 'md5:ccc:1000' });

      await a.sync('source', 'root', { root: [image('a1', 'ccc'), image('z', 'aaa')] });
      expect(a.photos()).toHaveLength(2);
      expect(a.photoOf('z')!.id).not.toBe(id);
    });
  });

  it('files without a checksum are identified by their own Drive id only', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [image('p', null), image('q', null)] });
    expect(
      a
        .photos()
        .map((photo) => photo.contentKey)
        .sort(),
    ).toEqual(['drive:p', 'drive:q']);
  });

  it('creates a single photo when copies of new content are indexed concurrently', async () => {
    const a = archive();
    const run = await a.sync('source', 'root', {
      root: [image('c1', 'ccc'), image('c2', 'ccc'), image('c3', 'ccc'), image('d1', 'ddd')],
    });
    expect(run).toMatchObject({ status: 'SUCCEEDED', indexedCount: 4 });
    expect(a.photos()).toHaveLength(2);
    expect(a.files()).toHaveLength(4);
    expect(a.issues).toHaveLength(0);
  });

  it('never replaces stronger date evidence with a weaker copy', async () => {
    const a = archive();
    const camera = { ...image('a1', 'aaa'), imageTime: '2005-07-04T10:00:00.000Z' };
    await a.sync('source', 'root', { root: [camera] });
    expect(a.photoOf('a1')).toMatchObject({ detectedSource: 'DRIVE_IMAGE_METADATA' });

    await a.sync('source', 'root', {
      root: [folder('t2', '2020'), camera],
      t2: [image('a2', 'aaa')],
    });

    expect(a.photoOf('a2')).toMatchObject({
      detectedSource: 'DRIVE_IMAGE_METADATA',
      effectiveDateSource: 'DRIVE_IMAGE_METADATA',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('lets a copy with better evidence improve the photo', async () => {
    const a = archive();
    await a.sync('source', 'root', { root: [folder('t1', '2001')], t1: [image('a1', 'aaa')] });
    expect(a.photoOf('a1')).toMatchObject({ detectedSource: 'FOLDER' });

    await a.sync('source', 'root', {
      root: [folder('t1', '2001'), folder('t2', '2020')],
      t1: [image('a1', 'aaa')],
      t2: [{ ...image('a2', 'aaa'), imageTime: '2012-03-04T10:00:00.000Z' }],
    });

    expect(a.photoOf('a1')).toMatchObject({
      detectedSource: 'DRIVE_IMAGE_METADATA',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('removing a source keeps photos that also live in another source', async () => {
    const a = archive();
    await a.sync('source-a', 'root-a', { 'root-a': [image('x1', 'xxx'), image('only-a', 'ooo')] });
    await a.sync('source-b', 'root-b', { 'root-b': [image('x2', 'xxx')] });
    for (const id of ['source-a', 'source-b'])
      a.memory.rows('photoSource').push({ id, userId: 'owner' });
    const controller = new SourcesController(a.memory as any, {} as any, {} as any, {} as any);

    await controller.removeSource('owner', 'source-a');

    expect(a.photos()).toHaveLength(1);
    expect(a.photos()[0]).toMatchObject({
      status: 'ACTIVE',
      driveFileId: 'x2',
      sourceId: 'source-b',
    });
    expect(a.files().map((file) => file.driveFileId)).toEqual(['x2']);
    expect(a.memory.rows('photoSource').map((source) => source.id)).toEqual(['source-b']);
  });
});
