import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const placeholder = /replace-with|change-me|example/i;

export type RuntimeConfig = {
  isProduction: boolean;
  apiOrigin: string;
  allowedOrigins: string[];
  sessionSecret: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  mutationRateLimitMax: number;
  bodyLimit: string;
  metricsToken?: string;
};

const urlOrigin = (value: string, name: string, httpsRequired: boolean) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }
  if (parsed.origin !== value.replace(/\/$/, '') || (httpsRequired && parsed.protocol !== 'https:'))
    throw new Error(`${name} must be an origin${httpsRequired ? ' using HTTPS' : ''}.`);
  return parsed.origin;
};

const positiveInteger = (value: string | undefined, fallback: number, name: string) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
};

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const isProduction = env.NODE_ENV === 'production';
  const apiOrigin = urlOrigin(
    env.API_ORIGIN ?? 'http://localhost:3001',
    'API_ORIGIN',
    isProduction,
  );
  const rawOrigins = env.ALLOWED_WEB_ORIGINS ?? env.WEB_ORIGIN ?? 'http://localhost:3000';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => urlOrigin(origin, 'ALLOWED_WEB_ORIGINS', isProduction));
  if (!allowedOrigins.length) throw new Error('At least one allowed web origin is required.');

  const sessionSecret = env.SESSION_SECRET ?? '';
  const tokenKey = env.TOKEN_ENCRYPTION_KEY ?? '';
  if (isProduction) {
    if (sessionSecret.length < 32 || placeholder.test(sessionSecret))
      throw new Error('SESSION_SECRET must be a non-placeholder secret of at least 32 characters.');
    let decoded: Buffer;
    try {
      decoded = Buffer.from(tokenKey, 'base64');
    } catch {
      throw new Error('TOKEN_ENCRYPTION_KEY must be base64 encoded.');
    }
    if (placeholder.test(tokenKey) || decoded.length !== 32)
      throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    for (const name of ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
      if (!env[name] || placeholder.test(env[name]!))
        throw new Error(`${name} is required in production.`);
    for (const name of ['GOOGLE_LOGIN_REDIRECT_URI', 'GOOGLE_DRIVE_REDIRECT_URI']) {
      const value = env[name];
      if (!value) throw new Error(`${name} is required in production.`);
      const redirect = new URL(value);
      if (redirect.protocol !== 'https:' || redirect.origin !== apiOrigin)
        throw new Error(`${name} must use HTTPS and the API_ORIGIN.`);
    }
    if (!env.METRICS_TOKEN || env.METRICS_TOKEN.length < 32 || placeholder.test(env.METRICS_TOKEN))
      throw new Error('METRICS_TOKEN must be a non-placeholder secret of at least 32 characters.');
  }
  return {
    isProduction,
    apiOrigin,
    allowedOrigins,
    sessionSecret,
    rateLimitWindowMs: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 60_000, 'RATE_LIMIT_WINDOW_MS'),
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 120, 'RATE_LIMIT_MAX'),
    mutationRateLimitMax: positiveInteger(
      env.RATE_LIMIT_MUTATION_MAX,
      30,
      'RATE_LIMIT_MUTATION_MAX',
    ),
    bodyLimit: env.REQUEST_BODY_LIMIT ?? '32kb',
    metricsToken: env.METRICS_TOKEN,
  };
}

export function isAllowedOrigin(origin: string | undefined, config: RuntimeConfig) {
  return Boolean(origin && config.allowedOrigins.includes(origin));
}

export const requestIdMiddleware = (request: Request, response: Response, next: NextFunction) => {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  response.locals.requestId = requestId;
  const startedAt = Date.now();
  response.on('finish', () => {
    // Deliberately omit URL, route parameters, cookies, headers, body and user identity.
    console.info(
      JSON.stringify({
        event: 'http_request',
        requestId,
        method: request.method,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      }),
    );
  });
  next();
};

export const securityHeadersMiddleware = (_: Request, response: Response, next: NextFunction) => {
  response.set({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  next();
};

type Bucket = { count: number; resetAt: number };
const MAX_MEMORY_RATE_LIMIT_BUCKETS = 10_000;
const MEMORY_RATE_LIMIT_CLEANUP_INTERVAL_MS = 1_000;
const MEMORY_RATE_LIMIT_CLEANUP_INTERVAL_OPERATIONS = 128;
export type RateLimitStore = {
  increment(key: string, windowMs: number): Promise<{ count: number; retryAfterMs: number }>;
};

export type TrafficClass =
  | 'oauthAuthorize'
  | 'oauthCallback'
  | 'auth'
  | 'timeline'
  | 'media'
  | 'mutation'
  | 'json';

export function classifyTraffic(
  request: Pick<Request, 'method' | 'originalUrl' | 'url'>,
): TrafficClass {
  const path = (request.originalUrl || request.url || '').split('?', 1)[0];
  if (/^\/v1\/(auth\/google|oauth\/google\/drive)\/callback$/.test(path)) return 'oauthCallback';
  if (/^\/v1\/(auth\/google|oauth\/google)/.test(path)) return 'oauthAuthorize';
  if (path === '/v1/me' || path.startsWith('/v1/auth/')) return 'auth';
  if (/^\/v1\/photos\/[^/]+\/(thumbnail|content)$/.test(path)) return 'media';
  if (path.startsWith('/v1/timeline/')) return 'timeline';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return 'mutation';
  return 'json';
}

class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastCleanupAt = 0;
  private operationsSinceCleanup = 0;

  constructor(private readonly maxBuckets: number) {}

  async increment(key: string, windowMs: number) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt <= now) this.buckets.delete(key);

    this.operationsSinceCleanup += 1;
    const shouldCleanup =
      this.operationsSinceCleanup >= MEMORY_RATE_LIMIT_CLEANUP_INTERVAL_OPERATIONS ||
      now - this.lastCleanupAt >= MEMORY_RATE_LIMIT_CLEANUP_INTERVAL_MS;
    if (shouldCleanup) {
      this.operationsSinceCleanup = 0;
      this.lastCleanupAt = now;
      for (const [bucketKey, existing] of this.buckets) {
        if (existing.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }

    const current = this.buckets.get(key);
    if (!current && this.buckets.size >= this.maxBuckets) {
      // Reject new identities instead of evicting live buckets and letting key churn bypass limits.
      return { count: Number.MAX_SAFE_INTEGER, retryAfterMs: Math.max(1, windowMs) };
    }
    const next = current ?? { count: 0, resetAt: now + windowMs };
    next.count += 1;
    this.buckets.set(key, next);
    return { count: next.count, retryAfterMs: Math.max(1, next.resetAt - now) };
  }
}

export function createMemoryRateLimitStore(maxBuckets = MAX_MEMORY_RATE_LIMIT_BUCKETS) {
  if (!Number.isInteger(maxBuckets) || maxBuckets < 1)
    throw new Error('maxBuckets must be a positive integer.');
  return new MemoryRateLimitStore(maxBuckets);
}

export function createRateLimitMiddleware(
  config: RuntimeConfig,
  store: RateLimitStore = createMemoryRateLimitStore(),
) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const trafficClass = classifyTraffic(request);
    const limits: Record<TrafficClass, number> = {
      oauthAuthorize: Math.max(20, config.mutationRateLimitMax),
      oauthCallback: Math.max(20, config.mutationRateLimitMax),
      auth: Math.max(30, Math.ceil(config.rateLimitMax / 2)),
      timeline: config.rateLimitMax,
      media: Math.max(config.rateLimitMax * 4, 240),
      mutation: config.mutationRateLimitMax,
      json: config.rateLimitMax,
    };
    const limit = limits[trafficClass];
    const sessionId = request.signedCookies?.lv_session;
    const identity = sessionId || request.ip || 'anonymous';
    const key = `rate:${trafficClass}:${identity}`;
    const current = await store.increment(key, config.rateLimitWindowMs);
    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - current.count)));
    if (current.count > limit) {
      response.setHeader('Retry-After', String(Math.ceil(current.retryAfterMs / 1000)));
      return response.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
        requestId: response.locals.requestId,
      });
    }
    next();
  };
}
