import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AppModule } from './app.module';
import { SyncService } from './sync.service';
import { loadRuntimeConfig } from './production';
export async function bootstrap() {
  loadRuntimeConfig();
  const context = await NestFactory.createApplicationContext(AppModule);
  const sync = context.get(SyncService);
  const concurrency = Math.min(10, Math.max(5, Number(process.env.SYNC_CONCURRENCY ?? 5)));
  const worker = new Worker('photo-sync', async (job) => sync.execute(job.data.syncRunId), {
    connection: new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    }),
    concurrency,
  });
  worker.on('failed', (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1))
      void sync.failExhausted(job.data.syncRunId);
  });
  await worker.waitUntilReady();
  console.info(JSON.stringify({ event: 'sync_worker_ready', queue: 'photo-sync', concurrency }));
  return { context, worker };
}
void bootstrap().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'sync_worker_start_failed',
      message: error instanceof Error ? error.message : 'Unknown startup error.',
    }),
  );
  process.exitCode = 1;
});
