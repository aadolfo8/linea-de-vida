import type { SkyOrientation } from './orientation';
import { clamp, seededRng } from './rng';
import { createStars, drawStars, starCount, warpEnvelope, type Star } from './starfield';
import { WARP_DURATION } from './travel';

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

const SMOOTHING = 0.1;
const JUMP_LEAD = 0.12;
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
  private frameListeners = new Set<(frame: SkyFrame) => void>();
  private measureListeners = new Set<() => void>();
  private stars: Star[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private warp = { start: 0, active: false, value: 0, direction: 1 as 1 | -1 };
  private raf = 0;
  private lastDraw = -1;
  private dirty = true;
  private measureQueued = false;
  private observer: ResizeObserver | null = null;
  private cleanups: (() => void)[] = [];

  get maxScroll() {
    return Math.max(0, this.trackLength - this.viewportLength);
  }

  get horizontal() {
    return this.orientation === 'horizontal';
  }

  attach(parts: Parts) {
    this.parts = parts;
    this.ctx = parts.canvas.getContext('2d');
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
        if (!this.busy) this.target = clamp(window.scrollY, 0, this.maxScroll);
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
      else this.startLoop();
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
  }

  register(el: HTMLElement, key: string | null = null) {
    const item: SkyItem = { key, el, x: 0, y: 0, o: 0, s: 0, measured: false };
    this.items.add(item);
    this.scheduleMeasure();
    return {
      item,
      release: () => {
        this.items.delete(item);
      },
    };
  }

  itemByKey(key: string) {
    for (const item of this.items) if (item.key === key) return item;
    return null;
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
  }

  jumpTo(position: number) {
    const next = clamp(position, 0, this.maxScroll);
    window.scrollTo({ top: next, behavior: 'instant' });
    this.target = next;
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
  }

  private startLoop() {
    if (this.raf || !this.parts || document.hidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
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
    const previous = this.current;
    this.current += (this.target - this.current) * (this.reduced ? 1 : SMOOTHING);
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
    this.startLoop();
  };

  private draw(time: number, moved: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
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
