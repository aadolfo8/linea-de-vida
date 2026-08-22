import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import {
  createRateLimitMiddleware,
  isAllowedOrigin,
  loadRuntimeConfig,
  requestIdMiddleware,
  securityHeadersMiddleware,
} from './production';
async function bootstrap() {
  const config = loadRuntimeConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));
  app.use(cookieParser(config.sessionSecret));
  app.use(requestIdMiddleware);
  app.use(createRateLimitMiddleware(config));
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
