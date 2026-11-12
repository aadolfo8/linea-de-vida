import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { TimelineController } from '../src/timeline.controller';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { DriveAdapter, MemoryDriveProvider } from '../src/drive';
import { GoogleOAuthClient, OAuthStateService } from '../src/oauth';
import { PrismaService } from '../src/prisma.service';
import { SyncService } from '../src/sync.service';
import { ManualDateService } from '../src/manual-date.service';
import { MediaProxyService } from '../src/media-proxy.service';
import { FolderDateRuleService } from '../src/folder-date-rule.service';
import { PhotoVisibilityService } from '../src/photo-visibility.service';

type Row = {
  id: string;
  userId: string;
  status: string;
  date: Date;
  precision: 'YEAR' | 'MONTH' | 'DAY';
  hiddenAt?: Date | null;
};

const photo = (
  id: string,
  date: string,
  precision: Row['precision'] = 'DAY',
  userId = 'owner',
  status = 'ACTIVE',
): Row => ({ id, userId, status, date: new Date(date), precision });

// Emulates the single month-previews query: scoping, per-group count (chosen covers included) and
// one photo per NTILE bucket among the photos that are not already chosen.
function emulateQuery(photos: Row[], userId: string, start: Date, end: Date, chosen: string[]) {
  const scoped = photos
    .filter(
      (p) =>
        p.userId === userId &&
        p.status === 'ACTIVE' &&
        !p.hiddenAt &&
        p.date >= start &&
        p.date < end,
    )
    .map((p) => ({ ...p, month: p.precision === 'YEAR' ? null : p.date.getUTCMonth() + 1 }));
  const groups = new Map<number | null, typeof scoped>();
  for (const p of scoped) groups.set(p.month, [...(groups.get(p.month) ?? []), p]);
  const rows: { month: number | null; photoCount: bigint; id: string | null }[] = [];
  const keys = [...groups.keys()].sort((a, b) => (a ?? 99) - (b ?? 99));
  for (const key of keys) {
    const all = groups.get(key)!;
    const ordered = all
      .filter((p) => !chosen.includes(p.id))
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
    const buckets = Math.min(6, ordered.length);
    const seen = new Set<number>();
    ordered.forEach((p, index) => {
      const bucket = Math.floor((index * buckets) / ordered.length);
      if (seen.has(bucket)) return;
      seen.add(bucket);
      rows.push({ month: key, photoCount: BigInt(all.length), id: p.id });
    });
    if (!ordered.length) rows.push({ month: key, photoCount: BigInt(all.length), id: null });
  }
  return rows;
}

describe('GET /v1/timeline/years/:year/month-previews', () => {
  let app: INestApplication;
  let photos: Row[] = [];
  const queries: unknown[][] = [];
  let covers: {
    userId: string;
    kind: string;
    year: number;
    month: number;
    photoId: string;
    position: number;
  }[] = [];
  const record = (p: Row) => ({
    id: p.id,
    userId: p.userId,
    status: p.status,
    hiddenAt: p.hiddenAt ?? null,
    fileName: `${p.id}.jpg`,
    mimeType: 'image/jpeg',
    imageMetadata: null,
    effectiveDateValue: p.date,
    effectiveDatePrecision: p.precision,
  });
  const prisma: any = {
    $queryRawUnsafe: async (_query: string, ...args: any[]) => {
      queries.push(args);
      return emulateQuery(photos, args[0], args[1], args[2], args[3] ?? []);
    },
    photo: {
      findMany: async ({ where }: any) =>
        photos.filter((p) => p.userId === where.userId && where.id.in.includes(p.id)).map(record),
    },
    photoCover: {
      findMany: async ({ where }: any) =>
        covers
          .filter((c) => c.userId === where.userId && c.year === where.year)
          .sort((a, b) => a.position - b.position)
          .map((c) => ({ ...c, photo: record(photos.find((p) => p.id === c.photoId)!) })),
    },
  };

  async function createApp(userId = 'owner') {
    app = await (
      await Test.createTestingModule({
        controllers: [TimelineController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: SyncService, useValue: {} },
          { provide: ManualDateService, useValue: {} },
          { provide: FolderDateRuleService, useValue: {} },
          { provide: PhotoVisibilityService, useValue: {} },
          MediaProxyService,
          { provide: DriveAdapter, useValue: new MemoryDriveProvider({ root: [] }) },
          { provide: GoogleOAuthClient, useValue: {} },
          { provide: OAuthStateService, useValue: {} },
        ],
      })
        .overrideGuard(SessionGuard)
        .useValue({
          canActivate: (context: any) => {
            context.switchToHttp().getRequest().userId = userId;
            return true;
          },
        })
        .overrideGuard(CsrfGuard)
        .useValue({ canActivate: () => true })
        .compile()
    ).createNestApplication();
    await app.init();
  }

  afterEach(async () => {
    await app?.close();
    photos = [];
    covers = [];
    queries.length = 0;
  });

  it('returns one item per month with photos, then the year-precision group last', async () => {
    photos = [
      photo('a', '2024-03-02T00:00:00.000Z'),
      photo('b', '2024-03-20T00:00:00.000Z', 'MONTH'),
      photo('c', '2024-08-10T00:00:00.000Z'),
      photo('d', '2024-01-01T00:00:00.000Z', 'YEAR'),
      photo('e', '2023-05-05T00:00:00.000Z'),
    ];
    await createApp();
    const { body } = await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/month-previews')
      .expect(200);
    expect(body.year).toBe(2024);
    expect(body.items.map((item: any) => [item.month, item.kind, item.label])).toEqual([
      [3, 'MONTH', null],
      [8, 'MONTH', null],
      [null, 'YEAR', 'Fecha sin concretar'],
    ]);
    expect(body.items.map((item: any) => item.photoCount)).toEqual([2, 1, 1]);
    expect(body.items[0].previews[0]).toMatchObject({
      thumbnailUrl: expect.stringMatching(/^\/v1\/photos\/[ab]\/thumbnail$/),
      mimeType: 'image/jpeg',
      effectiveDate: { precision: expect.any(String) },
    });
  });

  it('omits the year-precision group when absent and returns no items for an empty year', async () => {
    photos = [photo('a', '2024-03-02T00:00:00.000Z')];
    await createApp();
    const { body } = await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/month-previews')
      .expect(200);
    expect(body.items.some((item: any) => item.kind === 'YEAR')).toBe(false);
    await request(app.getHttpServer())
      .get('/v1/timeline/years/2020/month-previews')
      .expect(200)
      .expect(({ body: empty }) => expect(empty).toEqual({ year: 2020, items: [] }));
  });

  it('caps previews at 6 and spreads them across the period instead of taking the newest', async () => {
    photos = Array.from({ length: 30 }, (_, index) =>
      photo(
        `p${String(index).padStart(2, '0')}`,
        `2024-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      ),
    );
    await createApp();
    const { body } = await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/month-previews')
      .expect(200);
    const [june] = body.items;
    expect(june.photoCount).toBe(30);
    expect(june.previews).toHaveLength(6);
    const days = june.previews.map((p: any) => new Date(p.effectiveDate.value).getUTCDate());
    expect(Math.max(...days) - Math.min(...days)).toBeGreaterThan(20);
    expect(Math.min(...days)).toBeLessThanOrEqual(5);
  });

  it('never returns another user or missing photos', async () => {
    photos = [
      photo('mine', '2024-03-02T00:00:00.000Z'),
      photo('theirs', '2024-03-03T00:00:00.000Z', 'DAY', 'other'),
      photo('gone', '2024-04-03T00:00:00.000Z', 'DAY', 'owner', 'MISSING'),
    ];
    await createApp('owner');
    const { body } = await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/month-previews')
      .expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].photoCount).toBe(1);
    expect(body.items[0].previews.map((p: any) => p.id)).toEqual(['mine']);
    expect(queries[0][0]).toBe('owner');
  });

  describe('chosen covers', () => {
    const june = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        photo(
          `p${String(index).padStart(2, '0')}`,
          `2024-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        ),
      );
    const choose = (kind: string, month: number, ...ids: string[]) =>
      ids.forEach((photoId, position) =>
        covers.push({ userId: 'owner', kind, year: 2024, month, photoId, position }),
      );
    const get = async () =>
      (await request(app.getHttpServer()).get('/v1/timeline/years/2024/month-previews').expect(200))
        .body;

    it('puts chosen photos first in the chosen order and fills the rest without repeating them', async () => {
      photos = june(30);
      choose('MONTH', 6, 'p03', 'p01');
      await createApp();
      const [group] = (await get()).items;
      const ids = group.previews.map((p: any) => p.id);
      expect(ids.slice(0, 2)).toEqual(['p03', 'p01']);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
      expect(group.photoCount).toBe(30);
    });

    it('caps a full chosen cover at six and needs no automatic photos', async () => {
      photos = june(10);
      choose('MONTH', 6, 'p09', 'p08', 'p07', 'p06', 'p05', 'p04');
      await createApp();
      const [group] = (await get()).items;
      expect(group.previews.map((p: any) => p.id)).toEqual([
        'p09',
        'p08',
        'p07',
        'p06',
        'p05',
        'p04',
      ]);
    });

    it('keeps a month whose every photo is chosen', async () => {
      photos = june(2);
      choose('MONTH', 6, 'p01', 'p00');
      await createApp();
      const { items } = await get();
      expect(items).toHaveLength(1);
      expect(items[0].previews.map((p: any) => p.id)).toEqual(['p01', 'p00']);
    });

    it('chooses the Sin mes group independently of months', async () => {
      photos = [
        photo('a', '2024-03-02T00:00:00.000Z'),
        photo('y1', '2024-01-01T00:00:00.000Z', 'YEAR'),
        photo('y2', '2024-01-01T00:00:00.000Z', 'YEAR'),
      ];
      choose('UNKNOWN_MONTH', 0, 'y1');
      await createApp();
      const { items } = await get();
      const unknown = items.find((item: any) => item.kind === 'YEAR');
      expect(unknown.previews.map((p: any) => p.id)).toEqual(['y1', 'y2']);
      expect(items.find((item: any) => item.month === 3).previews.map((p: any) => p.id)).toEqual([
        'a',
      ]);
    });

    it('drops a chosen photo that is hidden or re-dated out of the month, and fills the gap', async () => {
      photos = [
        photo('keep', '2024-06-05T00:00:00.000Z'),
        photo('hidden', '2024-06-06T00:00:00.000Z'),
        photo('moved', '2024-07-06T00:00:00.000Z'),
        photo('yearly', '2024-01-01T00:00:00.000Z', 'YEAR'),
        photo('other', '2024-06-20T00:00:00.000Z'),
      ];
      photos[1].hiddenAt = new Date('2026-01-01');
      choose('MONTH', 6, 'hidden', 'moved', 'yearly', 'keep');
      await createApp();
      const group = (await get()).items.find((item: any) => item.month === 6);
      const ids = group.previews.map((p: any) => p.id);
      expect(ids[0]).toBe('keep');
      expect(ids).toEqual(expect.arrayContaining(['keep', 'other']));
      expect(ids).not.toContain('hidden');
      expect(ids).not.toContain('moved');
      expect(ids).not.toContain('yearly');
    });

    it("never uses another user's choice", async () => {
      photos = june(8);
      covers.push({
        userId: 'other',
        kind: 'MONTH',
        year: 2024,
        month: 6,
        photoId: 'p00',
        position: 0,
      });
      await createApp('owner');
      const [group] = (await get()).items;
      expect(group.previews).toHaveLength(6);
      expect(queries[0][3]).toEqual([]);
    });
  });

  it('rejects an invalid year with the sibling error shape', async () => {
    await createApp();
    for (const year of ['1899', '2101', 'abc'])
      await request(app.getHttpServer())
        .get(`/v1/timeline/years/${year}/month-previews`)
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('INVALID_YEAR'));
    expect(queries).toHaveLength(0);
  });
});
