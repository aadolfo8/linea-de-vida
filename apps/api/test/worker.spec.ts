import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  ready: vi.fn(),
  disconnect: vi.fn(),
  contextClose: vi.fn(),
  failExhausted: vi.fn(),
  clearHeartbeat: vi.fn(),
  writeHeartbeat: vi.fn(),
  ping: vi.fn(),
  getService: vi.fn(),
  redisCreated: vi.fn(),
  workerCreated: vi.fn(),
  handlers: new Map<string, (...args: any[]) => void>(),
}));
vi.mock('../src/app.module', () => ({ AppModule: class {} }));
vi.mock('../src/production', () => ({ loadRuntimeConfig: vi.fn() }));
vi.mock('../src/worker-health', () => ({
  clearWorkerHeartbeat: mocks.clearHeartbeat,
  WORKER_HEALTH_INTERVAL_MS: 5_000,
  writeWorkerHeartbeat: mocks.writeHeartbeat,
}));
vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: async () => ({
      get: mocks.getService,
      close: mocks.contextClose,
    }),
  },
}));
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(...args: unknown[]) {
      mocks.workerCreated(...args);
    }
    on(event: string, handler: (...args: any[]) => void) {
      mocks.handlers.set(event, handler);
    }
    isRunning = () => true;
    close = mocks.close;
    waitUntilReady = mocks.ready;
  },
}));
vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      mocks.redisCreated(...args);
    }
    on = vi.fn();
    ping = mocks.ping;
    disconnect = mocks.disconnect;
  },
}));

import { bootstrap } from '../src/worker';

describe('worker lifecycle', () => {
  let runtime: Awaited<ReturnType<typeof bootstrap>> | undefined;
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.handlers.clear();
    mocks.ready.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.contextClose.mockResolvedValue(undefined);
    mocks.failExhausted.mockResolvedValue(undefined);
    mocks.clearHeartbeat.mockResolvedValue(undefined);
    mocks.writeHeartbeat.mockImplementation(async (ping: () => Promise<unknown>) => ping());
    mocks.ping.mockResolvedValue('PONG');
    mocks.getService.mockReturnValue({ execute: vi.fn(), failExhausted: mocks.failExhausted });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(async () => {
    await runtime?.shutdown().catch(() => {});
    runtime = undefined;
    vi.restoreAllMocks();
  });

  it('drains active jobs before closing Redis and Prisma, only once', async () => {
    let finish!: () => void;
    mocks.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    runtime = await bootstrap();
    const stopping = runtime.shutdown();
    expect(runtime.shutdown()).toBe(stopping);
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.contextClose).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
  });

  it('waits for final failed-job status writes before closing the context', async () => {
    let finish!: () => void;
    mocks.failExhausted.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    runtime = await bootstrap();
    mocks.handlers.get('failed')!({
      attemptsMade: 3,
      opts: { attempts: 3 },
      data: { syncRunId: 'run' },
    });
    const stopping = runtime.shutdown();
    await Promise.resolve();
    expect(mocks.contextClose).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(mocks.failExhausted).toHaveBeenCalledWith('run');
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
  });

  it.each(['getService', 'redisCreated', 'workerCreated'] as const)(
    'closes the context if %s fails before readiness',
    async (stage) => {
      const before = process.listenerCount('SIGTERM');
      mocks[stage].mockImplementationOnce(() => {
        throw new Error('initialization failed');
      });
      await expect(bootstrap()).rejects.toThrow('initialization failed');
      expect(mocks.contextClose).toHaveBeenCalledTimes(1);
      expect(mocks.disconnect).toHaveBeenCalledTimes(stage === 'workerCreated' ? 1 : 0);
      expect(process.listenerCount('SIGTERM')).toBe(before);
    },
  );

  it('waits for pending failure writes even if worker close rejects', async () => {
    let finish!: () => void;
    mocks.failExhausted.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const closeError = new Error('worker close failed');
    mocks.close.mockRejectedValue(closeError);
    runtime = await bootstrap();
    mocks.handlers.get('failed')!({ attemptsMade: 1, opts: {}, data: { syncRunId: 'run' } });
    const stopping = runtime.shutdown().catch((error) => error);
    await Promise.resolve();
    await Promise.resolve();
    const contextClosedEarly = mocks.contextClose.mock.calls.length;
    const redisClosedEarly = mocks.disconnect.mock.calls.length;
    finish();
    expect(await stopping).toBe(closeError);
    expect(contextClosedEarly).toBe(0);
    expect(redisClosedEarly).toBe(0);
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cleans up startup failure and removes signal handlers', async () => {
    const before = process.listenerCount('SIGTERM');
    mocks.ready.mockRejectedValue(new Error('not ready'));
    await expect(bootstrap()).rejects.toThrow('not ready');
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('handles termination through the same shutdown path', async () => {
    const before = new Set(process.listeners('SIGTERM'));
    runtime = await bootstrap();
    const handler = process.listeners('SIGTERM').find((candidate) => !before.has(candidate));
    expect(handler).toBeDefined();
    handler!('SIGTERM');
    await runtime.shutdown();
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(process.listeners('SIGTERM')).not.toContain(handler);
  });

  it('contains failed-status persistence errors without an unhandled rejection', async () => {
    mocks.failExhausted.mockRejectedValue(new Error('database unavailable'));
    runtime = await bootstrap();
    mocks.handlers.get('failed')!({ attemptsMade: 1, opts: {}, data: { syncRunId: 'run' } });
    await runtime.shutdown();
    expect(console.error).toHaveBeenCalledWith(
      JSON.stringify({ event: 'sync_failure_persist_error' }),
    );
    expect(mocks.contextClose).toHaveBeenCalledTimes(1);
  });
});
