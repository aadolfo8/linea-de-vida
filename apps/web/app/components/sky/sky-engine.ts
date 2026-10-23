import type { SkyOrientation } from './orientation';
import { clamp, seededRng } from './rng';
import { createStars, drawStars, starCount, warpEnvelope, type Star } from './starfield';
import { WARP_DURATION } from './travel';
import { isCoarsePointer } from './viewport';

/** A measured element on the track. Offsets come from layout, never from transformed rects. */
export type SkyItem = {
  key: string | null;
  el: HTMLElement;
  /** Position inside the track. */
  x: number;
  y: number;
  /** Offset and size along the travel axis. */
  o: number;
  s: number;
  /** False until the first layout measurement, so consumers do not act on zeroed offsets. */
  measured: boolean;
};

export type SkyFrame = {
  current: number;
  moved: boolean;
  /** Viewport length along the travel axis. */
  length: number;
  time: number;
  orientation: SkyOrientation;
};

type Parts = {
  scroller: HTMLElement;
  track: HTMLElement;
  world: HTMLElement;
  canvas: HTMLCanvasElement;
};

/**
 * Time constants (ms) of the chase of the track after the scroll position. 158ms is what a
 * 10% step per 60Hz frame used to be, now independent of the frame rate. A finger already
 * brings its own momentum, so touch follows almost directly instead of smoothing it twice.
 */
const DAMPING_TAU = 158;
const DAMPING_TAU_TOUCH = 18;
/** Longest step integrated at once, so a stalled frame does not make the track jump. */
const MAX_FRAME_DT = 64;
const NOMINAL_FRAME_DT = 1000 / 60;
const JUMP_LEAD = 0.12;
/** Rate of the canvas-only redraw while the track rests. */
const TWINKLE_INTERVAL = 100;
/** A touch must travel this far before it is read as a drag along one axis. */
const SWIPE_SLOP = 8;
/** Momentum of a released swipe decays with this time constant (ms). */
const FLING_TAU = 325;
/** Slower than this (px/ms) a release carries no momentum. */
const FLING_MIN_SPEED = 0.05;
/** Only the last stretch of the gesture decides how fast it was released. */
const FLING_WINDOW = 90;
const TEXT_ENTRY = 'input, textarea, select, [contenteditable="true"], [role="dialog"]';

/**
 * Drives one sticky stage: the document scrolls natively (keyboard, scrollbar, touch and
 * assistive technology keep working) while the track is translated with inertia, along either
 * axis, and a canvas starfield drifts with it.
 */
export class SkyEngine {
  orientation: SkyOrientation = 'vertical';
  reduced = false;
  current = 0;
  target = 0;
  trackLength = 0;
  viewportLength = 0;
  /** While travelling between depths, native scroll no longer drives the track. */
  busy = false;

  private parts: Parts | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private items = new Set<SkyItem>();
  private keyed = new Map<string, SkyItem>();
  private frameListeners = new Set<(frame: SkyFrame) => void>();
  private measureListeners = new Set<() => void>();
  private stars: Star[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private warp = { start: 0, active: false, value: 0, direction: 1 as 1 | -1 };
  private raf = 0;
  /** Timestamp of the previous frame of a run; 0 when the loop was idle. */
  private lastFrame = 0;
  private coarse = false;
  private twinkleTimer = 0;
  private lastDraw = -1;
  private dirty = true;
  private measureQueued = false;
  private observer: ResizeObserver | null = null;
  private cleanups: (() => void)[] = [];
  private swipe: {
    x: number;
    y: number;
    origin: number;
    axis: 'x' | 'y' | null;
    samples: { x: number; t: number }[];
  } | null = null;
  /** Momentum (px/ms along the travel axis) left by a released swipe. */
  private fling = 0;

  get maxScroll() {
    return Math.max(0, this.trackLength - this.viewportLength);
  }

  get horizontal() {
    return this.orientation === 'horizontal';
  }

  attach(parts: Parts) {
    this.parts = parts;
    this.ctx = parts.canvas.getContext('2d');
    this.coarse = isCoarsePointer();
    this.resize();

    const on = <K extends keyof WindowEventMap>(
      type: K,
      handler: (event: WindowEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, handler, options);
      this.cleanups.push(() => window.removeEventListener(type, handler));
    };
    on(
      'scroll',
      () => {
        if (this.busy) return;
        this.target = clamp(window.scrollY, 0, this.maxScroll);
        this.startLoop();
      },
      { passive: true },
    );
    // Sideways travel follows a horizontal finger. Vertical gestures stay with native scroll,
    // which the track already follows, and a tap never moves enough to be taken for a drag.
    on(
      'touchstart',
      (event) => {
        this.fling = 0;
        const touch = event.touches[0];
        if (!touch || event.touches.length > 1 || this.busy || !this.horizontal) {
          this.swipe = null;
          return;
        }
        this.swipe = {
          x: touch.clientX,
          y: touch.clientY,
          origin: this.target,
          axis: null,
          samples: [{ x: touch.clientX, t: event.timeStamp }],
        };
      },
      { passive: true },
    );
    on(
      'touchmove',
      (event) => {
        const swipe = this.swipe;
        const touch = event.touches[0];
        if (!swipe || !touch || this.busy || !this.horizontal) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (!swipe.axis) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_SLOP) return;
          swipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        }
        if (swipe.axis !== 'x') return;
        if (event.cancelable) event.preventDefault();
        swipe.samples.push({ x: touch.clientX, t: event.timeStamp });
        while (swipe.samples.length > 2 && event.timeStamp - swipe.samples[0]!.t > FLING_WINDOW)
          swipe.samples.shift();
        this.jumpTo(swipe.origin - dx);
      },
      { passive: false },
    );
    const endSwipe = (event: TouchEvent) => {
      const swipe = this.swipe;
      if (event.touches.length > 0) return;
      this.swipe = null;
      if (!swipe || swipe.axis !== 'x' || this.reduced) return;
      const first = swipe.samples[0]!;
      const last = swipe.samples[swipe.samples.length - 1]!;
      const elapsed = last.t - first.t;
      if (elapsed <= 0 || event.timeStamp - last.t > FLING_WINDOW) return;
      const speed = -(last.x - first.x) / elapsed;
      if (Math.abs(speed) < FLING_MIN_SPEED) return;
      this.fling = speed;
      this.startLoop();
    };
    on('touchend', endSwipe, { passive: true });
    on(
      'touchcancel',
      () => {
        this.swipe = null;
      },
      { passive: true },
    );
    on(
      'wheel',
      (event) => {
        // Trackpads report sideways travel as deltaX; the page itself only scrolls vertically.
        if (!this.horizontal || event.ctrlKey || this.busy) return;
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        this.jumpTo(this.target + event.deltaX);
      },
      { passive: false },
    );
    on('keydown', (event) => {
      if (
        !this.horizontal ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      if (event.target instanceof Element && event.target.closest(TEXT_ENTRY)) return;
      event.preventDefault();
      this.jumpTo(this.target + (event.key === 'ArrowRight' ? 1 : -1) * this.width * 0.6);
    });
    const onVisibility = () => {
      if (document.hidden) this.stopLoop();
      else {
        this.dirty = true;
        this.startLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.scheduleMeasure());
      this.observer.observe(parts.track);
    }
    this.measure();
    this.startLoop();
  }

  detach() {
    this.stopLoop();
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.observer?.disconnect();
    this.observer = null;
    this.parts = null;
    this.ctx = null;
  }

  /** Applies a new orientation or motion preference after React has committed the layout. */
  configure(options: { orientation: SkyOrientation; reduced: boolean }) {
    const changed = options.orientation !== this.orientation;
    const progress = this.maxScroll > 0 ? clamp(this.target / this.maxScroll) : 0;
    this.orientation = options.orientation;
    this.reduced = options.reduced;
    this.dirty = true;
    if (!this.parts) return;
    this.resize();
    this.measure();
    if (changed) {
      this.jumpTo(progress * this.maxScroll);
      this.current = this.target;
    }
    this.startLoop();
  }

  /** Viewport size changed: rebuild the sky and re-measure. */
  resize() {
    if (!this.parts) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.parts.canvas.width = this.width * this.dpr;
    this.parts.canvas.height = this.height * this.dpr;
    this.stars = createStars(starCount(this.width, this.height), seededRng(3));
    this.dirty = true;
    this.startLoop();
  }

  register(el: HTMLElement, key: string | null = null) {
    const item: SkyItem = { key, el, x: 0, y: 0, o: 0, s: 0, measured: false };
    this.items.add(item);
    if (key !== null) this.keyed.set(key, item);
    this.scheduleMeasure();
    return {
      item,
      release: () => {
        this.items.delete(item);
        if (key !== null && this.keyed.get(key) === item) this.keyed.delete(key);
      },
    };
  }

  itemByKey(key: string) {
    return this.keyed.get(key) ?? null;
  }

  /** Re-measure on the next frame; cheap to call from many places. */
  scheduleMeasure() {
    if (this.measureQueued || !this.parts) return;
    this.measureQueued = true;
    requestAnimationFrame(() => {
      this.measureQueued = false;
      this.measure();
    });
  }

  measure() {
    const parts = this.parts;
    if (!parts) return;
    this.viewportLength = this.horizontal ? window.innerWidth : window.innerHeight;
    for (const item of this.items) {
      let x = 0;
      let y = 0;
      let el: HTMLElement | null = item.el;
      while (el && el !== parts.track) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      item.measured = true;
      item.x = x;
      item.y = y;
      item.o = this.horizontal ? x : y;
      item.s = this.horizontal ? item.el.offsetWidth : item.el.offsetHeight;
    }
    this.trackLength = this.horizontal ? parts.track.scrollWidth : parts.track.scrollHeight;
    parts.scroller.style.height = `${Math.max(
      window.innerHeight,
      this.trackLength - this.viewportLength + window.innerHeight,
    )}px`;
    this.target = clamp(this.target, 0, this.maxScroll);
    this.measureListeners.forEach((listener) => listener());
    this.startLoop();
  }

  jumpTo(position: number) {
    const next = clamp(position, 0, this.maxScroll);
    window.scrollTo({ top: next, behavior: 'instant' });
    this.target = next;
    this.startLoop();
  }

  /** Centre of an item in viewport pixels once the track rests at `position`. */
  centerInViewport(item: SkyItem, position = this.current) {
    const width = this.horizontal ? item.s : item.el.offsetWidth;
    const height = this.horizontal ? item.el.offsetHeight : item.s;
    return this.horizontal
      ? { x: item.o + width / 2 - position, y: item.y + height / 2 }
      : { x: item.x + width / 2, y: item.o + height / 2 - position };
  }

  /** Brings an item near the leading edge, as the rail does. */
  scrollToItem(item: SkyItem, snap = false) {
    this.jumpTo(item.o - this.viewportLength * JUMP_LEAD);
    if (snap || this.reduced) this.current = this.target;
  }

  subscribe(listener: (frame: SkyFrame) => void) {
    this.frameListeners.add(listener);
    this.startLoop();
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onMeasure(listener: () => void) {
    this.measureListeners.add(listener);
    return () => {
      this.measureListeners.delete(listener);
    };
  }

  /** Streaks the stars outward (travelling in) or inward (travelling out). */
  startWarp(direction: 1 | -1) {
    if (this.reduced) return;
    this.warp = { start: performance.now(), active: true, value: 0, direction };
    this.startLoop();
  }

  /**
   * Brings an element on screen without animating, e.g. while a dialog covers the sky and the
   * photo it shows changes: closing then shrinks back onto a tile that is really there.
   */
  follow(el: HTMLElement) {
    const parts = this.parts;
    if (!parts) return;
    let offset = 0;
    let node: HTMLElement | null = el;
    while (node && node !== parts.track) {
      offset += this.horizontal ? node.offsetLeft : node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    const size = this.horizontal ? el.offsetWidth : el.offsetHeight;
    const start = offset - this.current;
    if (start >= 0 && start + size <= this.viewportLength) return;
    this.jumpTo(offset + size / 2 - this.viewportLength / 2);
    this.current = this.target;
    this.dirty = true;
    this.startLoop();
  }

  /** Sync the track to wherever native scroll is now, e.g. after a restored position. */
  syncToScroll() {
    this.target = clamp(window.scrollY, 0, this.maxScroll);
    this.startLoop();
  }

  /** Runs a frame soon, e.g. after something a subscriber reacts to changed outside the track. */
  wake() {
    this.startLoop();
  }

  private startLoop() {
    if (!this.parts || document.hidden) return;
    if (this.twinkleTimer) window.clearTimeout(this.twinkleTimer);
    this.twinkleTimer = 0;
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.twinkleTimer) window.clearTimeout(this.twinkleTimer);
    this.twinkleTimer = 0;
    this.lastFrame = 0;
  }

  /** At rest the stars still twinkle, but only the canvas redraws, at a low rate. */
  private twinkle = () => {
    this.twinkleTimer = 0;
    if (!this.parts || document.hidden || this.reduced) return;
    this.draw(performance.now(), false);
    this.twinkleTimer = window.setTimeout(this.twinkle, TWINKLE_INTERVAL);
  };

  /** Carries a released swipe on: the target keeps drifting while its speed fades out. */
  private coast(time: number) {
    const elapsed = this.lastFrame ? time - this.lastFrame : NOMINAL_FRAME_DT;
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, elapsed));
    const next = clamp(this.target + this.fling * dt, 0, this.maxScroll);
    const blocked = next === this.target;
    this.fling *= Math.exp(-dt / FLING_TAU);
    if (blocked || Math.abs(this.fling) < FLING_MIN_SPEED / 4) this.fling = 0;
    if (next !== this.target) this.jumpTo(next);
  }

  /** Fraction of the remaining distance to cover this frame: `1 - exp(-dt / tau)`. */
  private dampingStep(time: number) {
    if (this.reduced) return 1;
    const elapsed = this.lastFrame ? time - this.lastFrame : NOMINAL_FRAME_DT;
    this.lastFrame = time;
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, elapsed));
    return 1 - Math.exp(-dt / (this.coarse ? DAMPING_TAU_TOUCH : DAMPING_TAU));
  }

  private frame = (time: number) => {
    this.raf = 0;
    const parts = this.parts;
    if (!parts) return;
    if (this.warp.active) {
      const elapsed = time - this.warp.start;
      this.warp.value = warpEnvelope(elapsed, WARP_DURATION);
      if (elapsed >= WARP_DURATION) this.warp = { ...this.warp, active: false, value: 0 };
    }
    if (this.fling !== 0) this.coast(time);
    const previous = this.current;
    this.current += (this.target - this.current) * this.dampingStep(time);
    if (Math.abs(this.target - this.current) < 0.05) this.current = this.target;
    const moved = previous !== this.current;
    parts.track.style.transform = this.horizontal
      ? `translate3d(${-this.current}px,0,0)`
      : `translate3d(0,${-this.current}px,0)`;
    this.draw(time, moved);
    const frame: SkyFrame = {
      current: this.current,
      moved,
      length: this.viewportLength,
      time,
      orientation: this.orientation,
    };
    this.frameListeners.forEach((listener) => listener(frame));
    // Keep going while anything moves; the frame after the last movement already ran, so
    // subscribers saw the track at rest. Everything that changes state wakes the loop again.
    if (moved || this.fling !== 0 || this.warp.active || this.dirty || Math.abs(this.target - this.current) > 0) {
      this.startLoop();
    } else {
      this.lastFrame = 0;
      if (!this.reduced) this.twinkleTimer = window.setTimeout(this.twinkle, TWINKLE_INTERVAL);
    }
  };

  private draw(time: number, moved: boolean) {
    const ctx = this.ctx;
    if (!ctx) {
      this.dirty = false;
      return;
    }
    const warping = this.warp.value > 0.002;
    // Twinkle needs periodic redraws; reduced motion only redraws when something changed.
    const stale = !this.reduced && time - this.lastDraw >= 33;
    if (!(moved || warping || stale || this.dirty)) return;
    this.lastDraw = time;
    this.dirty = false;
    drawStars(ctx, this.stars, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      current: this.current,
      time,
      horizontal: this.horizontal,
      warp: this.warp.value,
      warpDirection: this.warp.direction,
      reduced: this.reduced,
    });
  }
}
