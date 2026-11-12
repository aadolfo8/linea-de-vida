import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { CoversController } from '../src/covers.controller';
import { CoversService } from '../src/covers.service';
import { dropUsers, pgClient, pgUrl, photoRow, resetUsers } from './support/pg';

const ORIGIN = 'http://localhost:3000';
const P = 'cv';
const OWNER = `${P}-owner`;
const OTHER = `${P}-other`;

const photo = (
  id: string,
  date: string | null,
  precision: 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN',
  extra: Record<string, unknown> = {},
) =>
  photoRow(P, id, {
    effectiveDateValue: date ? new Date(date) : null,
    effectiveDatePrecision: precision,
    ...extra,
  });

const prisma = pgClient();
const covers = () =>
  prisma.photoCover.findMany({ orderBy: [{ createdAt: 'asc' }, { position: 'asc' }] });

async function createApp() {
  await resetUsers(prisma, P);
  await prisma.photo.createMany({
    data: [
      photo('d1', '2024-03-02', 'DAY'),
      photo('d2', '2024-03-20', 'DAY'),
      photo('m1', '2024-03-01', 'MONTH'),
      photo('d3', '2024-08-10', 'DAY'),
      photo('y1', '2024-01-01', 'YEAR'),
      photo('other-year', '2023-03-02', 'DAY'),
      photo('undated', null, 'UNKNOWN'),
      photo('hidden', '2024-03-05', 'DAY', { hiddenAt: new Date('2026-01-01') }),
      photo('missing', '2024-03-06', 'DAY', { status: 'MISSING' }),
      photo('foreign', '2024-03-07', 'DAY', { userId: OTHER }),
    ],
  });
  const app = (
    await Test.createTestingModule({
      controllers: [CoversController],
      providers: [{ provide: CoversService, useValue: new CoversService(prisma as any) }],
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: any) => {
          const http = context.switchToHttp().getRequest();
          http.userId = http.get('x-test-user') || undefined;
          return !!http.userId;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue(new CsrfGuard())
      .compile()
  ).createNestApplication();
  await app.init();
  return { app };
}

describe.skipIf(!pgUrl)('Portadas HTTP contracts (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => {
    await dropUsers(prisma, P);
    await prisma.$disconnect();
  });
  const call = (method: 'get' | 'put' | 'delete', path: string, user = OWNER) =>
    request(app!.getHttpServer())[method](path).set('x-test-user', user).set('Origin', ORIGIN);
  const put = (body: unknown, user?: string) => call('put', '/v1/covers', user).send(body as any);

  it('stores an ordered cover and lists it back with the photos', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d2', 'd1', 'm1'] })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          kind: 'MONTH',
          year: 2024,
          month: 3,
          photoIds: ['d2', 'd1', 'm1'],
        }),
      );
    await put({ kind: 'YEAR', year: 2024, photoIds: ['y1', 'd3'] }).expect(200);
    await put({ kind: 'UNKNOWN_MONTH', year: 2024, photoIds: ['y1'] }).expect(200);

    const { body } = await call('get', '/v1/covers?year=2024').expect(200);
    expect(body.limits).toEqual({ YEAR: 8, MONTH: 6, UNKNOWN_MONTH: 6 });
    expect(body.items.map((item: any) => [item.kind, item.month])).toEqual([
      ['YEAR', null],
      ['MONTH', 3],
      ['UNKNOWN_MONTH', null],
    ]);
    expect(body.items[0].photos.map((p: any) => p.id)).toEqual(['y1', 'd3']);
    expect(body.items[1].photos.map((p: any) => p.id)).toEqual(['d2', 'd1', 'm1']);
    expect(body.items[1].photos[0]).toMatchObject({ thumbnailUrl: '/v1/photos/d2/thumbnail' });
    expect((await covers()).map((row) => row.month)).toEqual([3, 3, 3, 0, 0, 0]);
  });

  it('replaces a whole scope and clears it with an empty list', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d1', 'd2'] }).expect(200);
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d2', 'd1', 'd2'] }).expect(200);
    expect((await covers()).map((row) => [row.photoId, row.position])).toEqual([
      ['d2', 0],
      ['d1', 1],
    ]);
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: [] }).expect(200);
    expect(await covers()).toHaveLength(0);
  });

  it('keeps year and month covers independent and returns to automatic with DELETE', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d1'] }).expect(200);
    await put({ kind: 'YEAR', year: 2024, photoIds: ['d1'] }).expect(200);
    await call('delete', '/v1/covers')
      .send({ kind: 'MONTH', year: 2024, month: 3 })
      .expect(200)
      .expect(({ body }) => expect(body.photoIds).toEqual([]));
    expect((await covers()).map((row) => row.kind)).toEqual(['YEAR']);
  });

  it('rejects the whole request, writing nothing, with a status per photo', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d1'] }).expect(200);
    await put({
      kind: 'MONTH',
      year: 2024,
      month: 3,
      photoIds: ['d2', 'foreign', 'nope', 'hidden', 'missing', 'd3'],
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('COVER_PHOTOS_REJECTED');
        expect(body.results).toEqual([
          { id: 'd2', status: 'OK' },
          { id: 'foreign', status: 'NOT_FOUND' },
          { id: 'nope', status: 'NOT_FOUND' },
          { id: 'hidden', status: 'HIDDEN' },
          { id: 'missing', status: 'NOT_ACTIVE' },
          { id: 'd3', status: 'NOT_ELIGIBLE' },
        ]);
      });
    expect((await covers()).map((row) => row.photoId)).toEqual(['d1']);
  });

  it('applies the eligibility rules of each kind', async () => {
    app = (await createApp()).app;
    // A year-precision photo is for the year and Sin mes, never for a month.
    await put({ kind: 'YEAR', year: 2024, photoIds: ['y1', 'm1', 'd1'] }).expect(200);
    await put({ kind: 'UNKNOWN_MONTH', year: 2024, photoIds: ['y1'] }).expect(200);
    await put({ kind: 'UNKNOWN_MONTH', year: 2024, photoIds: ['d1'] }).expect(400);
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['y1'] }).expect(400);
    await put({ kind: 'YEAR', year: 2024, photoIds: ['other-year'] }).expect(400);
    await put({ kind: 'YEAR', year: 2024, photoIds: ['undated'] }).expect(400);
  });

  it('enforces the limits of 8 per year and 6 per month', async () => {
    const created = await createApp();
    app = created.app;
    await prisma.photo.createMany({
      data: Array.from({ length: 9 }, (_, index) =>
        photo(`bulk${index}`, `2024-03-${10 + index}`, 'DAY'),
      ),
    });
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `bulk${index}`);
    await put({ kind: 'YEAR', year: 2024, photoIds: ids(8) }).expect(200);
    await put({ kind: 'YEAR', year: 2024, photoIds: ids(9) })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('TOO_MANY_COVERS'));
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ids(6) }).expect(200);
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ids(7) }).expect(400);
  });

  it('validates the scope and the body', async () => {
    app = (await createApp()).app;
    const bad = (body: unknown, code: string) =>
      put(body)
        .expect(400)
        .expect(({ body: error }) => expect(error.code).toBe(code));
    await bad({ kind: 'DECADE', year: 2024, photoIds: [] }, 'INVALID_COVER_KIND');
    await bad({ kind: 'YEAR', year: 1899, photoIds: [] }, 'INVALID_YEAR');
    await bad({ kind: 'YEAR', year: '2024', photoIds: [] }, 'INVALID_YEAR');
    await bad({ kind: 'MONTH', year: 2024, photoIds: [] }, 'INVALID_MONTH');
    await bad({ kind: 'MONTH', year: 2024, month: 13, photoIds: [] }, 'INVALID_MONTH');
    await bad({ kind: 'YEAR', year: 2024, month: 3, photoIds: [] }, 'INVALID_MONTH');
    await bad({ kind: 'YEAR', year: 2024 }, 'INVALID_PHOTO_IDS');
    await bad({ kind: 'YEAR', year: 2024, photoIds: [1] }, 'INVALID_PHOTO_IDS');
    await call('get', '/v1/covers?year=abc').expect(400);
    await call('get', '/v1/covers').expect(400);
  });

  it('drops chosen photos that stopped qualifying when read, and keeps their rows', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d1', 'd2', 'm1'] }).expect(200);
    await prisma.photo.update({ where: { id: 'd1' }, data: { hiddenAt: new Date() } });
    await prisma.photo.update({
      where: { id: 'd2' },
      data: { effectiveDateValue: new Date('2024-09-02') },
    });
    await prisma.photo.update({ where: { id: 'm1' }, data: { status: 'MISSING' } });
    const { body } = await call('get', '/v1/covers?year=2024').expect(200);
    const month = body.items.find((item: any) => item.kind === 'MONTH');
    expect(month.photos).toEqual([]);
    expect(month.dropped).toEqual([
      { photoId: 'd1', reason: 'HIDDEN' },
      { photoId: 'd2', reason: 'OUT_OF_SCOPE' },
      { photoId: 'm1', reason: 'NOT_ACTIVE' },
    ]);
    expect(await covers()).toHaveLength(3);
    // Shown again: it returns by itself.
    await prisma.photo.update({ where: { id: 'd1' }, data: { hiddenAt: null } });
    const again = await call('get', '/v1/covers?year=2024').expect(200);
    expect(again.body.items.find((item: any) => item.kind === 'MONTH').photos).toHaveLength(1);
  });

  it('removes covers with the photo and never shows another user covers', async () => {
    const created = await createApp();
    app = created.app;
    await put({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['d1'] }).expect(200);
    const { body } = await call('get', '/v1/covers?year=2024', OTHER).expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ kind: 'YEAR', photos: [], dropped: [] });
    await call('delete', '/v1/covers', OTHER).send({ kind: 'MONTH', year: 2024, month: 3 });
    expect(await covers()).toHaveLength(1);
    await prisma.photo.delete({ where: { id: 'd1' } });
    expect(await covers()).toHaveLength(0);
  });

  it('requires a session and, for changes, an allowed origin', async () => {
    app = (await createApp()).app;
    await request(app.getHttpServer()).get('/v1/covers?year=2024').expect(403);
    const body = { kind: 'YEAR', year: 2024, photoIds: [] };
    await request(app.getHttpServer())
      .put('/v1/covers')
      .set('Origin', ORIGIN)
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .put('/v1/covers')
      .set('x-test-user', OWNER)
      .set('Origin', 'http://attacker.example.test')
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .delete('/v1/covers')
      .set('x-test-user', OWNER)
      .set('Origin', 'http://attacker.example.test')
      .send(body)
      .expect(403);
  });
});
