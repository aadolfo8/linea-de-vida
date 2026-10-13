import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import IORedis from 'ioredis';
import { AppModule } from './app.module';
import {
  createRateLimitMiddleware,
  createResilientRateLimitStore,
  isAllowedOrigin,
  loadRuntimeConfig,
  requestIdMiddleware,
  type RateLimitStore,
  securityHeadersMiddleware,
} from './production';
async function bootstrap() {
  const config = loadRuntimeConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));
  app.use(cookieParser(config.sessionSecret));
  app.use(requestIdMiddleware);
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on('error', (error) => {
    console.error(
      JSON.stringify({
        event: 'rate_limit_redis_error',
        message: error instanceof Error ? error.message : 'Unknown Redis error.',
      }),
    );
  });
  const redisRateLimitStore: RateLimitStore = {
    increment: async (key, windowMs) => {
      const result = (await redis.eval(
        `local count = redis.call('INCR', KEYS[1])
         if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
         return {count, redis.call('PTTL', KEYS[1])}`,
        1,
        key,
        windowMs,
      )) as [number, number];
      return { count: Number(result[0]), retryAfterMs: Math.max(1, Number(result[1])) };
    },
  };
  const rateLimitStore = createResilientRateLimitStore(redisRateLimitStore);
  app.use(createRateLimitMiddleware(config, rateLimitStore));
  app.use(securityHeadersMiddleware);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, !origin || isAllowedOrigin(origin, config)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
    maxAge: 600,
  });
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.info(JSON.stringify({ event: 'api_listening', port }));
}
void bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'api_start_failed',
      message: error instanceof Error ? error.message : 'Unknown startup error.',
    }),
  );
  process.exitCode = 1;
});
