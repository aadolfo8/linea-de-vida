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
  const prisma: any = {
    syncRun: {
      findUnique: async () => run,
      update: async ({ data }: any) => Object.assign(run, data),
      findFirst: async () => null,
      create: async () => run,
    },
    syncIssue: { create: async ({ data }: any) => issues.push(data) },
    photoExclusion: {
      findUnique: async ({ where }: any) =>
        exclusions.has(where.userId_driveFileId.driveFileId) ? { id: 'excluded' } : null,
    },
    indexedFolder: {
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
      create: async ({ data }: any) =>
        photos.set(data.driveFileId, { ...data, id: data.driveFileId, override: null }),
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
    prisma,
    drive,
    service: new SyncService(prisma, drive, new PhotoDateResolver()),
  };
}

describe('robust sync', () => {
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
