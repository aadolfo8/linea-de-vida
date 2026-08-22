import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { DriveAdapter } from '../src/drive';
import { SyncService } from '../src/sync.service';

describe('Takeout sync integration', () => {
  it('indexes matched and unmatched photos, preserving validated metadata and invalid-JSON issues', async () => {
    const created: any[] = [];
    const issues: any[] = [];
    class TakeoutDrive extends DriveAdapter {
      async listChildren() {
        return {
          items: [
            { id: 'photo', name: 'sunset.jpg', mimeType: 'image/jpeg', parents: [] },
            { id: 'no-json', name: 'missing.jpg', mimeType: 'image/jpeg', parents: [] },
            { id: 'json', name: 'sunset.jpg.json', mimeType: 'application/json', parents: [] },
            { id: 'broken', name: 'broken.json', mimeType: 'application/json', parents: [] },
          ],
        };
      }
      async getFolder() {
        return null;
      }
      async getThumbnailStream() {
        return { stream: Readable.from(''), contentType: 'image/jpeg' };
      }
      async getContentStream(_: any, id: string) {
        const text =
          id === 'json'
            ? '{"title":"sunset.jpg","photoTakenTime":{"timestamp":"1704067200"},"geoData":{"latitude":40,"longitude":-3}}'
            : '{';
        return { stream: Readable.from(text), contentType: 'application/json' };
      }
    }
    const prisma: any = {
      syncRun: {
        findUnique: async () => ({
          id: 'run',
          source: {
            id: 'source',
            userId: 'owner',
            driveFolderId: 'root',
            type: 'GOOGLE_TAKEOUT',
            connection: { refreshTokenCiphertext: null },
          },
        }),
        update: async () => undefined,
      },
      syncIssue: { create: async ({ data }: any) => issues.push(data) },
      photo: {
        findUnique: async () => null,
        create: async ({ data }: any) => created.push(data),
        updateMany: async () => ({ count: 0 }),
      },
      $transaction: async (operation: any) => operation(prisma),
    };
    await new SyncService(prisma, new TakeoutDrive(), new PhotoDateResolver()).execute('run');
    expect(created).toHaveLength(2);
    expect(created.find((photo) => photo.driveFileId === 'photo')).toMatchObject({
      detectedSource: 'TAKEOUT',
      takeoutMatchStatus: 'TAKEOUT_MATCHED',
      gpsLatitude: 40,
    });
    expect(created.find((photo) => photo.driveFileId === 'no-json')).toMatchObject({
      takeoutMatchStatus: 'TAKEOUT_NOT_FOUND',
      detectedSource: 'NONE',
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TAKEOUT_JSON', driveFileId: 'broken' }),
    );
  });
});
