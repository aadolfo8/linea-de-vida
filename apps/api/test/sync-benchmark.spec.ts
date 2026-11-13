import { PrismaClient } from '@prisma/client';
import { Readable } from 'node:stream';
import { describe, it } from 'vitest';
import { DriveAdapter, DriveItem } from '../src/drive';
import { PhotoDateResolver } from '../src/date-resolver';
import { SyncService } from '../src/sync.service';

const url = process.env.TEST_DATABASE_URL;
class Drive extends DriveAdapter {
  async listChildren(_: unknown, folderId: string, cursor?: string) {
    if (folderId !== 'root') return { items: [] };
    const start = Number(cursor ?? 0);
    const items: DriveItem[] = Array.from({ length: 100 }, (_, i) => ({
      id: `d${start + i}`,
      name: `IMG_2020${String((i % 12) + 1).padStart(2, '0')}15_1010${i % 60}.jpg`,
      mimeType: 'image/jpeg',
      parents: [],
      md5Checksum: `m${start + i}`,
      size: '1000',
    }));
    return { items, nextCursor: start + 100 < 2000 ? String(start + 100) : undefined };
  }
  async getFolder(_: unknown, id: string) {
    return { id, name: 'A', mimeType: 'application/vnd.google-apps.folder', parents: [] };
  }
  async getThumbnailStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
  async getContentStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
}
// Opt-in: BENCH=1 TEST_DATABASE_URL=... pnpm --filter @linea-de-vida/api exec vitest run test/sync-benchmark.spec.ts
describe.skipIf(!url || !process.env.BENCH)('sync benchmark', () => {
  it('2000 photos', async () => {
    const prisma = new PrismaClient({
      datasources: { db: { url } },
      log: [{ emit: 'event', level: 'query' }],
    });
    let queries = 0;
    (prisma as any).$on('query', () => queries++);
    await prisma.user.deleteMany({ where: { email: 'bench@x.test' } });
    const user = await prisma.user.create({ data: { email: 'bench@x.test', displayName: 'B' } });
    const c = await prisma.oAuthConnection.create({
      data: { userId: user.id, provider: 'google', googleAccountId: 'b', grantedScopes: [] },
    });
    const s = await prisma.photoSource.create({
      data: {
        userId: user.id,
        oauthConnectionId: c.id,
        driveFolderId: 'root',
        name: 'B',
        type: 'GENERIC',
      },
    });
    const sync = new SyncService(prisma as any, new Drive(), new PhotoDateResolver());
    for (const label of ['first scan (2000 new)', 'second scan (2000 unchanged)']) {
      const run = await prisma.syncRun.create({ data: { photoSourceId: s.id } });
      queries = 0;
      const t = Date.now();
      await sync.execute(run.id);
      console.log(
        `BENCH ${label}: ${Date.now() - t} ms, ${queries} queries, ${(queries / 20).toFixed(1)} per page of 100`,
      );
    }
    await prisma.user.deleteMany({ where: { email: 'bench@x.test' } });
    await prisma.$disconnect();
  }, 300000);
});
