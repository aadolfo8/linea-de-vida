import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { DriveAdapter, DriveItem, DriveRequestError } from '../src/drive';
import { SyncService } from '../src/sync.service';

const image = (id: string, name = `${id}.jpg`): DriveItem => ({
  id,
  name,
  mimeType: 'image/jpeg',
  parents: [],
});

function fixture(pages: Record<string, { items: DriveItem[]; nextCursor?: string }>) {
  const run: any = {
    id: 'run',
    status: 'QUEUED',
    source: {
      id: 'source',
      userId: 'owner',
      driveFolderId: 'root',
      type: 'GENERIC',
      connection: { refreshTokenCiphertext: null },
    },
    foundCount: 0,
    processedCount: 0,
    indexedCount: 0,
    issueCount: 0,
    checkpoint: null,
  };
  const photos = new Map<string, any>();
  const issues: any[] = [];
  const folders = new Map<string, any>();
  const exclusions = new Set<string>();
  const restoredExclusions = new Map<string, any>();
  const prisma: any = {
    syncRun: {
      findUnique: async () => run,
      update: async ({ data }: any) => Object.assign(run, data),
      findFirst: async () => null,
      create: async () => run,
    },
    syncIssue: {
      findFirst: async ({ where }: any) =>
        issues.find(
          (issue) =>
            issue.code === where.code &&
            issue.driveFileId === where.driveFileId &&
            issue.driveFolderId === where.driveFolderId &&
            issue.resolvedAt === null,
        ) ?? null,
      create: async ({ data }: any) => {
        const issue = {
          ...data,
          driveFileId: data.driveFileId ?? null,
          driveFolderId: data.driveFolderId ?? null,
          id: `issue-${issues.length + 1}`,
          resolvedAt: null,
        };
        issues.push(issue);
        return issue;
      },
      update: async ({ where, data }: any) => {
        const issue = issues.find((candidate) => candidate.id === where.id)!;
        Object.assign(issue, data);
        return issue;
      },
      updateMany: async ({ where, data }: any) => {
        for (const issue of issues)
          if (issue.resolvedAt === where.resolvedAt && issue.syncRunId !== where.syncRunId.not)
            Object.assign(issue, data);
      },
    },
    photoExclusion: {
      findUnique: async ({ where }: any) => {
        const driveFileId = where.userId_driveFileId.driveFileId;
        return (
          restoredExclusions.get(driveFileId) ??
          (exclusions.has(driveFileId) ? { id: 'excluded', restoredAt: null } : null)
        );
      },
      deleteMany: async ({ where }: any) => ({
        count: restoredExclusions.delete(where.id.replace('exclusion-', '')) ? 1 : 0,
      }),
    },
    indexedFolder: {
      findFirst: async ({ where }: any) =>
        [...folders.values()].find(
          (folder) =>
            folder.id === where.id &&
            folder.userId === where.userId &&
            folder.sourceId === where.sourceId,
        ) ?? null,
      findUnique: async ({ where }: any) =>
        folders.get(where.userId_driveFolderId.driveFolderId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const id = where.userId_driveFolderId.driveFolderId;
        const value = folders.get(id) ?? { id };
        Object.assign(value, folders.has(id) ? update : create);
        folders.set(id, value);
        return value;
      },
      updateMany: async ({ where, data }: any) => {
        for (const folder of folders.values())
          if (
            folder.sourceId === where.sourceId &&
            folder.lastSeenSyncRunId !== where.lastSeenSyncRunId.not
          )
            Object.assign(folder, data);
      },
    },
    photo: {
      findUnique: async ({ where }: any) =>
        photos.get(where.userId_driveFileId.driveFileId) ?? null,
      create: async ({ data }: any) => {
        const photo = { ...data, id: data.driveFileId, override: null };
        photos.set(data.driveFileId, photo);
        return photo;
      },
      update: async ({ where, data }: any) => Object.assign(photos.get(where.id), data),
      updateMany: async ({ where, data }: any) => {
        for (const photo of photos.values())
          if (
            photo.sourceId === where.sourceId &&
            photo.lastSeenSyncRunId !== where.lastSeenSyncRunId.not
          )
            Object.assign(photo, data);
      },
    },
    manualDateOverride: {
      upsert: async ({ where, create, update }: any) => {
        const photo = photos.get(where.photoId);
        const value = photo.override ? Object.assign(photo.override, update) : create;
        photo.override = value;
        return value;
      },
    },
    $transaction: async (operation: any) =>
      Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
  };
  class FakeDrive extends DriveAdapter {
    calls = 0;
    async listChildren(_: any, folder: string, cursor?: string) {
      this.calls++;
      return pages[`${folder}:${cursor ?? ''}`]!;
    }
    async getFolder(_: any, id: string) {
      return {
        id,
        name: 'Family archive',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [],
      };
    }
    async getThumbnailStream() {
      return { stream: Readable.from(''), contentType: 'image/jpeg' };
    }
    async getContentStream() {
      return { stream: Readable.from(''), contentType: 'application/json' };
    }
  }
  const drive = new FakeDrive();
  return {
    run,
    photos,
    issues,
    folders,
    exclusions,
    restoredExclusions,
    prisma,
    drive,
    service: new SyncService(prisma, drive, new PhotoDateResolver()),
  };
}

describe('robust sync', () => {
  it.each([
    ['DIRECT_ONLY', false],
    ['FALLBACK_DESCENDANTS', false],
    ['ALL_DESCENDANTS', false],
    ['DIRECT_ONLY', true],
    ['FALLBACK_DESCENDANTS', true],
    ['ALL_DESCENDANTS', true],
  ] as const)('applies folder scope %s with resumed checkpoint: %s', async (scope, resumed) => {
    const f = fixture({
      'root:': {
        items: [
          image('direct'),
          {
            id: 'child',
            name: 'Child',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['root'],
          },
        ],
      },
      'child:': {
        items: [image('unknown'), { ...image('dated'), imageTime: '2010-06-15T12:00:00Z' }],
      },
    });
    const ruleDate = new Date('1998-01-01T00:00:00Z');
    f.folders.set('root', {
      id: 'root',
      userId: 'owner',
      sourceId: 'source',
      parentId: null,
      dateRule: { dateValue: ruleDate, precision: 'YEAR', scope },
    });
    if (resumed) {
      f.run.checkpoint = {
        pendingFolders: [
          { id: 'child', parentDriveFolderId: 'root', path: ['Family archive', 'Child'] },
        ],
        seenFolders: ['root'],
      };
    }
    await f.service.execute('run');
    expect(f.run.status).toBe('SUCCEEDED');
    if (!resumed)
      expect(f.photos.get('direct')).toMatchObject({
        effectiveDateValue: ruleDate,
        effectiveDatePrecision: 'YEAR',
        effectiveDateSource: 'FOLDER_RULE',
      });
    expect(f.photos.get('unknown')).toMatchObject(
      scope === 'DIRECT_ONLY'
        ? {
            effectiveDateValue: null,
            effectiveDatePrecision: 'UNKNOWN',
            effectiveDateSource: 'NONE',
          }
        : {
            effectiveDateValue: ruleDate,
            effectiveDatePrecision: 'YEAR',
            effectiveDateSource: 'FOLDER_RULE',
          },
    );
    expect(f.photos.get('dated')).toMatchObject(
      scope === 'ALL_DESCENDANTS'
        ? {
            effectiveDateValue: ruleDate,
            effectiveDatePrecision: 'YEAR',
            effectiveDateSource: 'FOLDER_RULE',
          }
        : {
            effectiveDateValue: f.photos.get('dated').detectedDate,
            effectiveDatePrecision: f.photos.get('dated').detectedPrecision,
            effectiveDateSource: 'DRIVE_IMAGE_METADATA',
          },
    );
  });

  it.each([
    ['owner', 'source', true],
    ['other-owner', 'source', false],
    ['owner', 'other-source', false],
  ])('resolves past a direct-only parent within %s/%s', async (userId, sourceId, inherits) => {
    const f = fixture({ 'child:': { items: [image('a')] } });
    const ruleDate = new Date('1998-07-01T00:00:00Z');
    f.folders.set('root', {
      id: 'root',
      userId,
      sourceId,
      parentId: null,
      dateRule: { dateValue: ruleDate, precision: 'MONTH', scope: 'FALLBACK_DESCENDANTS' },
    });
    f.folders.set('parent', {
      id: 'parent',
      userId: 'owner',
      sourceId: 'source',
      parentId: 'root',
      dateRule: {
        dateValue: new Date('2001-01-01T00:00:00Z'),
        precision: 'YEAR',
        scope: 'DIRECT_ONLY',
      },
    });
    f.run.checkpoint = {
      pendingFolders: [
        { id: 'child', parentDriveFolderId: 'parent', path: ['Archive', 'Parent', 'Child'] },
      ],
      seenFolders: ['root', 'parent'],
    };
    await f.service.execute('run');
    expect(f.run.status).toBe('SUCCEEDED');
    expect(f.photos.get('a')).toMatchObject(
      inherits
        ? {
            effectiveDateValue: ruleDate,
            effectiveDatePrecision: 'MONTH',
            effectiveDateSource: 'FOLDER_RULE',
          }
        : {
            effectiveDateValue: null,
            effectiveDatePrecision: 'UNKNOWN',
            effectiveDateSource: 'NONE',
          },
    );
  });

  const sidecar = (id: string, name = 'a.jpg.json'): DriveItem => ({
    id,
    name,
    mimeType: 'application/json',
    parents: [],
  });
  const metadataStream = () => ({
    stream: Readable.from(
      JSON.stringify({ title: 'a.jpg', photoTakenTime: { timestamp: '946684800' } }),
    ),
    contentType: 'application/json',
  });

  it.each([true, false])('matches Takeout across pages (photo first: %s)', async (photoFirst) => {
    const f = fixture({
      'root:': { items: [photoFirst ? image('a') : sidecar('json')], nextCursor: 'next' },
      'root:next': { items: [photoFirst ? sidecar('json') : image('a')] },
    });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.drive.getContentStream = async () => metadataStream();
    await f.service.execute('run');
    expect(f.photos.get('a')).toMatchObject({
      takeoutMatchStatus: 'TAKEOUT_MATCHED',
      detectedSource: 'TAKEOUT',
      detectedDate: new Date('2000-01-01T00:00:00.000Z'),
    });
    expect(f.run).toMatchObject({
      status: 'SUCCEEDED',
      foundCount: 1,
      indexedCount: 1,
      processedCount: 1,
    });
  });

  it('detects ambiguous sidecars on separate pages rather than choosing the first', async () => {
    const f = fixture({
      'root:': { items: [image('a'), sidecar('json-1')], nextCursor: 'next' },
      'root:next': { items: [sidecar('json-2')] },
    });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.drive.getContentStream = async () => metadataStream();
    await f.service.execute('run');
    expect(f.photos.get('a').takeoutMatchStatus).toBe('TAKEOUT_AMBIGUOUS');
    expect(f.run.status).toBe('PARTIAL');
  });

  it('resumes metadata collection after a transient failure without skipping the folder', async () => {
    const f = fixture({ 'root:': { items: [] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    let failing = true;
    let jsonReads = 0;
    f.drive.getContentStream = async () => {
      jsonReads++;
      return metadataStream();
    };
    f.drive.listChildren = async (_: any, _folder: string, cursor?: string) => {
      if (cursor && failing) throw new DriveRequestError(503, 'temporary', 0);
      return cursor ? { items: [image('a')] } : { items: [sidecar('json')], nextCursor: 'next' };
    };
    await expect(f.service.execute('run')).rejects.toThrow('temporary');
    expect(f.photos.size).toBe(0);
    // Emulate a new worker reading persisted JSON, not shared object references.
    f.run.checkpoint = JSON.parse(JSON.stringify(f.run.checkpoint));
    failing = false;
    await new SyncService(f.prisma, f.drive, new PhotoDateResolver()).execute('run');
    expect(jsonReads).toBe(1);
    expect(f.photos.get('a').takeoutMatchStatus).toBe('TAKEOUT_MATCHED');
    expect(f.run).toMatchObject({ status: 'SUCCEEDED', indexedCount: 1, foundCount: 1 });
  });

  it('keeps prior metadata warnings partial after resuming and does not reconcile missing files', async () => {
    const f = fixture({ 'root:': { items: [] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.photos.set('old', {
      id: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    let failing = true;
    f.drive.getContentStream = async () => ({
      stream: Readable.from('{bad'),
      contentType: 'application/json',
    });
    f.drive.listChildren = async (_: any, _folder: string, cursor?: string) => {
      if (cursor && failing) throw new DriveRequestError(503, 'temporary', 0);
      return cursor ? { items: [image('a')] } : { items: [sidecar('bad')], nextCursor: 'next' };
    };
    await expect(f.service.execute('run')).rejects.toThrow('temporary');
    f.run.checkpoint = JSON.parse(JSON.stringify(f.run.checkpoint));
    failing = false;
    await f.service.execute('run');
    expect(f.run).toMatchObject({ status: 'PARTIAL', issueCount: 1 });
    expect(f.photos.get('old').status).toBe('ACTIVE');
  });

  it('never matches metadata from a different folder', async () => {
    const f = fixture({
      'root:': {
        items: [
          sidecar('json'),
          {
            id: 'child',
            name: 'Child',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['root'],
          },
        ],
      },
      'child:': { items: [image('a')] },
    });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.drive.getContentStream = async () => metadataStream();
    await f.service.execute('run');
    expect(f.photos.get('a').takeoutMatchStatus).toBe('TAKEOUT_NOT_FOUND');
  });

  it('stops safely at the metadata budget without matching an incomplete folder', async () => {
    const f = fixture({ 'root:': { items: [sidecar('json'), image('a')] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.run.checkpoint = {
      pendingFolders: [
        {
          id: 'root',
          path: ['Family archive'],
          takeout: {
            candidates: [],
            complete: false,
            bytes: 8 * 1024 * 1024,
          },
        },
      ],
      seenFolders: [],
    };
    f.drive.getContentStream = async () => metadataStream();
    await f.service.execute('run');
    expect(f.run.status).toBe('PARTIAL');
    expect(f.photos.size).toBe(0);
    expect(f.issues[0].code).toBe('LIMIT_REACHED');
  });

  it('retries sidecar transport failures without recording malformed JSON or losing candidates', async () => {
    const f = fixture({ 'root:': { items: [image('a'), sidecar('json')] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    let failing = true;
    f.drive.getContentStream = async () => {
      if (failing) throw new DriveRequestError(503, 'temporary', 0);
      return metadataStream();
    };
    await expect(f.service.execute('run')).rejects.toThrow('temporary');
    expect(f.issues).toHaveLength(0);
    expect(f.photos.size).toBe(0);
    f.run.checkpoint = JSON.parse(JSON.stringify(f.run.checkpoint));
    failing = false;
    await f.service.execute('run');
    expect(f.photos.get('a').takeoutMatchStatus).toBe('TAKEOUT_MATCHED');
    expect(f.run).toMatchObject({ status: 'SUCCEEDED', issueCount: 0, indexedCount: 1 });
  });

  it('preserves the metadata page when a sidecar stream breaks and resumes with all candidates', async () => {
    const f = fixture({
      'root:': { items: [sidecar('first', 'b.jpg.json')], nextCursor: 'next' },
      'root:next': { items: [sidecar('second'), image('a')] },
    });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    f.photos.set('old', {
      id: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    let failing = true;
    const reads: Record<string, number> = {};
    const streams: Readable[] = [];
    (f.drive as DriveAdapter).getContentStream = async (_connection, id) => {
      reads[id] = (reads[id] ?? 0) + 1;
      if (id !== 'second' || !failing) return metadataStream();
      const stream = Readable.from(
        (async function* () {
          yield '{"title":"a.jpg",';
          throw new Error('Connection reset while reading the body');
        })(),
      );
      streams.push(stream);
      return { stream, contentType: 'application/json' };
    };
    await expect(f.service.execute('run')).rejects.toMatchObject({ status: 503 });
    expect(reads).toEqual({ first: 1, second: 3 });
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
    expect(f.issues).toHaveLength(0);
    expect(f.photos.has('a')).toBe(false);
    expect(f.photos.get('old').status).toBe('ACTIVE');
    f.run.checkpoint = JSON.parse(JSON.stringify(f.run.checkpoint));
    expect(f.run.checkpoint.pendingFolders[0].takeout).toMatchObject({
      cursor: 'next',
      complete: false,
      candidates: [{ fileName: 'b.jpg.json' }],
    });
    failing = false;
    await new SyncService(f.prisma, f.drive, new PhotoDateResolver()).execute('run');
    expect(reads).toEqual({ first: 1, second: 4 });
    expect(f.photos.get('a').takeoutMatchStatus).toBe('TAKEOUT_MATCHED');
    expect(f.run).toMatchObject({ status: 'SUCCEEDED', issueCount: 0, indexedCount: 1 });
  });

  it('keeps oversized sidecars invalid rather than retrying them as transport failures', async () => {
    const f = fixture({ 'root:': { items: [sidecar('large'), image('a')] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    let reads = 0;
    const stream = Readable.from(Buffer.alloc(1024 * 1024 + 1));
    f.drive.getContentStream = async () => {
      reads++;
      return { stream, contentType: 'application/json' };
    };
    await f.service.execute('run');
    expect(reads).toBe(1);
    expect(stream.destroyed).toBe(true);
    expect(f.issues).toMatchObject([{ code: 'INVALID_TAKEOUT_JSON' }]);
    expect(f.run.status).toBe('PARTIAL');
  });

  it('processes every paginated item and reconciles only after a complete successful scan', async () => {
    const f = fixture({
      'root:': { items: [image('a')], nextCursor: 'next' },
      'root:next': { items: [image('b')] },
    });
    f.photos.set('old', {
      id: 'old',
      driveFileId: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    f.folders.set('old-folder', {
      id: 'old-folder',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    await f.service.execute('run');
    expect(f.run).toMatchObject({
      status: 'SUCCEEDED',
      foundCount: 2,
      processedCount: 2,
      indexedCount: 2,
    });
    expect(f.photos.get('old').status).toBe('MISSING');
    expect(f.folders.get('old-folder').status).toBe('MISSING');
  });

  it('resumes a durable page checkpoint after a transient failure without marking missing', async () => {
    const f = fixture({
      'root:': { items: [image('a')], nextCursor: 'next' },
      'root:next': { items: [image('b')] },
    });
    let failures = 3;
    f.drive.listChildren = async (_: any, folder: string, cursor?: string) => {
      if (cursor === 'next' && failures--) throw new DriveRequestError(503, 'temporary');
      return (
        {
          'root:': { items: [image('a')], nextCursor: 'next' },
          'root:next': { items: [image('b')] },
        } as any
      )[`${folder}:${cursor ?? ''}`];
    };
    f.photos.set('old', {
      id: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    f.folders.set('old-folder', {
      id: 'old-folder',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    await expect(f.service.execute('run')).rejects.toThrow('temporary');
    await f.service.execute('run');
    expect(f.run.status).toBe('SUCCEEDED');
    expect(f.run.indexedCount).toBe(2);
    expect(f.photos.get('old').status).toBe('MISSING');
  });

  it('does not reconcile after a permanent access failure', async () => {
    const f = fixture({ 'root:': { items: [] } });
    f.drive.listChildren = async () => {
      throw new DriveRequestError(403, 'forbidden');
    };
    f.photos.set('old', {
      id: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    f.folders.set('old-folder', {
      id: 'old-folder',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    await f.service.execute('run');
    expect(f.run.status).toBe('FAILED');
    expect(f.photos.get('old').status).toBe('ACTIVE');
    expect(f.folders.get('old-folder').status).toBe('ACTIVE');
  });

  it('does not mark the archive missing when Drive returns 404 for the configured root', async () => {
    const f = fixture({ 'root:': { items: [] } });
    f.drive.getFolder = async () => {
      throw new DriveRequestError(404, 'not found or inaccessible');
    };
    f.photos.set('old', {
      id: 'old',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });
    f.folders.set('old-folder', {
      id: 'old-folder',
      sourceId: 'source',
      status: 'ACTIVE',
      lastSeenSyncRunId: 'previous',
    });

    await f.service.execute('run');

    expect(f.run.status).toBe('FAILED');
    expect(f.photos.get('old').status).toBe('ACTIVE');
    expect(f.folders.get('old-folder').status).toBe('ACTIVE');
  });

  it('keeps an issue pending after a partial scan and resolves it after a later complete scan', async () => {
    const f = fixture({ 'root:': { items: [sidecar('broken')] } });
    f.run.source.type = 'GOOGLE_TAKEOUT';
    let includeBrokenSidecar = true;
    f.drive.getContentStream = async () => ({
      stream: Readable.from('{bad'),
      contentType: 'application/json',
    });
    f.drive.listChildren = async () => ({
      items: includeBrokenSidecar ? [sidecar('broken')] : [image('photo')],
    });

    await f.service.execute('run');

    expect(f.run.status).toBe('PARTIAL');
    expect(f.issues).toHaveLength(1);
    expect(f.issues[0]).toMatchObject({
      code: 'INVALID_TAKEOUT_JSON',
      driveFileId: 'broken',
      resolvedAt: null,
    });

    includeBrokenSidecar = false;
    f.run.id = 'run-2';
    f.run.status = 'QUEUED';
    f.run.checkpoint = null;
    f.run.issueCount = 0;
    await f.service.execute('run-2');

    expect(f.run.status).toBe('SUCCEEDED');
    expect(f.issues[0].resolvedAt).toBeInstanceOf(Date);
  });

  it('updates a moved file by driveFileId and keeps its override', async () => {
    const f = fixture({ 'root:': { items: [image('moved', 'new-name.jpg')] } });
    f.photos.set('moved', {
      id: 'moved',
      driveFileId: 'moved',
      sourceId: 'old-source',
      fileName: 'old.jpg',
      status: 'ACTIVE',
      override: { id: 'override' },
      lastSeenSyncRunId: 'previous',
    });
    await f.service.execute('run');
    expect(f.photos).toHaveLength(1);
    expect(f.photos.get('moved')).toMatchObject({
      sourceId: 'source',
      fileName: 'new-name.jpg',
      override: { id: 'override' },
    });
  });

  it('persists root and descendant hierarchy with current names and paths', async () => {
    const folder = (id: string, name: string, parent: string): DriveItem => ({
      id,
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    });
    const f = fixture({
      'root:': { items: [folder('child', 'Child', 'root')] },
      'child:': { items: [image('inside')] },
    });
    await f.service.execute('run');
    expect(f.folders.get('root')).toMatchObject({ path: ['Family archive'], parentId: null });
    expect(f.folders.get('child')).toMatchObject({ path: ['Family archive', 'Child'] });
    expect(f.photos.get('inside').folderId).toBe('child');
  });

  it('updates a folder rename and move by stable Drive ID', async () => {
    const child = (name: string, parent: string): DriveItem => ({
      id: 'stable-folder',
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parent],
    });
    const pages: Record<string, { items: DriveItem[] }> = {
      'root:': { items: [child('Before', 'root')] },
      'stable-folder:': { items: [] },
    };
    const f = fixture(pages);
    await f.service.execute('run');
    expect(f.folders.get('stable-folder').path).toEqual(['Family archive', 'Before']);
    f.run.status = 'QUEUED';
    f.run.checkpoint = null;
    f.run.foundCount = 0;
    f.run.processedCount = 0;
    f.run.indexedCount = 0;
    f.run.issueCount = 0;
    pages['root:'] = { items: [child('After', 'root')] };
    await f.service.execute('run');
    expect(f.folders.get('stable-folder')).toMatchObject({
      name: 'After',
      path: ['Family archive', 'After'],
    });
  });

  it('does not recreate an excluded Drive file', async () => {
    const f = fixture({ 'root:': { items: [image('removed')] } });
    f.exclusions.add('removed');
    await f.service.execute('run');
    expect(f.photos.has('removed')).toBe(false);
    expect(f.run.status).toBe('SUCCEEDED');
  });

  it('reindexes a restored exclusion and preserves its manual date correction', async () => {
    const f = fixture({ 'root:': { items: [image('restored')] } });
    f.restoredExclusions.set('restored', {
      id: 'exclusion-restored',
      restoredAt: new Date('2026-10-14T00:00:00.000Z'),
      manualDateValue: new Date('2001-01-01T00:00:00.000Z'),
      manualDatePrecision: 'YEAR',
      manualDateReason: 'Family note',
    });

    await f.service.execute('run');

    expect(f.photos.get('restored')).toMatchObject({
      effectiveDateValue: new Date('2001-01-01T00:00:00.000Z'),
      effectiveDatePrecision: 'YEAR',
      effectiveDateSource: 'MANUAL',
      override: {
        dateValue: new Date('2001-01-01T00:00:00.000Z'),
        precision: 'YEAR',
        reason: 'Family note',
      },
    });
    expect(f.restoredExclusions.has('restored')).toBe(false);
  });

  it('includes the selected root folder name in folder-date evidence', async () => {
    const f = fixture({ 'root:': { items: [image('dated')] } });
    f.drive.getFolder = async () => ({
      id: 'root',
      name: '1998',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [],
    });
    await f.service.execute('run');
    expect(f.photos.get('dated')).toMatchObject({
      detectedSource: 'FOLDER',
      detectedPrecision: 'YEAR',
      detectedDate: new Date('1998-01-01T00:00:00.000Z'),
    });
  });
});
