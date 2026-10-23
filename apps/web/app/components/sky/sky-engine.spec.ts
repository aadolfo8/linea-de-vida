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

  describe('damping', () => {
    /** Runs frames of `dt` ms for `total` ms and returns where the track ended up. */
    const chase = (dt: number, total: number) => {
      mount();
      flush();
      engine.trackLength = 20000;
      engine.viewportLength = 1000;
      engine.jumpTo(1000);
      for (let elapsed = 0; elapsed < total; elapsed += dt) {
        const callbacks = queue.splice(0);
        clock += dt;
        callbacks.forEach((callback) => callback(clock));
      }
      return engine.current;
    };
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('covers the same distance in the same time whatever the frame rate', () => {
      const at60 = chase(16, 480);
      engine.detach();
      document.body.replaceChildren();
      queue = [];
      engine = new SkyEngine();
      const at30 = chase(32, 480);
      expect(at60).toBeGreaterThan(900);
      expect(Math.abs(at60 - at30)).toBeLessThan(15);
    });

    it('keeps the desktop feel: about a tenth of the gap per 60Hz frame', () => {
      expect(chase(16.67, 16.67)).toBeCloseTo(100, -1);
    });

    it('follows almost directly on a coarse pointer', () => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({ matches: query === '(pointer: coarse)' }),
      });
      expect(chase(16, 96)).toBeGreaterThan(990);
    });

    it('does not jump when a frame stalls', () => {
      expect(chase(500, 500)).toBeLessThan(500);
    });
  });

  describe('touch swipes', () => {
    const touch = (type: string, x: number, y: number, at: number, ended = false) => {
      const event = new Event(type, { cancelable: true, bubbles: true }) as Event & {
        touches: unknown[];
      };
      Object.defineProperty(event, 'timeStamp', { value: at });
      event.touches = ended ? [] : [{ clientX: x, clientY: y }];
      window.dispatchEvent(event);
      return event;
    };
    const ready = (orientation: 'horizontal' | 'vertical') => {
      mount();
      engine.configure({ orientation, reduced: false });
      flush();
      engine.trackLength = 10000;
      engine.viewportLength = 1000;
      engine.jumpTo(2000);
      flush();
    };

    it('travels sideways with a horizontal finger and keeps the gesture from scrolling', () => {
      ready('horizontal');
      touch('touchstart', 300, 200, 0);
      const move = touch('touchmove', 200, 205, 16);
      expect(move.defaultPrevented).toBe(true);
      expect(engine.target).toBe(2100);
      touch('touchmove', 100, 210, 32);
      expect(engine.target).toBe(2200);
    });

    it('leaves vertical swipes and taps to the page', () => {
      ready('horizontal');
      touch('touchstart', 300, 200, 0);
      expect(touch('touchmove', 302, 100, 16).defaultPrevented).toBe(false);
      expect(touch('touchmove', 200, 90, 32).defaultPrevented).toBe(false);
      expect(engine.target).toBe(2000);
      touch('touchstart', 300, 200, 100);
      expect(touch('touchmove', 303, 202, 116).defaultPrevented).toBe(false);
    });

    it('does nothing in vertical orientation', () => {
      ready('vertical');
      touch('touchstart', 300, 200, 0);
      expect(touch('touchmove', 100, 200, 16).defaultPrevented).toBe(false);
      expect(engine.target).toBe(2000);
    });

    it('keeps coasting after release, then comes to rest', () => {
      ready('horizontal');
      touch('touchstart', 500, 200, 0);
      touch('touchmove', 400, 200, 16);
      touch('touchmove', 300, 200, 32);
      touch('touchend', 300, 200, 40, true);
      const released = engine.target;
      flush(20);
      expect(engine.target).toBeGreaterThan(released + 50);
      flush();
      const rest = engine.target;
      flush();
      expect(engine.target).toBe(rest);
      expect(queue).toHaveLength(0);
    });

    it('carries no momentum with reduced motion, and a new touch stops it', () => {
      ready('horizontal');
      engine.configure({ orientation: 'horizontal', reduced: true });
      touch('touchstart', 500, 200, 0);
      touch('touchmove', 300, 200, 16);
      touch('touchend', 300, 200, 20, true);
      const released = engine.target;
      flush();
      expect(engine.target).toBe(released);

      engine.configure({ orientation: 'horizontal', reduced: false });
      touch('touchstart', 500, 200, 100);
      touch('touchmove', 400, 200, 116);
      touch('touchmove', 300, 200, 132);
      touch('touchend', 300, 200, 136, true);
      flush(3);
      touch('touchstart', 300, 200, 200);
      const stopped = engine.target;
      flush();
      expect(engine.target).toBe(stopped);
    });
  });
});
