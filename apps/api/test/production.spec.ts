import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryRateLimitStore,
  createRateLimitMiddleware,
  createResilientRateLimitStore,
  isAllowedOrigin,
  loadRuntimeConfig,
  requestIdMiddleware,
  securityHeadersMiddleware,
  type RateLimitStore,
} from '../src/production';
import { CsrfGuard } from '../src/auth';

const productionEnv = {
  NODE_ENV: 'production',
  API_ORIGIN: 'https://api.example.test',
  ALLOWED_WEB_ORIGINS: 'https://app.example.test',
  SESSION_SECRET: 'a'.repeat(32),
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  DATABASE_URL: 'postgresql://user:credential-value@db.internal.test/app',
  REDIS_URL: 'rediss://redis.internal.test',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_LOGIN_REDIRECT_URI: 'https://api.example.test/v1/auth/google/callback',
  GOOGLE_DRIVE_REDIRECT_URI: 'https://api.example.test/v1/oauth/google/drive/callback',
  METRICS_TOKEN: 'm'.repeat(32),
};

describe('production controls', () => {
  it('rejects weak production secrets and non-HTTPS origins', () => {
    expect(() => loadRuntimeConfig({ ...productionEnv, SESSION_SECRET: 'short' })).toThrow(
      'SESSION_SECRET',
    );
    expect(() =>
      loadRuntimeConfig({ ...productionEnv, ALLOWED_WEB_ORIGINS: 'http://app.example.test' }),
    ).toThrow('HTTPS');
  });

  it('restricts CORS to configured origins', () => {
    const config = loadRuntimeConfig(productionEnv);
    expect(isAllowedOrigin('https://app.example.test', config)).toBe(true);
    expect(isAllowedOrigin('https://attacker.example.test', config)).toBe(false);
  });

  it('rejects an authenticated mutation from an untrusted origin', () => {
    const context: any = {
      switchToHttp: () => ({ getRequest: () => ({ get: () => 'https://attacker.example.test' }) }),
    };
    expect(() => new CsrfGuard().canActivate(context)).toThrow('origin is not allowed');
  });

  it('rate limits mutations per signed user and returns Retry-After', async () => {
    const middleware = createRateLimitMiddleware(
      loadRuntimeConfig({ RATE_LIMIT_MUTATION_MAX: '1' }),
    );
    const response: any = {
      locals: {},
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const request: any = {
      method: 'POST',
      originalUrl: '/v1/photo-sources',
      signedCookies: { lv_session: 'user-1' },
      ip: '127.0.0.1',
    };
    const next = vi.fn();
    await middleware(request, response, next);
    await middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('isolates timeline exhaustion from session and unauthenticated OAuth capacity', async () => {
    const middleware = createRateLimitMiddleware(loadRuntimeConfig({ RATE_LIMIT_MAX: '1' }));
    const response: any = {
      locals: { requestId: 'request-id' },
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    const base = { method: 'GET', signedCookies: { lv_session: 'user-1' }, ip: '127.0.0.1' };
    await middleware({ ...base, originalUrl: '/v1/timeline/years' } as any, response, next);
    await middleware({ ...base, originalUrl: '/v1/timeline/years' } as any, response, next);
    await middleware({ ...base, originalUrl: '/v1/me' } as any, response, next);
    await middleware(
      {
        method: 'GET',
        originalUrl: '/v1/auth/google/callback',
        signedCookies: {},
        ip: '127.0.0.2',
      } as any,
      response,
      next,
    );
    expect(response.status).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('gives OAuth callbacks protected capacity independent from authorization traffic', async () => {
    const middleware = createRateLimitMiddleware(
      loadRuntimeConfig({ RATE_LIMIT_MUTATION_MAX: '20' }),
    );
    const response: any = {
      locals: { requestId: 'oauth-request-id' },
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();
    const request = { method: 'POST', signedCookies: {}, ip: '127.0.0.3' };

    for (let attempt = 0; attempt < 20; attempt += 1)
      await middleware(
        { ...request, originalUrl: '/v1/auth/google/authorize' } as any,
        response,
        next,
      );
    await middleware(
      { ...request, method: 'GET', originalUrl: '/v1/auth/google/callback' } as any,
      response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(21);
    expect(response.status).not.toHaveBeenCalled();

    for (let attempt = 0; attempt < 20; attempt += 1)
      await middleware(
        { ...request, method: 'GET', originalUrl: '/v1/auth/google/callback' } as any,
        response,
        next,
      );

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RATE_LIMITED', requestId: 'oauth-request-id' }),
    );
  });

  it('rate limits with a bounded per-process fallback and returns to Redis when it recovers', async () => {
    const redisError = new Error("Stream isn't writeable and enableOfflineQueue options is false");
    const primary: RateLimitStore = {
      increment: vi
        .fn()
        .mockRejectedValueOnce(redisError)
        .mockRejectedValueOnce(redisError)
        .mockResolvedValueOnce({ count: 1, retryAfterMs: 60_000 }),
    };
    const middleware = createRateLimitMiddleware(
      loadRuntimeConfig({ RATE_LIMIT_MUTATION_MAX: '1' }),
      createResilientRateLimitStore(primary),
    );
    const response: any = {
      locals: { requestId: 'fallback-request-id' },
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const request: any = {
      method: 'POST',
      originalUrl: '/v1/photo-sources',
      signedCookies: { lv_session: 'user-1' },
      ip: '127.0.0.1',
    };
    const next = vi.fn();

    await middleware(request, response, next);
    await middleware(request, response, next);
    await middleware(request, response, next);

    expect(primary.increment).toHaveBeenCalledTimes(3);
    expect(primary.increment).toHaveBeenCalledWith('rate:mutation:user-1', 60_000);
    expect(next).toHaveBeenCalledTimes(2);
    expect(response.status).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RATE_LIMITED', requestId: 'fallback-request-id' }),
    );
  });

  it('bounds fallback identities without evicting active buckets and recovers expired capacity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
    try {
      const store = createMemoryRateLimitStore(2);
      await expect(store.increment('first', 5_000)).resolves.toEqual({
        count: 1,
        retryAfterMs: 5_000,
      });
      await store.increment('second', 5_000);
      await expect(store.increment('first', 5_000)).resolves.toEqual({
        count: 2,
        retryAfterMs: 5_000,
      });
      await expect(store.increment('overflow', 5_000)).resolves.toEqual({
        count: Number.MAX_SAFE_INTEGER,
        retryAfterMs: 5_000,
      });

      vi.advanceTimersByTime(5_000);
      await expect(store.increment('overflow', 5_000)).resolves.toEqual({
        count: 1,
        retryAfterMs: 5_000,
      });
      await expect(store.increment('first', 5_000)).resolves.toEqual({
        count: 1,
        retryAfterMs: 5_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid in-memory fallback capacity', () => {
    expect(() => createMemoryRateLimitStore(0)).toThrow('maxBuckets');
  });

  it('adds security and request-id headers without logging private request fields', () => {
    const response: any = {
      locals: {},
      set: vi.fn(),
      setHeader: vi.fn(),
      on: vi.fn((event, callback) => event === 'finish' && callback()),
      statusCode: 200,
    };
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    requestIdMiddleware(
      { method: 'GET', url: '/private/photo.jpg?token=secret' } as any,
      response,
      vi.fn(),
    );
    securityHeadersMiddleware({} as any, response, vi.fn());
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Referrer-Policy': 'no-referrer' }),
    );
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
    expect(log.mock.calls[0]![0]).not.toContain('photo.jpg');
    expect(log.mock.calls[0]![0]).not.toContain('secret');
    log.mockRestore();
  });
});
