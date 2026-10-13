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
  const concurrency = Math.min(10, Math.max(5, Number(process.env.SYNC_CONCURRENCY ?? 5)));
  let sync: SyncService;
  let connection: IORedis | undefined;
  let worker: Worker;
  try {
    sync = context.get(SyncService);
    connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    connection.on('error', () =>
      console.error(JSON.stringify({ event: 'sync_worker_redis_error' })),
    );
    worker = new Worker('photo-sync', async (job) => sync.execute(job.data.syncRunId), {
      connection,
      concurrency,
    });
  } catch (error) {
    connection?.disconnect();
    await context.close();
    throw error;
  }
  const pendingFailures = new Set<Promise<void>>();
  worker.on('error', () => console.error(JSON.stringify({ event: 'sync_worker_error' })));
  worker.on('failed', (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const pending = sync
        .failExhausted(job.data.syncRunId)
        .catch(() => console.error(JSON.stringify({ event: 'sync_failure_persist_error' })))
        .then(() => {
          pendingFailures.delete(pending);
        });
      pendingFailures.add(pending);
    }
  });
  let closing: Promise<void> | undefined;
  const shutdown = () => {
    closing ??= (async () => {
      try {
        // Keep Prisma and Redis available until active jobs and final status writes finish.
        await worker.close();
      } finally {
        try {
          await Promise.all(pendingFailures);
        } finally {
          connection?.disconnect();
          try {
            await context.close();
          } finally {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
          }
        }
      }
    })();
    return closing;
  };
  const onSignal = () => {
    void shutdown().catch(() => {
      console.error(JSON.stringify({ event: 'sync_worker_shutdown_failed' }));
      process.exitCode = 1;
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    await worker.waitUntilReady();
  } catch (error) {
    await shutdown();
    throw error;
  }
  console.info(JSON.stringify({ event: 'sync_worker_ready', queue: 'photo-sync', concurrency }));
  return { context, worker, shutdown };
}
if (require.main === module)
  void bootstrap().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'sync_worker_start_failed',
        message: error instanceof Error ? error.message : 'Unknown startup error.',
      }),
    );
    process.exitCode = 1;
  });
