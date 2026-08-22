import { describe, expect, it, vi } from 'vitest';
import {
  createRateLimitMiddleware,
  isAllowedOrigin,
  loadRuntimeConfig,
  requestIdMiddleware,
  securityHeadersMiddleware,
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

  it('rate limits mutations per signed user', () => {
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
      signedCookies: { lv_session: 'user-1' },
      ip: '127.0.0.1',
    };
    const next = vi.fn();
    middleware(request, response, next);
    middleware(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(429);
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
