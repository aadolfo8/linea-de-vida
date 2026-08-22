import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('bullmq', () => ({
  Queue: class {
    add = add;
  },
}));

vi.mock('ioredis', () => ({
  default: class {},
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
  const service = new SyncService(prisma, {} as any, {} as any);

  beforeEach(() => {
    add.mockReset();
    add.mockResolvedValue({});
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
});
