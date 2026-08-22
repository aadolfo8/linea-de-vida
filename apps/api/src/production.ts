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
    for (const name of ['DATABASE_URL', 'REDIS_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
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
export function createRateLimitMiddleware(config: RuntimeConfig) {
  const buckets = new Map<string, Bucket>();
  return (request: Request, response: Response, next: NextFunction) => {
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const limit = mutation ? config.mutationRateLimitMax : config.rateLimitMax;
    const identity = request.signedCookies?.lv_session ?? request.ip ?? 'anonymous';
    const key = `${mutation ? 'write' : 'read'}:${identity}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    const current =
      !bucket || bucket.resetAt <= now
        ? { count: 0, resetAt: now + config.rateLimitWindowMs }
        : bucket;
    current.count += 1;
    buckets.set(key, current);
    response.setHeader('RateLimit-Limit', String(limit));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, limit - current.count)));
    if (current.count > limit) {
      response.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return response.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many requests.',
        requestId: response.locals.requestId,
      });
    }
    next();
  };
}
