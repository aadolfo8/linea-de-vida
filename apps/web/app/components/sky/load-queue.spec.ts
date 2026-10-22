/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadQueue } from './load-queue';

describe('LoadQueue', () => {
  const distances: Record<string, number | null> = {};
  let started: string[];
  let finish: Record<string, () => void>;

  const load = (key: string) => () => {
    started.push(key);
    return new Promise<void>((resolve) => {
      finish[key] = resolve;
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    started = [];
    finish = {};
    for (const key of Object.keys(distances)) delete distances[key];
  });
  afterEach(() => vi.useRealTimers());

  it('starts the group nearest the viewport first, whatever the request order', async () => {
    Object.assign(distances, { a: 900, b: 100, c: 500 });
    const queue = new LoadQueue((key) => distances[key] ?? null, 2);
    (['a', 'b', 'c'] as const).forEach((key) => queue.request(key, load(key), vi.fn()));

    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual(['b', 'c']);
  });

  it('never runs more loads than the cap and starts the next as one finishes', async () => {
    Object.assign(distances, { a: 1, b: 2, c: 3, d: 4 });
    const queue = new LoadQueue((key) => distances[key] ?? null, 3);
    (['a', 'b', 'c', 'd'] as const).forEach((key) => queue.request(key, load(key), vi.fn()));

    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual(['a', 'b', 'c']);

    finish.a!();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps going when a load fails', async () => {
    Object.assign(distances, { a: 1, b: 2 });
    const queue = new LoadQueue((key) => distances[key] ?? null, 1);
    queue.request('a', () => Promise.reject(new Error('offline')), vi.fn());
    queue.request('b', load('b'), vi.fn());

    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual(['b']);
  });

  it('drops a group that is no longer wanted instead of loading it', async () => {
    Object.assign(distances, { a: 1, b: 2, c: 3 });
    const queue = new LoadQueue((key) => distances[key] ?? null, 1);
    const drop = vi.fn();
    queue.request('a', load('a'), vi.fn());
    queue.request('b', load('b'), drop);
    queue.request('c', load('c'), vi.fn());
    await vi.advanceTimersByTimeAsync(50);

    distances.b = null;
    finish.a!();
    await vi.advanceTimersByTimeAsync(0);

    expect(drop).toHaveBeenCalledOnce();
    expect(started).toEqual(['a', 'c']);
  });

  it('ignores a repeated request and forgets everything on clear and dispose', async () => {
    Object.assign(distances, { a: 1, b: 2 });
    const queue = new LoadQueue((key) => distances[key] ?? null, 3);
    queue.request('a', load('a'), vi.fn());
    queue.request('a', load('a'), vi.fn());
    queue.request('b', load('b'), vi.fn());
    queue.clear();
    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual([]);

    queue.request('a', load('a'), vi.fn());
    queue.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(started).toEqual([]);
  });
});
