import { Readable } from 'node:stream';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { DriveAdapter } from '../src/drive';
import { SyncService } from '../src/sync.service';
import { dropUsers, pgClient, pgUrl, resetUsers } from './support/pg';

const P = 'tk';

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
  async getContentStream(_: unknown, id: string) {
    const text =
      id === 'json'
        ? '{"title":"sunset.jpg","photoTakenTime":{"timestamp":"1704067200"},"geoData":{"latitude":40,"longitude":-3}}'
        : '{';
    return { stream: Readable.from(text), contentType: 'application/json' };
  }
}

describe.skipIf(!pgUrl)('Takeout sync integration (PostgreSQL)', () => {
  const prisma = pgClient();

  beforeEach(async () => {
    await resetUsers(prisma, P);
    await prisma.photoSource.update({
      where: { id: `${P}-source` },
      data: { type: 'GOOGLE_TAKEOUT' },
    });
  });
  afterAll(async () => {
    await dropUsers(prisma, P);
    await prisma.$disconnect();
  });

  it('indexes matched and unmatched photos, preserving validated metadata and invalid-JSON issues', async () => {
    const run = await prisma.syncRun.create({ data: { photoSourceId: `${P}-source` } });
    await new SyncService(prisma as any, new TakeoutDrive(), new PhotoDateResolver()).execute(
      run.id,
    );

    const created = await prisma.photo.findMany({ where: { userId: `${P}-owner` } });
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
    const issues = await prisma.syncIssue.findMany({ where: { syncRunId: run.id } });
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TAKEOUT_JSON', driveFileId: 'broken' }),
    );
  });
});
