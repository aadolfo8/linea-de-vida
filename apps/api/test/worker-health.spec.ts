import { describe, expect, it, vi } from 'vitest';
import {
  isWorkerHeartbeatHealthy,
  WORKER_HEALTH_MAX_AGE_MS,
  writeWorkerHeartbeat,
} from '../src/worker-health';

describe('worker heartbeat health', () => {
  it('writes an atomic heartbeat only after Redis responds', async () => {
    const events: string[] = [];
    const write = vi.fn(async (path: string, contents: string) => {
      events.push('write');
      expect(path).toBe('/health.json.42.tmp');
      expect(JSON.parse(contents)).toEqual({ pid: 42, heartbeatAt: 1_000 });
    });
    const replace = vi.fn(async () => {
      events.push('replace');
    });
    await writeWorkerHeartbeat(
      async () => {
        events.push('ping');
      },
      { filePath: '/health.json', pid: 42, now: () => 1_000, write, replace },
    );
    expect(events).toEqual(['ping', 'write', 'replace']);
    expect(replace).toHaveBeenCalledWith('/health.json.42.tmp', '/health.json');
  });

  it('does not update heartbeat when Redis ping fails', async () => {
    const write = vi.fn();
    await expect(
      writeWorkerHeartbeat(() => Promise.reject(new Error('Redis unavailable')), { write }),
    ).rejects.toThrow('Redis unavailable');
    expect(write).not.toHaveBeenCalled();
  });

  it('accepts only a current heartbeat from the expected worker process', () => {
    const heartbeat = JSON.stringify({ pid: 7, heartbeatAt: 20_000 });
    expect(isWorkerHeartbeatHealthy(heartbeat, 20_000, 7)).toBe(true);
    expect(isWorkerHeartbeatHealthy(heartbeat, 20_000 + WORKER_HEALTH_MAX_AGE_MS, 7)).toBe(true);
    expect(isWorkerHeartbeatHealthy(heartbeat, 20_001 + WORKER_HEALTH_MAX_AGE_MS, 7)).toBe(false);
    expect(isWorkerHeartbeatHealthy(heartbeat, 19_999, 7)).toBe(false);
    expect(isWorkerHeartbeatHealthy(heartbeat, 20_000, 1)).toBe(false);
    expect(isWorkerHeartbeatHealthy('not-json', 20_000, 7)).toBe(false);
  });
});
