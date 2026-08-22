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
  const prisma: any = {
    syncRun: {
      findUnique: async () => run,
      update: async ({ data }: any) => Object.assign(run, data),
      findFirst: async () => null,
      create: async () => run,
    },
    syncIssue: { create: async ({ data }: any) => issues.push(data) },
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
    $transaction: async (operation: any) => operation(prisma),
  };
  class FakeDrive extends DriveAdapter {
    calls = 0;
    async listChildren(_: any, folder: string, cursor?: string) {
      this.calls++;
      return pages[`${folder}:${cursor ?? ''}`]!;
    }
    async getFolder() {
      return null;
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
    await f.service.execute('run');
    expect(f.run).toMatchObject({
      status: 'SUCCEEDED',
      foundCount: 2,
      processedCount: 2,
      indexedCount: 2,
    });
    expect(f.photos.get('old').status).toBe('MISSING');
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
    await f.service.execute('run');
    expect(f.run.status).toBe('FAILED');
    expect(f.photos.get('old').status).toBe('ACTIVE');
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
});
