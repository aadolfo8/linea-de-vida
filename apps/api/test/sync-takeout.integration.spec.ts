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
        return {
          id: 'root',
          name: 'Takeout root',
          mimeType: 'application/vnd.google-apps.folder',
          parents: [],
        };
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
          foundCount: 0,
          processedCount: 0,
          indexedCount: 0,
          issueCount: 0,
          checkpoint: null,
        }),
        update: async () => undefined,
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
            if (issue.resolvedAt === where.resolvedAt) Object.assign(issue, data);
        },
      },
      photoExclusion: { findUnique: async () => null },
      indexedFolder: {
        findUnique: async () => null,
        upsert: async () => ({ id: 'indexed-root' }),
        updateMany: async () => ({ count: 0 }),
      },
      photo: {
        findUnique: async () => null,
        create: async ({ data }: any) => created.push(data),
        updateMany: async () => ({ count: 0 }),
      },
      $transaction: async (operation: any) =>
        Array.isArray(operation) ? Promise.all(operation) : operation(prisma),
    };
    await new SyncService(prisma, new TakeoutDrive(), new PhotoDateResolver()).execute('run');
    expect(created).toHaveLength(2);
    expect(created.find((photo) => photo.driveFileId === 'photo')).toMatchObject({
      detectedSource: 'TAKEOUT',
      detectedPrecision: 'DAY',
      effectiveDatePrecision: 'DAY',
      takeoutMatchStatus: 'TAKEOUT_MATCHED',
      gpsLatitude: 40,
    });
    expect(created.find((photo) => photo.driveFileId === 'no-json')).toMatchObject({
      takeoutMatchStatus: 'TAKEOUT_NOT_FOUND',
      detectedSource: 'NONE',
      detectedPrecision: 'UNKNOWN',
      effectiveDatePrecision: 'UNKNOWN',
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TAKEOUT_JSON', driveFileId: 'broken' }),
    );
  });
});
