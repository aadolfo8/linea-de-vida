/**
 * Runs the content-identity, soft-hide and ordering flows against a real PostgreSQL, where the
 * in-memory test double cannot vouch for SQL semantics (unique keys, NULL ordering, relation
 * filters, cascades). Skipped unless TEST_DATABASE_URL points at a database with every migration
 * applied (`prisma migrate deploy`), for example a throwaway container:
 *
 *   docker run -d -p 54329:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=lv postgres:14.4
 *   DATABASE_URL=postgresql://postgres:pw@localhost:54329/lv pnpm --filter @linea-de-vida/api prisma:deploy
 *   TEST_DATABASE_URL=postgresql://postgres:pw@localhost:54329/lv pnpm --filter @linea-de-vida/api test
 */
import { PrismaClient } from '@prisma/client';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { DriveAdapter, DriveItem } from '../src/drive';
import { FolderDateRuleService } from '../src/folder-date-rule.service';
import { ManualDateService } from '../src/manual-date.service';
import { OrderingService } from '../src/ordering.service';
import { PhotoVisibilityService } from '../src/photo-visibility.service';
import { SyncService } from '../src/sync.service';

const url = process.env.TEST_DATABASE_URL;
const FOLDER = 'application/vnd.google-apps.folder';
const folder = (id: string, name: string): DriveItem => ({
  id,
  name,
  mimeType: FOLDER,
  parents: [],
});
const image = (id: string, md5: string, name = `${id}.jpg`): DriveItem => ({
  id,
  name,
  mimeType: 'image/jpeg',
  parents: [],
  md5Checksum: md5,
  size: '1000',
});

class TreeDrive extends DriveAdapter {
  tree: Record<string, DriveItem[]> = {};
  async listChildren(_: unknown, folderId: string) {
    return { items: this.tree[folderId] ?? [] };
  }
  async getFolder(_: unknown, id: string) {
    return { id, name: 'Archive', mimeType: FOLDER, parents: [] };
  }
  async getThumbnailStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
  async getContentStream() {
    return { stream: Readable.from(''), contentType: 'image/jpeg' };
  }
}

describe.skipIf(!url)('PostgreSQL integration', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: url! } } });
  const drive = new TreeDrive();
  const sync = new SyncService(prisma as any, drive, new PhotoDateResolver());
  const ordering = new OrderingService(prisma as any);
  const visibility = new PhotoVisibilityService(prisma as any);
  const manual = new ManualDateService(prisma as any);
  const folderDates = new FolderDateRuleService(prisma as any);
  let userId: string;
  let sourceId: string;

  const runSync = async (tree: Record<string, DriveItem[]>) => {
    drive.tree = tree;
    const run = await prisma.syncRun.create({ data: { photoSourceId: sourceId } });
    await sync.execute(run.id);
    return prisma.syncRun.findUniqueOrThrow({ where: { id: run.id } });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'it-postgres@example.test' } });
    const user = await prisma.user.create({
      data: { email: 'it-postgres@example.test', displayName: 'IT' },
    });
    userId = user.id;
    const connection = await prisma.oAuthConnection.create({
      data: { userId, provider: 'google', googleAccountId: 'it', grantedScopes: [] },
    });
    const source = await prisma.photoSource.create({
      data: {
        userId,
        oauthConnectionId: connection.id,
        driveFolderId: 'root',
        name: 'Takeout',
        type: 'GENERIC',
      },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'it-postgres@example.test' } });
    await prisma.$disconnect();
  });

  it('re-importing an export adds only new photos; deleting the old export keeps them all', async () => {
    const first = await runSync({
      root: [folder('t1', 'Takeout')],
      t1: [
        image('a1', 'aaa', 'IMG-20190812-WA0001.jpg'),
        image('b1', 'bbb', 'IMG_20200101_101010.jpg'),
        image('n1', 'nnn', 'plain.jpg'),
      ],
    });
    expect(first).toMatchObject({ status: 'SUCCEEDED', indexedCount: 3 });
    expect(await prisma.photo.count({ where: { userId } })).toBe(3);

    const second = await runSync({
      root: [folder('t1', 'Takeout'), folder('t2', 'Takeout 2')],
      t1: [
        image('a1', 'aaa', 'IMG-20190812-WA0001.jpg'),
        image('b1', 'bbb', 'IMG_20200101_101010.jpg'),
        image('n1', 'nnn', 'plain.jpg'),
      ],
      t2: [
        image('a2', 'aaa', 'IMG-20190812-WA0001.jpg'),
        image('n2', 'nnn', 'plain.jpg'),
        image('c2', 'ccc', 'new.jpg'),
      ],
    });
    expect(second).toMatchObject({ status: 'SUCCEEDED', removedCount: 0 });
    expect(await prisma.photo.count({ where: { userId } })).toBe(4);
    expect(await prisma.photoFile.count({ where: { userId } })).toBe(6);

    const third = await runSync({
      root: [folder('t2', 'Takeout 2')],
      t2: [
        image('a2', 'aaa', 'IMG-20190812-WA0001.jpg'),
        image('n2', 'nnn', 'plain.jpg'),
        image('c2', 'ccc', 'new.jpg'),
      ],
    });
    // b1 only ever lived in the deleted export: it is the single photo that goes missing.
    expect(third).toMatchObject({ status: 'SUCCEEDED', removedCount: 1 });
    const statuses = Object.fromEntries(
      (await prisma.photo.findMany({ where: { userId } })).map((photo) => [
        photo.contentKey,
        photo.status,
      ]),
    );
    expect(statuses).toEqual({
      'md5:aaa:1000': 'ACTIVE',
      'md5:bbb:1000': 'MISSING',
      'md5:nnn:1000': 'ACTIVE',
      'md5:ccc:1000': 'ACTIVE',
    });
    const a = await prisma.photo.findFirstOrThrow({
      where: { userId, contentKey: 'md5:aaa:1000' },
    });
    expect(a).toMatchObject({ driveFileId: 'a2', detectedSource: 'FILENAME' });
  });

  it('hides softly, keeps the pile counts right and restores immediately', async () => {
    const photos = await prisma.photo.findMany({ where: { userId, status: 'ACTIVE' } });
    const plain = photos.find((photo) => photo.fileName === 'plain.jpg')!;
    expect(await ordering.piles(userId, {})).toMatchObject({ undated: 2, dated: 1, hidden: 0 });

    await visibility.hide(userId, [plain.id]);
    expect(await ordering.piles(userId, {})).toMatchObject({ undated: 1, dated: 1, hidden: 1 });
    const hidden = await ordering.photos(userId, { pile: 'hidden' });
    expect(hidden.items.map((item) => item.id)).toEqual([plain.id]);

    // A new copy of hidden content joins the hidden photo.
    await runSync({
      root: [folder('t2', 'Takeout 2'), folder('t3', 'Takeout 3')],
      t2: [
        image('a2', 'aaa', 'IMG-20190812-WA0001.jpg'),
        image('n2', 'nnn', 'plain.jpg'),
        image('c2', 'ccc', 'new.jpg'),
      ],
      t3: [image('n3', 'nnn', 'plain.jpg')],
    });
    expect(
      (await prisma.photo.findUniqueOrThrow({ where: { id: plain.id } })).hiddenAt,
    ).not.toBeNull();
    expect(await prisma.photo.count({ where: { userId, contentKey: 'md5:nnn:1000' } })).toBe(1);

    await visibility.unhide(userId, [plain.id]);
    expect(await ordering.piles(userId, {})).toMatchObject({ undated: 2, hidden: 0 });
  });

  it('builds the folder tree and pages every pile without gaps, NULLs last', async () => {
    const tree = await ordering.folderTree(userId, sourceId);
    expect(tree.items[0]).toMatchObject({ name: 'Archive' });
    const names = tree.items[0]!.children.map((child) => child.name);
    expect(names).toEqual(['Takeout 2', 'Takeout 3']);
    expect(tree.totals.photoCount).toBeGreaterThanOrEqual(3);

    const everything = await ordering.piles(userId, {});
    const ids: string[] = [];
    for (const pile of ['undated', 'yearOnly', 'dated', 'hidden'] as const) {
      let cursor: string | undefined;
      do {
        const page = await ordering.photos(userId, { pile, limit: '1', cursor });
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(everything.total + everything.hidden);

    const photos = await prisma.photo.findMany({ where: { userId, status: 'ACTIVE' } });
    await visibility.hide(
      userId,
      photos.map((photo) => photo.id),
    );
    const hidden: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await ordering.photos(userId, {
        pile: 'hidden',
        order: 'newest',
        limit: '1',
        cursor,
      });
      hidden.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(hidden.length).toBe(photos.length);
    await visibility.unhide(
      userId,
      photos.map((photo) => photo.id),
    );
  });

  it('sets, clears and suggests dates through real queries', async () => {
    const photos = await prisma.photo.findMany({ where: { userId, status: 'ACTIVE' } });
    const plain = photos.find((photo) => photo.fileName === 'plain.jpg')!;
    expect(
      (await manual.setMany(userId, [plain.id], { year: 2001, month: 2, precision: 'MONTH' }))
        .updatedCount,
    ).toBe(1);
    expect(await ordering.piles(userId, {})).toMatchObject({ dated: 2 });
    expect((await manual.clearMany(userId, [plain.id])).clearedCount).toBe(1);
    expect(await prisma.photo.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({
      effectiveDateSource: 'NONE',
    });

    // A photo indexed before file-name dates existed shows up as a suggestion and is dated.
    await prisma.photo.update({
      where: { id: plain.id },
      data: { fileName: 'IMG-20180304-WA0009.jpg' },
    });
    const suggestions = await ordering.filenameSuggestions(userId, {});
    expect(suggestions.groups).toMatchObject([{ kind: 'whatsapp', photoCount: 1 }]);
    expect(await ordering.acceptFilenameSuggestions(userId, {})).toEqual({ appliedCount: 1 });
    expect(await prisma.photo.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({
      detectedSource: 'FILENAME',
      effectiveDatePrecision: 'DAY',
    });
  });

  it('applies a simple folder date with its flags and counts only visible photos', async () => {
    const takeout2 = await prisma.indexedFolder.findFirstOrThrow({
      where: { userId, name: 'Takeout 2' },
    });
    const preview = await folderDates.previewSimple(userId, takeout2.id, {
      dateValue: new Date('2005-01-01'),
      precision: 'YEAR',
      includeSubfolders: true,
      overrideCameraDates: true,
    });
    expect(preview.scopePhotoCount).toBeGreaterThan(0);
    const result = await folderDates.setSimple(userId, takeout2.id, {
      dateValue: new Date('2005-01-01'),
      precision: 'YEAR',
      includeSubfolders: true,
      overrideCameraDates: true,
    });
    expect(result.rule).toMatchObject({ scope: 'ALL_DESCENDANTS', overrideCameraDates: true });
    expect(await ordering.piles(userId, { folderId: takeout2.id })).toMatchObject({ yearOnly: 3 });
    await folderDates.remove(userId, takeout2.id);
  });
});
