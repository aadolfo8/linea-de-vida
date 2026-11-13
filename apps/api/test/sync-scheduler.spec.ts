import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler, retryDelayMs } from '../src/sync-scheduler';
import { SyncService } from '../src/sync.service';

const makePrisma = () => {
  const prisma: any = {
    $queryRaw: vi.fn(async () => []),
    syncRun: {
      findUnique: vi.fn(async () => ({ attempts: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return prisma;
};

describe('sync enqueue', () => {
  const source = { id: 'source-1', userId: 'owner', status: 'ACTIVE' };
  const run = { id: 'run-1', photoSourceId: source.id, status: 'QUEUED' };

  it('creates a QUEUED run and reuses the one already active, without any queue', async () => {
    const prisma: any = {
      photoSource: { findFirst: vi.fn(async () => source) },
      syncRun: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(run),
        create: vi.fn(async () => run),
      },
    };
    const service = new SyncService(prisma, {} as any, {} as any);
    expect(await service.enqueue('owner', source.id)).toBe(run);
    expect(await service.enqueue('owner', source.id)).toBe(run);
    expect(prisma.syncRun.create).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue for a source that is not owned', async () => {
    const prisma: any = { photoSource: { findFirst: vi.fn(async () => null) } };
    const service = new SyncService(prisma, {} as any, {} as any);
    await expect(service.enqueue('intruder', source.id)).rejects.toMatchObject({
      response: { code: 'SOURCE_NOT_FOUND' },
    });
  });
});

describe('SyncScheduler', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let sync: { execute: ReturnType<typeof vi.fn> };
  let retention: { purge: ReturnType<typeof vi.fn> };
  let scheduler: SyncScheduler;

  beforeEach(() => {
    prisma = makePrisma();
    sync = { execute: vi.fn(async () => undefined) };
    retention = { purge: vi.fn(async () => ({ issuesDeleted: 0, runsDeleted: 0 })) };
    scheduler = new SyncScheduler(prisma, sync as any, retention as any);
  });

  it('backs off exponentially: 1 s, 2 s, 4 s', () => {
    expect([1, 2, 3].map((attempt) => retryDelayMs(attempt, 1))).toEqual([1_000, 2_000, 4_000]);
    expect(retryDelayMs(1, 0)).toBe(750);
  });

  it('claims and executes queued runs until the queue is empty', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }]);
    await scheduler.tick();
    await scheduler.onApplicationShutdown();
    expect(sync.execute.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(scheduler.lastTickAt).toBeInstanceOf(Date);
  });

  it('never runs more than the configured concurrency', async () => {
    process.env.SYNC_CONCURRENCY = '1';
    let release!: () => void;
    sync.execute.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    prisma.$queryRaw.mockResolvedValue([{ id: 'a' }]);
    await scheduler.tick();
    await scheduler.tick();
    expect(sync.execute).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    release();
    await scheduler.onApplicationShutdown();
    delete process.env.SYNC_CONCURRENCY;
  });

  it('requeues a failed run with backoff and fails it after the third attempt', async () => {
    await scheduler.retryOrFail('run');
    expect(prisma.syncRun.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'run', status: 'RUNNING' },
      data: { status: 'QUEUED', attempts: 1, nextAttemptAt: expect.any(Date) },
    });
    prisma.syncRun.findUnique.mockResolvedValue({ attempts: 2 });
    await scheduler.retryOrFail('run');
    expect(prisma.syncRun.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'run', status: 'RUNNING' },
      data: { status: 'FAILED', attempts: 3, nextAttemptAt: null },
    });
  });

  it('retries when execution throws instead of crashing the loop', async () => {
    sync.execute.mockRejectedValueOnce(new Error('Drive unavailable'));
    await scheduler.runOne('run');
    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'QUEUED' }) }),
    );
  });

  it('requeues runs abandoned by a crashed process', async () => {
    const now = new Date('2026-11-12T10:00:00Z');
    await scheduler.recoverStale(now);
    expect(prisma.syncRun.updateMany).toHaveBeenCalledWith({
      where: { status: 'RUNNING', updatedAt: { lt: new Date('2026-11-12T09:50:00Z') } },
      data: { status: 'QUEUED', nextAttemptAt: null },
    });
  });

  it('reports itself alive only while the loop keeps ticking', async () => {
    expect(scheduler.isAlive()).toBe(false);
    const at = new Date('2026-11-12T10:00:00Z');
    await scheduler.tick(at);
    expect(scheduler.isAlive(at.getTime() + 30_000)).toBe(true);
    expect(scheduler.isAlive(at.getTime() + 61_000)).toBe(false);
  });

  it('purges old sync metadata once a day at 04:00 UTC', async () => {
    await scheduler.tick(new Date('2026-11-12T03:59:00Z'));
    expect(retention.purge).not.toHaveBeenCalled();
    await scheduler.tick(new Date('2026-11-12T04:00:10Z'));
    await scheduler.tick(new Date('2026-11-12T04:30:00Z'));
    expect(retention.purge).toHaveBeenCalledTimes(1);
  });
});
