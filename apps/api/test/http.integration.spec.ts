import 'reflect-metadata';
import { INestApplication, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppController } from '../src/app.controller';
import { CsrfGuard, SessionGuard } from '../src/auth';
import { DriveAdapter, MemoryDriveProvider } from '../src/drive';
import { GoogleOAuthClient, OAuthStateService } from '../src/oauth';
import { PrismaService } from '../src/prisma.service';
import { SyncService } from '../src/sync.service';
import { ManualDateService, validateManualDate } from '../src/manual-date.service';
import { MediaProxyService } from '../src/media-proxy.service';
import { FolderDateRuleService } from '../src/folder-date-rule.service';

describe('Phase 1 HTTP contracts', () => {
  let app: INestApplication;
  const ownerConnection = {
    id: 'connection-owner',
    userId: 'owner',
    status: 'ACTIVE',
    refreshTokenCiphertext: null,
  };
  const userUpserts: any[] = [];
  const connectionUpserts: any[] = [];
  const oauthStates = new Map<string, any>();
  const prisma: any = {
    user: {
      upsert: async (args: any) => {
        userUpserts.push(args);
        return { id: 'google-user', ...args.create };
      },
      findUnique: async () => null,
    },
    oAuthConnection: {
      findFirst: async ({ where }: { where: { id?: string; userId: string } }) =>
        where.userId === 'owner' && (!where.id || where.id === 'connection-owner')
          ? ownerConnection
          : null,
      upsert: async (args: any) => {
        connectionUpserts.push(args);
        return { id: 'connection-google', ...args.create };
      },
      update: async () => ownerConnection,
    },
    oAuthState: {
      create: async ({ data }: { data: any }) => {
        oauthStates.set(data.id, data);
        return data;
      },
      deleteMany: async ({ where }: { where: { expiresAt: { lt: Date } } }) => {
        for (const [id, state] of oauthStates)
          if (state.expiresAt < where.expiresAt.lt) oauthStates.delete(id);
        return {};
      },
      findFirst: async ({ where }: { where: any }) =>
        [...oauthStates.values()].find(
          (state) =>
            state.id === where.id &&
            state.purpose === where.purpose &&
            state.userId === where.userId &&
            state.expiresAt > where.expiresAt.gt,
        ) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        const state = oauthStates.get(where.id);
        oauthStates.delete(where.id);
        return state;
      },
    },
    $transaction: async (operation: (value: typeof prisma) => unknown) => operation(prisma),
    $queryRawUnsafe: async (query: string, ...args: unknown[]) => {
      if (query.includes('MIN(EXTRACT(YEAR')) return [{ firstYear: 2023, lastYear: 2024 }];
      if (query.includes('AS year'))
        return [
          { year: 2024, photoCount: 2n },
          { year: 2023, photoCount: 1n },
        ].slice(args.at(-1) as number);
      if (query.includes('AS month'))
        return [
          { month: 3, photoCount: 2n },
          { month: null, photoCount: 1n },
        ];
      if (query.includes('AS day'))
        return [
          { day: 9, photoCount: 2n },
          { day: null, photoCount: 1n },
        ];
      return [{ photoCount: 3n }];
    },
    photoSource: {
      count: async () => 0,
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: Record<string, string> }) => ({
        id: 'source-owner',
        ...data,
      }),
      findMany: async () => [],
      findFirst: async () => null,
    },
    syncRun: { findFirst: async () => null },
    photo: {
      groupBy: async () => [
        { effectiveDateValue: new Date('2024-01-01'), _count: 2 },
        { effectiveDateValue: new Date('2023-01-01'), _count: 1 },
      ],
      findMany: async () => [],
      findFirst: async () => null,
    },
  };
  const sync = {
    enqueue: async (userId: string, sourceId: string) => ({
      id: 'run-1',
      photoSourceId: sourceId,
      requestedBy: userId,
    }),
  };
  const editablePhotos = new Map<string, any>([
    [
      'photo-owner',
      {
        id: 'photo-owner',
        userId: 'owner',
        fileName: 'owner.jpg',
        detectedDate: new Date('2020-03-04T00:00:00.000Z'),
        detectedPrecision: 'DAY',
        detectedSource: 'EXIF',
        effectiveDateValue: new Date('2020-03-04T00:00:00.000Z'),
        effectiveDatePrecision: 'DAY',
        override: null,
      },
    ],
    [
      'photo-owner-2',
      {
        id: 'photo-owner-2',
        userId: 'owner',
        fileName: 'owner-2.jpg',
        detectedDate: null,
        detectedPrecision: 'UNKNOWN',
        detectedSource: 'NONE',
        effectiveDateValue: null,
        effectiveDatePrecision: 'UNKNOWN',
        override: null,
      },
    ],
    [
      'photo-other',
      {
        id: 'photo-other',
        userId: 'other',
        fileName: 'other.jpg',
        detectedDate: new Date('2019-01-01T00:00:00.000Z'),
        detectedPrecision: 'YEAR',
        detectedSource: 'FOLDER',
        effectiveDateValue: new Date('2019-01-01T00:00:00.000Z'),
        effectiveDatePrecision: 'YEAR',
        override: null,
      },
    ],
  ]);
  const manualDates = {
    set: async (userId: string, ids: string[], input: any) => {
      const manual = validateManualDate(input);
      const photos = ids.map((id) => editablePhotos.get(id));
      if (photos.some((photo) => !photo || photo.userId !== userId)) throw new NotFoundException();
      for (const photo of photos) {
        photo.override = { dateValue: manual.dateValue, precision: manual.precision };
        photo.effectiveDateValue = manual.dateValue;
        photo.effectiveDatePrecision = manual.precision;
      }
      return photos;
    },
    remove: async (userId: string, id: string) => {
      const photo = editablePhotos.get(id);
      if (!photo || photo.userId !== userId) throw new NotFoundException();
      photo.override = null;
      photo.effectiveDateValue = photo.detectedDate;
      photo.effectiveDatePrecision = photo.detectedDate ? photo.detectedPrecision : 'UNKNOWN';
      return photo;
    },
  };

  afterEach(async () => app?.close());

  async function createApp(
    userId = 'owner',
    options: {
      realOAuthState?: boolean;
      csrf?: boolean;
      oauth?: { exchange: () => Promise<any>; revoke?: () => Promise<void> };
    } = {},
  ) {
    app = await (
      await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: SyncService, useValue: sync },
          { provide: ManualDateService, useValue: manualDates },
          {
            provide: FolderDateRuleService,
            useValue: { set: async () => ({}), remove: async () => ({}) },
          },
          MediaProxyService,
          {
            provide: DriveAdapter,
            useValue: new MemoryDriveProvider({
              parent: [
                {
                  id: 'folder-a',
                  name: 'Archive',
                  mimeType: 'application/vnd.google-apps.folder',
                  parents: ['parent'],
                },
              ],
            }),
          },
          {
            provide: GoogleOAuthClient,
            useValue: options.oauth ?? {
              exchange: async () => {
                throw new Error('not called');
              },
              revoke: async () => undefined,
            },
          },
          {
            provide: OAuthStateService,
            useValue: options.realOAuthState
              ? new OAuthStateService(prisma)
              : {
                  create: async () => ({ id: 'state', codeChallenge: 'challenge' }),
                  consume: async () => null,
                },
          },
        ],
      })
        .overrideGuard(SessionGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp: () => { getRequest: () => { userId?: string } };
          }) => {
            context.switchToHttp().getRequest().userId = userId;
            return true;
          },
        })
        .overrideGuard(CsrfGuard)
        .useValue(options.csrf ? new CsrfGuard() : { canActivate: () => true })
        .compile()
    ).createNestApplication();
    app.use(cookieParser('test-session-secret'));
    await app.init();
  }

  it('creates a source only for its owner and denies horizontal connection access', async () => {
    await createApp();
    await request(app.getHttpServer())
      .post('/v1/photo-sources')
      .send({ oauthConnectionId: 'connection-owner', driveFolderId: 'folder-a', name: 'Archive' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/photo-sources')
      .send({ oauthConnectionId: 'connection-other', driveFolderId: 'folder-a', name: 'Archive' })
      .expect(404);
  });

  it('accepts Takeout only as an explicit owned source type', async () => {
    await createApp();
    await request(app.getHttpServer())
      .post('/v1/photo-sources')
      .send({
        oauthConnectionId: 'connection-owner',
        driveFolderId: 'folder-a',
        name: 'Takeout',
        type: 'GOOGLE_TAKEOUT',
      })
      .expect(201)
      .expect(({ body }) => expect(body.type).toBe('GOOGLE_TAKEOUT'));
    await request(app.getHttpServer())
      .post('/v1/photo-sources')
      .send({
        oauthConnectionId: 'connection-other',
        driveFolderId: 'folder-a',
        name: 'Takeout',
        type: 'GOOGLE_TAKEOUT',
      })
      .expect(404);
  });

  it('enqueues an owned sync run with 202', async () => {
    await createApp();
    await request(app.getHttpServer())
      .post('/v1/photo-sources/source-owner/sync-runs')
      .expect(202)
      .expect(({ body }) => expect(body.id).toBe('run-1'));
  });

  it('returns a controlled error when the sync queue is unavailable', async () => {
    const originalEnqueue = sync.enqueue;
    sync.enqueue = async () => {
      throw new ServiceUnavailableException({
        code: 'SYNC_ENQUEUE_FAILED',
        message: 'The sync could not be queued. Please try again.',
      });
    };
    try {
      await createApp();
      await request(app.getHttpServer())
        .post('/v1/photo-sources/source-owner/sync-runs')
        .expect(503)
        .expect(({ body }) => expect(body.code).toBe('SYNC_ENQUEUE_FAILED'));
    } finally {
      sync.enqueue = originalEnqueue;
    }
  });

  it('paginates the annual timeline with an opaque scoped cursor', async () => {
    await createApp();
    const first = await request(app.getHttpServer()).get('/v1/timeline/years?limit=1').expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toBeTruthy();
    await request(app.getHttpServer())
      .get(`/v1/timeline/years?limit=1&cursor=${first.body.nextCursor}`)
      .expect(200)
      .expect(({ body }) => expect(body.items[0].year).toBe(2023));
    await request(app.getHttpServer()).get('/v1/timeline/years?cursor=invalid').expect(400);
  });

  it('returns month and day aggregates including explicit partial-date groups', async () => {
    await createApp();
    await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/months?limit=1')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({ month: 3, kind: 'MONTH', photoCount: 2 });
        expect(body.nextCursor).toBeTruthy();
      });
    await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/months/3/days?limit=10')
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.at(-1)).toMatchObject({
          day: null,
          label: 'Día sin concretar',
          kind: 'MONTH',
        }),
      );
    await request(app.getHttpServer())
      .get('/v1/timeline/years/2024/months?cursor=eyJzY29wZSI6InllYXJzIiwib2Zmc2V0IjoxfQ')
      .expect(400);
  });

  it('validates each photo granularity and keeps unknown dates accessible', async () => {
    await createApp();
    await request(app.getHttpServer()).get('/v1/photos?year=2024&precision=YEAR').expect(200);
    await request(app.getHttpServer())
      .get('/v1/photos?year=2024&month=3&precision=MONTH')
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/photos?year=2024&month=3&day=9&precision=DAY')
      .expect(200);
    await request(app.getHttpServer()).get('/v1/photos?precision=UNKNOWN').expect(200);
    await request(app.getHttpServer()).get('/v1/photos?year=2024&month=3').expect(400);
    await request(app.getHttpServer()).get('/v1/photos?precision=UNKNOWN&year=2024').expect(400);
  });

  it('serves a user-isolated, keyset-cursor chronological feed without duplicate photos', async () => {
    const originalFindMany = prisma.photo.findMany;
    const first = [
      {
        id: 'photo-c',
        userId: 'owner',
        fileName: 'c.jpg',
        mimeType: 'image/jpeg',
        detectedDate: new Date('2024-03-03T00:00:00.000Z'),
        detectedPrecision: 'DAY',
        detectedSource: 'EXIF',
        effectiveDateValue: new Date('2024-03-03T00:00:00.000Z'),
        effectiveDatePrecision: 'DAY',
        override: null,
      },
      {
        id: 'photo-b',
        userId: 'owner',
        fileName: 'b.jpg',
        mimeType: 'image/jpeg',
        detectedDate: new Date('2024-03-02T00:00:00.000Z'),
        detectedPrecision: 'DAY',
        detectedSource: 'EXIF',
        effectiveDateValue: new Date('2024-03-02T00:00:00.000Z'),
        effectiveDatePrecision: 'DAY',
        override: null,
      },
      {
        id: 'photo-a',
        userId: 'owner',
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        detectedDate: new Date('2024-01-01T00:00:00.000Z'),
        detectedPrecision: 'YEAR',
        detectedSource: 'FOLDER',
        effectiveDateValue: new Date('2024-01-01T00:00:00.000Z'),
        effectiveDatePrecision: 'YEAR',
        override: null,
      },
    ];
    const calls: any[] = [];
    prisma.photo.findMany = async (args: any) => {
      calls.push(args);
      return args.where.OR ? [first[2]] : first;
    };
    try {
      await createApp();
      const pageOne = await request(app.getHttpServer())
        .get('/v1/timeline/feed?limit=2')
        .expect(200)
        .expect(({ body }) => {
          expect(body.items.map((photo: any) => photo.id)).toEqual(['photo-c', 'photo-b']);
          expect(body.items[0]).toMatchObject({
            thumbnailUrl: '/v1/photos/photo-c/thumbnail',
            period: { year: 2024, month: 3, key: '2024-03' },
          });
          expect(body.nextCursor).toBeTruthy();
        });
      const pageTwo = await request(app.getHttpServer())
        .get(`/v1/timeline/feed?limit=2&cursor=${pageOne.body.nextCursor}`)
        .expect(200);
      expect(pageTwo.body.items.map((photo: any) => photo.id)).toEqual(['photo-a']);
      expect(
        new Set([...pageOne.body.items, ...pageTwo.body.items].map((photo: any) => photo.id)).size,
      ).toBe(3);
      expect(pageTwo.body.items[0].period).toMatchObject({ year: 2024, month: null });
      expect(calls).toHaveLength(2);
      expect(calls[0].where).toMatchObject({ userId: 'owner', status: 'ACTIVE' });
      expect(calls[1].where.OR).toBeTruthy();
      await request(app.getHttpServer()).get('/v1/timeline/feed?cursor=invalid').expect(400);
    } finally {
      prisma.photo.findMany = originalFindMany;
    }
  });

  it('scopes feed reads to the current user before returning metadata', async () => {
    const originalFindMany = prisma.photo.findMany;
    let where: any;
    prisma.photo.findMany = async (args: any) => {
      where = args.where;
      return [];
    };
    try {
      await createApp('other');
      await request(app.getHttpServer()).get('/v1/timeline/feed').expect(200);
      expect(where).toMatchObject({ userId: 'other', status: 'ACTIVE' });
    } finally {
      prisma.photo.findMany = originalFindMany;
    }
  });

  it('rejects a callback with an invalid or consumed state', async () => {
    await createApp();
    await request(app.getHttpServer())
      .get('/v1/oauth/google/drive/callback?state=bad&code=code')
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_OAUTH_STATE'));
  });

  it('starts Google login without a session and returns only a safe authorization URL', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    try {
      await createApp();
      await request(app.getHttpServer())
        .post('/v1/auth/google/authorize')
        .expect(201)
        .expect(({ body, headers }) => {
          expect(body).toEqual({
            available: true,
            authorizationUrl: expect.stringContaining(
              'https://accounts.google.com/o/oauth2/v2/auth?',
            ),
          });
          const url = new URL(body.authorizationUrl);
          expect(url.searchParams.get('client_id')).toBe('test-client-id');
          expect(url.searchParams.get('state')).toBe('state');
          expect(url.searchParams.get('scope')).toBe(
            'openid email profile https://www.googleapis.com/auth/drive.readonly',
          );
          expect(url.searchParams.get('access_type')).toBe('offline');
          expect(url.searchParams.get('include_granted_scopes')).toBe('true');
          expect(url.searchParams.get('prompt')).toBe('consent select_account');
          expect(url.searchParams.get('code_challenge')).toBe('challenge');
          expect(url.searchParams.get('code_challenge_method')).toBe('S256');
          expect(headers['set-cookie']).toEqual(
            expect.arrayContaining([expect.stringContaining('lv_login_state=')]),
          );
          expect(body.authorizationUrl).not.toContain('test-client-secret');
        });
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

  it('persists and consumes login state through the HTTP authorization flow without exposing secrets', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    try {
      await createApp('owner', { realOAuthState: true, csrf: true });
      const response = await request(app.getHttpServer())
        .post('/v1/auth/google/authorize')
        .set('Origin', 'http://localhost:3000')
        .expect(201)
        .expect(({ body }) => {
          expect(body.available).toBe(true);
          expect(body.authorizationUrl).not.toContain('test-client-secret');
        });
      const stateId = new URL(response.body.authorizationUrl).searchParams.get('state');
      expect(stateId).toBeTruthy();
      expect(oauthStates.get(stateId!)).toMatchObject({ purpose: 'login', userId: undefined });
      const state = await new OAuthStateService(prisma).consume(stateId!, 'login');
      expect(state?.codeVerifier).toEqual(expect.any(String));
      expect(oauthStates.has(stateId!)).toBe(false);
      await request(app.getHttpServer())
        .post('/v1/auth/google/authorize')
        .set('Origin', 'http://attacker.example.test')
        .expect(403)
        .expect(({ body }) => expect(body.code).toBe('CSRF_ORIGIN_REJECTED'));
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

  it('creates the user and matching Drive connection in the combined callback', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const previousEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    userUpserts.length = 0;
    connectionUpserts.length = 0;
    try {
      await createApp('owner', {
        realOAuthState: true,
        oauth: {
          exchange: async () => ({
            subject: 'google-subject-1',
            email: 'person@example.test',
            displayName: 'Person',
            scopes: [
              'openid',
              'email',
              'profile',
              'https://www.googleapis.com/auth/drive.readonly',
            ],
            refreshToken: 'refresh-token-that-must-not-reach-the-browser',
          }),
        },
      });
      const client = request.agent(app.getHttpServer());
      const authorization = await client.post('/v1/auth/google/authorize').expect(201);
      const state = new URL(authorization.body.authorizationUrl).searchParams.get('state');
      await client.get(`/v1/auth/google/callback?state=${state}&code=code`).expect(302);

      expect(userUpserts).toHaveLength(1);
      expect(userUpserts[0].create.googleSubject).toBe('google-subject-1');
      expect(connectionUpserts).toHaveLength(1);
      expect(connectionUpserts[0].create).toMatchObject({
        userId: 'google-user',
        provider: 'google-drive',
        googleAccountId: 'google-subject-1',
        grantedScopes: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
      });
      expect(connectionUpserts[0].create.refreshTokenCiphertext).not.toContain('refresh-token');
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
      if (previousEncryptionKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  it.each([
    [
      'missing Drive scope',
      ['openid', 'email', 'profile'],
      'refresh-token',
      'DRIVE_SCOPE_NOT_GRANTED',
    ],
    [
      'missing refresh token',
      ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.readonly'],
      undefined,
      'DRIVE_OFFLINE_ACCESS_REQUIRED',
    ],
  ])('rejects a combined callback with %s', async (_, scopes, refreshToken, expectedCode) => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const previousEncryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    try {
      await createApp('owner', {
        realOAuthState: true,
        oauth: {
          exchange: async () => ({
            subject: 'google-subject-1',
            email: 'person@example.test',
            displayName: 'Person',
            scopes,
            refreshToken,
          }),
        },
      });
      const client = request.agent(app.getHttpServer());
      const authorization = await client.post('/v1/auth/google/authorize').expect(201);
      const state = new URL(authorization.body.authorizationUrl).searchParams.get('state');
      await client
        .get(`/v1/auth/google/callback?state=${state}&code=code`)
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe(expectedCode));
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
      if (previousEncryptionKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = previousEncryptionKey;
    }
  });

  it('redirects an access denial without exposing OAuth details', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    try {
      await createApp('owner', { realOAuthState: true });
      const client = request.agent(app.getHttpServer());
      const authorization = await client.post('/v1/auth/google/authorize').expect(201);
      const state = new URL(authorization.body.authorizationUrl).searchParams.get('state');
      await client
        .get(`/v1/auth/google/callback?state=${state}&error=access_denied`)
        .expect(302)
        .expect(({ headers }) => expect(headers.location).toContain('oauth=access-denied'));
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

  it('revokes an owned Drive connection and disconnects its sources', async () => {
    await createApp();
    await request(app.getHttpServer()).delete('/v1/oauth-connections/connection-owner').expect(204);
  });

  it('keeps development login POST-only when Google OAuth is unavailable', async () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    try {
      await createApp();
      await request(app.getHttpServer())
        .post('/v1/auth/google/authorize')
        .expect(201)
        .expect(({ body }) =>
          expect(body).toEqual({ available: false, message: 'Google OAuth is not configured.' }),
        );
      await request(app.getHttpServer())
        .post('/v1/auth/development-login')
        .expect(204)
        .expect(({ headers }) =>
          expect(headers['set-cookie']).toEqual(
            expect.arrayContaining([expect.stringContaining('lv_session=')]),
          ),
        );
      await request(app.getHttpServer()).get('/v1/auth/development-login').expect(404);
    } finally {
      if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
      else process.env.GOOGLE_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
      else process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
    }
  });

  it('creates a partial override and reverts exactly to the detected date', async () => {
    await createApp();
    await request(app.getHttpServer())
      .put('/v1/photos/photo-owner/manual-date')
      .send({ year: 2024, month: 2, precision: 'MONTH' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.effectiveDate).toMatchObject({ precision: 'MONTH', origin: 'MANUAL' }),
      );
    await request(app.getHttpServer()).delete('/v1/photos/photo-owner/manual-date').expect(204);
    expect(editablePhotos.get('photo-owner')).toMatchObject({
      effectiveDateValue: new Date('2020-03-04T00:00:00.000Z'),
      effectiveDatePrecision: 'DAY',
      override: null,
    });
  });

  it('edits an owned batch idempotently and denies horizontal photo access', async () => {
    await createApp();
    const body = { photoIds: ['photo-owner', 'photo-owner-2'], year: 2024, precision: 'YEAR' };
    await request(app.getHttpServer())
      .put('/v1/photos/manual-date-overrides')
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .put('/v1/photos/manual-date-overrides')
      .send(body)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(2));
    await request(app.getHttpServer())
      .put('/v1/photos/manual-date-overrides')
      .send({ photoIds: ['photo-other'], year: 2024, precision: 'YEAR' })
      .expect(404);
  });
});
