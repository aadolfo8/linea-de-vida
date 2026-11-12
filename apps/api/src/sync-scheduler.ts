import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RetentionService } from './retention.service';
import { SyncService } from './sync.service';

const TICK_MS = 2_000;
const RECOVERY_EVERY_MS = 60_000;
const STALE_RUN_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const SHUTDOWN_GRACE_MS = 30_000;
const RETENTION_HOUR_UTC = 4;

/** Delay before retry number `attempt` (1-based): 1 s, 2 s, 4 s, with a little jitter. */
export const retryDelayMs = (attempt: number, random = Math.random()) =>
  Math.round(1_000 * 2 ** (attempt - 1) * (0.75 + random * 0.25));

/**
 * Runs queued syncs inside the API process. `SyncRun` is the queue: a row in QUEUED is a job, its
 * `checkpoint` lets an interrupted run resume, and `attempts` / `nextAttemptAt` carry the retries.
 */
@Injectable()
export class SyncScheduler implements OnApplicationShutdown {
  private readonly logger = new Logger(SyncScheduler.name);
  private readonly running = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private lastRecoveryAt = 0;
  private lastRetentionDay = '';
  /** Last time the loop completed a pass; `/readiness` reports it. */
  lastTickAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly retention: RetentionService,
  ) {}

  private get concurrency() {
    return Math.min(5, Math.max(1, Number(process.env.SYNC_CONCURRENCY ?? 2) || 2));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  /** One pass: recover stale runs, claim what fits in the free slots, run the daily purge. */
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (now.getTime() - this.lastRecoveryAt >= RECOVERY_EVERY_MS) {
        this.lastRecoveryAt = now.getTime();
        await this.recoverStale(now);
      }
      while (this.running.size < this.concurrency) {
        const id = await this.claimNext();
        if (!id) break;
        const job = this.runOne(id).finally(() => this.running.delete(job));
        this.running.add(job);
      }
      await this.purgeOncePerDay(now);
      this.lastTickAt = now;
    } catch (error) {
      this.logger.error(`Scheduler pass failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Atomically takes the oldest due QUEUED run; safe even with several API replicas. */
  async claimNext(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "SyncRun" SET "status" = 'RUNNING', "updatedAt" = now()
      WHERE "id" = (
        SELECT "id" FROM "SyncRun"
        WHERE "status" = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now())
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id"`;
    return rows[0]?.id ?? null;
  }

  /** A run left RUNNING by a crashed process goes back to the queue; its checkpoint resumes it. */
  async recoverStale(now = new Date()) {
    const { count } = await this.prisma.syncRun.updateMany({
      where: { status: 'RUNNING', updatedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
      data: { status: 'QUEUED', nextAttemptAt: null },
    });
    if (count) this.logger.warn(`Requeued ${count} stale sync run(s).`);
    return count;
  }

  async runOne(runId: string) {
    try {
      await this.sync.execute(runId);
    } catch (error) {
      this.logger.warn(`Sync ${runId} failed: ${error instanceof Error ? error.message : error}`);
      await this.retryOrFail(runId).catch((cause: unknown) =>
        this.logger.error(`Sync ${runId} state not saved: ${cause}`),
      );
    }
  }

  /** A transient failure re-queues the run with backoff; the third one marks it FAILED. */
  async retryOrFail(runId: string) {
    const run = await this.prisma.syncRun.findUnique({
      where: { id: runId },
      select: { attempts: true },
    });
    const attempts = (run?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.syncRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: { status: 'FAILED', attempts, nextAttemptAt: null },
      });
      return;
    }
    await this.prisma.syncRun.updateMany({
      where: { id: runId, status: 'RUNNING' },
      data: {
        status: 'QUEUED',
        attempts,
        nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
      },
    });
  }

  private async purgeOncePerDay(now: Date) {
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== RETENTION_HOUR_UTC || this.lastRetentionDay === day) return;
    this.lastRetentionDay = day;
    const result = await this.retention.purge(now);
    this.logger.log(`Retention purge: ${JSON.stringify(result)}`);
  }

  /** Stops claiming and waits (bounded) for runs in flight; each page is checkpointed already. */
  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (!this.running.size) return;
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...this.running]),
      new Promise((resolve) => (timeout = setTimeout(resolve, SHUTDOWN_GRACE_MS))),
    ]);
    clearTimeout(timeout);
  }
}
