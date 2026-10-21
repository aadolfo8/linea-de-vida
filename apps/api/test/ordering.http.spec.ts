import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { FolderDateRuleService } from '../src/folder-date-rule.service';
import { ManualDateService } from '../src/manual-date.service';
import { OrderingController } from '../src/ordering.controller';
import { OrderingService } from '../src/ordering.service';
import { PhotoVisibilityService } from '../src/photo-visibility.service';
import { MemoryPrisma } from './support/memory-prisma';

const ORIGIN = 'http://localhost:3000';

async function createApp() {
  const memory = new MemoryPrisma();
  for (const [id, userId] of [
    ['p1', 'owner'],
    ['p2', 'owner'],
    ['foreign', 'other'],
  ])
    memory.rows('photo').push({
      id,
      userId,
      sourceId: 'source',
      fileName: `${id}.jpg`,
      folderId: id === 'p1' ? 'root' : 'child',
      status: 'ACTIVE',
      hiddenAt: null,
      detectedDate: null,
      detectedPrecision: 'UNKNOWN',
      detectedSource: 'NONE',
      effectiveDateValue: null,
      effectiveDatePrecision: 'UNKNOWN',
      effectiveDateSource: 'NONE',
    });
  const folder = (
    id: string,
    userId: string,
    sourceId: string,
    parentId: string | null,
    name: string,
  ) => ({
    id,
    userId,
    sourceId,
    parentId,
    name,
    path: parentId ? ['Root', name] : [name],
    status: 'ACTIVE',
  });
  memory
    .rows('indexedFolder')
    .push(
      folder('root', 'owner', 'source', null, 'Root'),
      folder('child', 'owner', 'source', 'root', 'Child'),
      folder('foreign-folder', 'other', 'other-source', null, 'Theirs'),
    );
  memory
    .rows('photoSource')
    .push({ id: 'source', userId: 'owner' }, { id: 'other-source', userId: 'other' });
  const app = (
    await Test.createTestingModule({
      controllers: [OrderingController],
      providers: [
        { provide: PhotoVisibilityService, useValue: new PhotoVisibilityService(memory as any) },
        { provide: ManualDateService, useValue: new ManualDateService(memory as any) },
        { provide: FolderDateRuleService, useValue: new FolderDateRuleService(memory as any) },
        { provide: OrderingService, useValue: new OrderingService(memory as any) },
      ],
    })
      // The real session guard needs a signed cookie; the tests only need the user it resolves.
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
  return { app, memory };
}

describe('Ordenar HTTP contracts', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, user = 'owner') =>
    request(app!.getHttpServer())[method](path).set('x-test-user', user).set('Origin', ORIGIN);

  it('hides and unhides owned photos with per-photo results', async () => {
    const created = await createApp();
    app = created.app;
    await call('post', '/v1/photos/hide')
      .send({ photoIds: ['p1', 'foreign', 'nope'] })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          results: [
            { id: 'p1', status: 'HIDDEN' },
            { id: 'foreign', status: 'NOT_FOUND' },
            { id: 'nope', status: 'NOT_FOUND' },
          ],
          changedCount: 1,
        }),
      );
    expect(created.memory.rows('photo')[0].hiddenAt).toBeInstanceOf(Date);
    expect(created.memory.rows('photo')[2].hiddenAt).toBeNull();

    await call('post', '/v1/photos/unhide')
      .send({ photoIds: ['p1'] })
      .expect(200)
      .expect(({ body }) => expect(body.results).toEqual([{ id: 'p1', status: 'VISIBLE' }]));
    expect(created.memory.rows('photo')[0].hiddenAt).toBeNull();
  });

  it('requires a session, an allowed origin and a valid body', async () => {
    app = (await createApp()).app;
    await request(app.getHttpServer())
      .post('/v1/photos/hide')
      .set('Origin', ORIGIN)
      .send({ photoIds: ['p1'] })
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/photos/hide')
      .set('x-test-user', 'owner')
      .set('Origin', 'http://attacker.example.test')
      .send({ photoIds: ['p1'] })
      .expect(403);
    await call('post', '/v1/photos/hide').send({}).expect(400);
    await call('post', '/v1/photos/unhide').send({ photoIds: [] }).expect(400);
  });

  it('sets and clears manual dates for a batch, reporting every photo', async () => {
    const created = await createApp();
    app = created.app;
    await call('put', '/v1/photos/dates')
      .send({ photoIds: ['p1', 'p2', 'foreign'], year: 2014, month: 8, day: 3, precision: 'DAY' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          results: [
            { id: 'p1', status: 'UPDATED' },
            { id: 'p2', status: 'UPDATED' },
            { id: 'foreign', status: 'NOT_FOUND' },
          ],
          updatedCount: 2,
        }),
      );
    expect(created.memory.rows('photo')[0]).toMatchObject({
      effectiveDateSource: 'MANUAL',
      effectiveDatePrecision: 'DAY',
    });
    await call('post', '/v1/photos/dates/clear')
      .send({ photoIds: ['p1', 'foreign'] })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          results: [
            { id: 'p1', status: 'CLEARED' },
            { id: 'foreign', status: 'NOT_FOUND' },
          ],
          clearedCount: 1,
        }),
      );
    expect(created.memory.rows('photo')[0].effectiveDateSource).toBe('NONE');
    expect(created.memory.rows('photo')[1].effectiveDateSource).toBe('MANUAL');
  });

  it('validates batch dates and enforces CSRF', async () => {
    app = (await createApp()).app;
    await call('put', '/v1/photos/dates')
      .send({ photoIds: ['p1'], year: 2014, month: 2, day: 30, precision: 'DAY' })
      .expect(400);
    await call('put', '/v1/photos/dates').send({ year: 2014, precision: 'YEAR' }).expect(400);
    await request(app.getHttpServer())
      .put('/v1/photos/dates')
      .set('x-test-user', 'owner')
      .set('Origin', 'http://attacker.example.test')
      .send({ photoIds: ['p1'], year: 2014, precision: 'YEAR' })
      .expect(403);
  });

  it('dates a folder with the two simple choices, previews, and removes it', async () => {
    const created = await createApp();
    app = created.app;
    await call('post', '/v1/indexed-folders/root/date/preview')
      .send({ year: 2008, month: 5, precision: 'MONTH' })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ scopePhotoCount: 2, willChangeCount: 2 }));
    await call('put', '/v1/indexed-folders/root/date')
      .send({
        year: 2008,
        month: 5,
        day: 14,
        precision: 'DAY',
        includeSubfolders: false,
        overrideCameraDates: false,
      })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          rule: {
            folderId: 'root',
            precision: 'DAY',
            scope: 'DIRECT_ONLY',
            includeSubfolders: false,
            overrideCameraDates: false,
          },
          affectedCount: 1,
        }),
      );
    expect(created.memory.rows('photo')[0]).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDatePrecision: 'DAY',
    });
    expect(created.memory.rows('photo')[1].effectiveDateSource).toBe('NONE');
    // Defaults: include subfolders, keep camera dates.
    await call('put', '/v1/indexed-folders/root/date')
      .send({ year: 2008, precision: 'YEAR' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.rule).toMatchObject({ scope: 'FALLBACK_DESCENDANTS', includeSubfolders: true }),
      );
    expect(created.memory.rows('photo')[1].effectiveDateSource).toBe('FOLDER_RULE');
    await call('delete', '/v1/indexed-folders/root/date')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ affectedCount: 2 }));
    expect(created.memory.rows('photo')[0].effectiveDateSource).toBe('NONE');
  });

  it('rejects invalid folder dates and never touches another user folder', async () => {
    app = (await createApp()).app;
    await call('put', '/v1/indexed-folders/root/date')
      .send({ year: 2008, month: 13, precision: 'MONTH' })
      .expect(400);
    await call('put', '/v1/indexed-folders/root/date')
      .send({ year: 2008, precision: 'YEAR', includeSubfolders: 'yes' })
      .expect(400);
    await call('put', '/v1/indexed-folders/foreign-folder/date')
      .send({ year: 2008, precision: 'YEAR' })
      .expect(404);
    await call('delete', '/v1/indexed-folders/foreign-folder/date').expect(404);
  });

  it('serves the piles, the photos of a pile and the folder tree', async () => {
    const created = await createApp();
    app = created.app;
    await call('get', '/v1/ordering/piles')
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({ undated: 2, yearOnly: 0, dated: 0, hidden: 0, total: 2 }),
      );
    await call('get', '/v1/ordering/piles?folderId=child&includeSubfolders=false')
      .expect(200)
      .expect(({ body }) => expect(body.total).toBe(1));
    await call('get', '/v1/ordering/photos?pile=undated&limit=1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          thumbnailUrl: '/v1/photos/p1/thumbnail',
          hidden: false,
        });
        expect(body.nextCursor).toEqual(expect.any(String));
      });
    await call('get', '/v1/photo-sources/source/folder-tree')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({ name: 'Root', subtreePhotoCount: 2 });
        expect(body.items[0].children[0]).toMatchObject({ name: 'Child', photoCount: 1 });
      });
    await call('get', '/v1/indexed-folders/child')
      .expect(200)
      .expect(({ body }) =>
        expect(body.breadcrumb).toEqual([
          { id: 'root', name: 'Root' },
          { id: 'child', name: 'Child' },
        ]),
      );
  });

  it('keeps the read routes owner-scoped and validates their query', async () => {
    app = (await createApp()).app;
    await call('get', '/v1/ordering/piles?sourceId=other-source').expect(404);
    await call('get', '/v1/photo-sources/other-source/folder-tree').expect(404);
    await call('get', '/v1/indexed-folders/foreign-folder').expect(404);
    await call('get', '/v1/ordering/piles?includeSubfolders=maybe').expect(400);
    await call('get', '/v1/ordering/photos').expect(400);
    await call('get', '/v1/ordering/photos?pile=undated&cursor=junk').expect(400);
    await request(app.getHttpServer()).get('/v1/ordering/piles').expect(403);
  });

  it('lists and accepts filename suggestions', async () => {
    const created = await createApp();
    app = created.app;
    created.memory.rows('photo')[0].fileName = 'IMG-20190812-WA0001.jpg';
    await call('get', '/v1/ordering/filename-suggestions')
      .expect(200)
      .expect(({ body }) => {
        expect(body.totalCount).toBe(1);
        expect(body.groups[0]).toMatchObject({ kind: 'whatsapp', photoCount: 1 });
      });
    await call('post', '/v1/ordering/filename-suggestions/accept')
      .send({ kinds: ['whatsapp'] })
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ appliedCount: 1 }));
    expect(created.memory.rows('photo')[0]).toMatchObject({
      detectedSource: 'FILENAME',
      effectiveDateSource: 'FILENAME',
    });
    await call('post', '/v1/ordering/filename-suggestions/accept')
      .send({ kinds: ['bogus'] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/ordering/filename-suggestions/accept')
      .set('x-test-user', 'owner')
      .set('Origin', 'http://attacker.example.test')
      .send({})
      .expect(403);
  });
});
