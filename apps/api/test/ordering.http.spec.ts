import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { FolderDateRuleService } from '../src/folder-date-rule.service';
import { ManualDateService } from '../src/manual-date.service';
import { OrderingController } from '../src/ordering.controller';
import { OrderingService } from '../src/ordering.service';
import { PhotoVisibilityService } from '../src/photo-visibility.service';
import { dropUsers, pgClient, pgUrl, photoRow, resetUsers } from './support/pg';

const ORIGIN = 'http://localhost:3000';
const P = 'od';
const OWNER = `${P}-owner`;
const OTHER = `${P}-other`;
const SOURCE = `${P}-source`;
const OTHER_SOURCE = `${P}-other-source`;
const prisma = pgClient();
/** The seeded photos in creation order: p1, p2, then the other user's. */
const photoAt = (index: number) =>
  prisma.photo.findUniqueOrThrow({ where: { id: ['p1', 'p2', 'foreign'][index]! } });

async function createApp() {
  await resetUsers(prisma, P);
  await prisma.photoSource.create({
    data: {
      id: OTHER_SOURCE,
      userId: OTHER,
      oauthConnectionId: (
        await prisma.oAuthConnection.findFirstOrThrow({ where: { userId: OWNER } })
      ).id,
      driveFolderId: 'other-root',
      name: 'Theirs',
      type: 'GENERIC',
    },
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
    driveFolderId: `drive-${id}`,
    name,
    path: parentId ? ['Root', name] : [name],
  });
  await prisma.indexedFolder.create({ data: folder('root', OWNER, SOURCE, null, 'Root') });
  await prisma.indexedFolder.create({ data: folder('child', OWNER, SOURCE, 'root', 'Child') });
  await prisma.indexedFolder.create({
    data: folder('foreign-folder', OTHER, OTHER_SOURCE, null, 'Theirs'),
  });
  for (const [id, userId] of [
    ['p1', OWNER],
    ['p2', OWNER],
    ['foreign', OTHER],
  ] as const)
    await prisma.photo.create({
      data: photoRow(P, id, {
        userId,
        sourceId: userId === OWNER ? SOURCE : OTHER_SOURCE,
        folderId: id === 'p1' ? 'root' : 'child',
      }),
    });
  const app = (
    await Test.createTestingModule({
      controllers: [OrderingController],
      providers: [
        { provide: PhotoVisibilityService, useValue: new PhotoVisibilityService(prisma as any) },
        { provide: ManualDateService, useValue: new ManualDateService(prisma as any) },
        { provide: FolderDateRuleService, useValue: new FolderDateRuleService(prisma as any) },
        { provide: OrderingService, useValue: new OrderingService(prisma as any) },
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
  return { app };
}

describe.skipIf(!pgUrl)('Ordenar HTTP contracts (PostgreSQL)', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(async () => {
    await dropUsers(prisma, P);
    await prisma.$disconnect();
  });
  const call = (method: 'get' | 'post' | 'put' | 'delete', path: string, user = OWNER) =>
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
    expect((await photoAt(0)).hiddenAt).toBeInstanceOf(Date);
    expect((await photoAt(2)).hiddenAt).toBeNull();

    await call('post', '/v1/photos/unhide')
      .send({ photoIds: ['p1'] })
      .expect(200)
      .expect(({ body }) => expect(body.results).toEqual([{ id: 'p1', status: 'VISIBLE' }]));
    expect((await photoAt(0)).hiddenAt).toBeNull();
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
      .set('x-test-user', OWNER)
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
    expect(await photoAt(0)).toMatchObject({
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
    expect((await photoAt(0)).effectiveDateSource).toBe('NONE');
    expect((await photoAt(1)).effectiveDateSource).toBe('MANUAL');
  });

  it('validates batch dates and enforces CSRF', async () => {
    app = (await createApp()).app;
    await call('put', '/v1/photos/dates')
      .send({ photoIds: ['p1'], year: 2014, month: 2, day: 30, precision: 'DAY' })
      .expect(400);
    await call('put', '/v1/photos/dates').send({ year: 2014, precision: 'YEAR' }).expect(400);
    await request(app.getHttpServer())
      .put('/v1/photos/dates')
      .set('x-test-user', OWNER)
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
    expect(await photoAt(0)).toMatchObject({
      effectiveDateSource: 'FOLDER_RULE',
      effectiveDatePrecision: 'DAY',
    });
    expect((await photoAt(1)).effectiveDateSource).toBe('NONE');
    // Defaults: include subfolders, keep camera dates.
    await call('put', '/v1/indexed-folders/root/date')
      .send({ year: 2008, precision: 'YEAR' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.rule).toMatchObject({ scope: 'FALLBACK_DESCENDANTS', includeSubfolders: true }),
      );
    expect((await photoAt(1)).effectiveDateSource).toBe('FOLDER_RULE');
    await call('delete', '/v1/indexed-folders/root/date')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ affectedCount: 2 }));
    expect((await photoAt(0)).effectiveDateSource).toBe('NONE');
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
    await call('get', `/v1/photo-sources/${SOURCE}/folder-tree`)
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
    await call('get', `/v1/ordering/piles?sourceId=${OTHER_SOURCE}`).expect(404);
    await call('get', `/v1/photo-sources/${OTHER_SOURCE}/folder-tree`).expect(404);
    await call('get', '/v1/indexed-folders/foreign-folder').expect(404);
    await call('get', '/v1/ordering/piles?includeSubfolders=maybe').expect(400);
    await call('get', '/v1/ordering/photos').expect(400);
    await call('get', '/v1/ordering/photos?pile=undated&cursor=junk').expect(400);
    await request(app.getHttpServer()).get('/v1/ordering/piles').expect(403);
  });

  it('lists and accepts filename suggestions', async () => {
    const created = await createApp();
    app = created.app;
    await prisma.photo.update({
      where: { id: 'p1' },
      data: { fileName: 'IMG-20190812-WA0001.jpg' },
    });
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
    expect(await photoAt(0)).toMatchObject({
      detectedSource: 'FILENAME',
      effectiveDateSource: 'FILENAME',
    });
    await call('post', '/v1/ordering/filename-suggestions/accept')
      .send({ kinds: ['bogus'] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/ordering/filename-suggestions/accept')
      .set('x-test-user', OWNER)
      .set('Origin', 'http://attacker.example.test')
      .send({})
      .expect(403);
  });
});
