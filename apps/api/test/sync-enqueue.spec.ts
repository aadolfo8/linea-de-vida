import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { add, close, disconnect, queueCreated, redisCreated } = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  disconnect: vi.fn(),
  queueCreated: vi.fn(),
  redisCreated: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      queueCreated(...args);
    }
    add = add;
    close = close;
    on = vi.fn();
  },
}));

vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      redisCreated(...args);
    }
    disconnect = disconnect;
    on = vi.fn();
  },
}));

import { SyncService, syncJobId } from '../src/sync.service';

describe('sync enqueue', () => {
  const source = { id: 'source:one', userId: 'owner', status: 'ACTIVE' };
  const run = { id: '12345', photoSourceId: source.id, status: 'QUEUED' };
  const prisma: any = {
    photoSource: { findFirst: vi.fn(async () => source) },
    syncRun: {
      findFirst: vi.fn(async () => run),
      create: vi.fn(async () => run),
    },
  };
  let service: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncService(prisma, {} as any, {} as any);
    add.mockResolvedValue({});
    close.mockResolvedValue(undefined);
  });

  it('uses a BullMQ-safe, non-numeric job ID that distinguishes source and run', () => {
    const jobId = syncJobId('source:one', '12345');

    expect(jobId).toMatch(/^sync-s\d+-[A-Za-z0-9_-]*r\d+-[A-Za-z0-9_-]*$/);
    expect(jobId).not.toContain(':');
    expect(jobId).not.toMatch(/^\d+$/);
    expect(syncJobId('source-one', '12345')).not.toBe(jobId);
    expect(syncJobId('source:one', '12346')).not.toBe(jobId);
  });

  it('re-enqueues the same active run with the same job ID for BullMQ idempotency', async () => {
    await service.enqueue('owner', source.id);
    await service.enqueue('owner', source.id);

    expect(add).toHaveBeenCalledTimes(2);
    expect(queueCreated).toHaveBeenCalledTimes(1);
    expect(redisCreated).toHaveBeenCalledExactlyOnceWith(expect.any(String), {
      maxRetriesPerRequest: 1,
    });
    expect(add.mock.calls.map(([, , options]) => options.jobId)).toEqual([
      syncJobId(source.id, run.id),
      syncJobId(source.id, run.id),
    ]);
  });

  it('returns a controlled service-unavailable error when BullMQ rejects enqueueing', async () => {
    add.mockRejectedValueOnce(new Error('Redis unavailable'));

    const error = await service.enqueue('owner', source.id).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'SYNC_ENQUEUE_FAILED',
      message: 'The sync could not be queued. Please try again.',
    });
  });

  it('does not open Redis for an unused producer and closes idempotently', async () => {
    await service.onModuleDestroy();
    await service.onModuleDestroy();
    expect(redisCreated).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the queue before releasing Redis and rejects later submissions', async () => {
    await service.enqueue('owner', source.id);
    await Promise.all([service.onModuleDestroy(), service.onModuleDestroy()]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(disconnect.mock.invocationCallOrder[0]);
    await expect(service.enqueue('owner', source.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('releases Redis even if queue shutdown fails', async () => {
    await service.enqueue('owner', source.id);
    close.mockRejectedValueOnce(new Error('close failed'));
    await expect(service.onModuleDestroy()).rejects.toThrow('close failed');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
