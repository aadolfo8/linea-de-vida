/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkyEngine } from './sky-engine';

describe('sky engine loop', () => {
  let queue: FrameRequestCallback[];
  let clock: number;
  let engine: SkyEngine;

  const flush = (limit = 400) => {
    let frames = 0;
    while (queue.length && frames < limit) {
      const callbacks = queue.splice(0);
      clock += 16;
      callbacks.forEach((callback) => callback(clock));
      frames += 1;
    }
    return frames;
  };

  const mount = () => {
    const make = (tag: string) => document.createElement(tag) as HTMLElement;
    const parts = {
      scroller: make('div'),
      track: make('div'),
      world: make('div'),
      canvas: make('canvas') as HTMLCanvasElement,
    };
    document.body.append(parts.scroller, parts.track);
    engine.attach(parts);
    return parts;
  };

  beforeEach(() => {
    queue = [];
    clock = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    engine = new SkyEngine();
  });

  afterEach(() => {
    engine.detach();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops asking for frames once the track rests, and wakes up on movement', () => {
    mount();
    const listener = vi.fn();
    engine.subscribe(listener);
    expect(flush()).toBeLessThan(400);
    expect(queue).toHaveLength(0);

    const before = listener.mock.calls.length;
    flush();
    expect(listener.mock.calls.length).toBe(before);

    engine.trackLength = 5000;
    engine.viewportLength = 1000;
    engine.jumpTo(800);
    expect(queue.length).toBeGreaterThan(0);
    flush();
    expect(listener.mock.calls.length).toBeGreaterThan(before);
    expect(engine.current).toBe(800);
    expect(queue).toHaveLength(0);
  });

  it('runs a last frame at rest so subscribers see the settled track', () => {
    mount();
    const frames: boolean[] = [];
    engine.subscribe((frame) => frames.push(frame.moved));
    flush();
    engine.trackLength = 5000;
    engine.viewportLength = 1000;
    frames.length = 0;
    engine.jumpTo(300);
    flush();
    expect(frames[0]).toBe(true);
    expect(frames.at(-1)).toBe(false);
  });

  it('keeps twinkling at rest with a timer instead of frames, and not with reduced motion', () => {
    mount();
    flush();
    expect(vi.getTimerCount()).toBe(1);
    expect(queue).toHaveLength(0);

    engine.reduced = true;
    engine.jumpTo(0);
    flush();
    // The pending timer stops itself on its next tick when motion is reduced.
    vi.advanceTimersByTime(500);
    expect(vi.getTimerCount()).toBe(0);
    expect(queue).toHaveLength(0);
  });

  it('wakes on a new subscriber, a measurement and a warp', () => {
    mount();
    flush();
    engine.subscribe(() => undefined);
    expect(queue.length).toBeGreaterThan(0);
    flush();
    engine.measure();
    expect(queue.length).toBeGreaterThan(0);
    flush();
    engine.startWarp(1);
    expect(queue.length).toBeGreaterThan(0);
  });

  it('looks items up by key and forgets released ones', () => {
    mount();
    const a = document.createElement('div');
    const b = document.createElement('div');
    const first = engine.register(a, 'a');
    engine.register(b, 'b');
    expect(engine.itemByKey('a')?.el).toBe(a);
    expect(engine.itemByKey('b')?.el).toBe(b);
    first.release();
    expect(engine.itemByKey('a')).toBeNull();
    expect(engine.itemByKey('b')?.el).toBe(b);
  });
});
