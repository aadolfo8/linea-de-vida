import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { OrderingController } from '../src/ordering.controller';
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
    memory.rows('photo').push({ id, userId, status: 'ACTIVE', hiddenAt: null });
  const app = (
    await Test.createTestingModule({
      controllers: [OrderingController],
      providers: [
        { provide: PhotoVisibilityService, useValue: new PhotoVisibilityService(memory as any) },
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
});
