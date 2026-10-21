import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppController } from '../src/app.controller';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { DriveAdapter, MemoryDriveProvider } from '../src/drive';
import { GoogleOAuthClient, OAuthStateService } from '../src/oauth';
import { PrismaService } from '../src/prisma.service';
import { SyncService } from '../src/sync.service';
import { ManualDateService } from '../src/manual-date.service';
import { MediaProxyService } from '../src/media-proxy.service';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

type Row = {
  id: string;
  userId: string;
  status: string;
  date: Date;
  precision: 'YEAR' | 'MONTH' | 'DAY';
};

const photo = (
  id: string,
  date: string,
  precision: Row['precision'] = 'DAY',
  userId = 'owner',
  status = 'ACTIVE',
): Row => ({ id, userId, status, date: new Date(date), precision });

// Emulates the single month-previews query: scoping, per-group count and one photo per NTILE bucket.
function emulateQuery(photos: Row[], userId: string, start: Date, end: Date) {
  const scoped = photos
    .filter((p) => p.userId === userId && p.status === 'ACTIVE' && p.date >= start && p.date < end)
    .map((p) => ({ ...p, month: p.precision === 'YEAR' ? null : p.date.getUTCMonth() + 1 }));
  const groups = new Map<number | null, typeof scoped>();
  for (const p of scoped) groups.set(p.month, [...(groups.get(p.month) ?? []), p]);
  const rows: { month: number | null; photoCount: bigint; id: string }[] = [];
  const keys = [...groups.keys()].sort((a, b) => (a ?? 99) - (b ?? 99));
  for (const key of keys) {
    const ordered = groups
      .get(key)!
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id.localeCompare(a.id));
    const buckets = Math.min(6, ordered.length);
    const seen = new Set<number>();
    ordered.forEach((p, index) => {
      const bucket = Math.floor((index * buckets) / ordered.length);
      if (seen.has(bucket)) return;
      seen.add(bucket);
      rows.push({ month: key, photoCount: BigInt(ordered.length), id: p.id });
    });
  }
  return rows;
}

describe('GET /v1/timeline/years/:year/month-previews', () => {
  let app: INestApplication;
  let photos: Row[] = [];
  const queries: unknown[][] = [];
  const prisma: any = {
    $queryRawUnsafe: async (_query: string, ...args: any[]) => {
      queries.push(args);
      return emulateQuery(photos, args[0], args[1], args[2]);
    },
    photo: {
      findMany: async ({ where }: any) =>
        photos
          .filter((p) => p.userId === where.userId && where.id.in.includes(p.id))
          .map((p) => ({
            id: p.id,
            fileName: `${p.id}.jpg`,
            mimeType: 'image/jpeg',
            imageMetadata: null,
            effectiveDateValue: p.date,
            effectiveDatePrecision: p.precision,
          })),
    },
  };

  async function createApp(userId = 'owner') {
    app = await (
      await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: SyncService, useValue: {} },
          { provide: ManualDateService, useValue: {} },
          { provide: FolderDateRuleService, useValue: {} },
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
