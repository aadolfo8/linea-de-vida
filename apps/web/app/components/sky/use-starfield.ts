'use client';

import { useEffect, type RefObject } from 'react';
import { seededRng } from './rng';
import { createStars, drawStars, starCount } from './starfield';

/** Twinkle is slow, so ~30 fps is indistinguishable and halves the work. */
const FRAME_MS = 33;

/**
 * Paints the shared night starfield on a full-viewport canvas outside the timeline engine.
 * DPR is capped at 2, the loop stops while the tab is hidden, and with reduced motion the
 * sky is drawn once (and again on resize) instead of animating.
 */
export function useStarfield(canvasRef: RefObject<HTMLCanvasElement | null>, reduced: boolean) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let stars = createStars(0, seededRng(3));
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let last = 0;
    let resizeTimer = 0;

    const paint = (time: number) =>
      drawStars(ctx, stars, {
        width,
        height,
        dpr,
        current: 0,
        time,
        horizontal: false,
        warp: 0,
        warpDirection: 1,
        reduced,
      });

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      stars = createStars(starCount(width, height), seededRng(3));
      paint(performance.now());
    };

    const tick = (time: number) => {
      frame = window.requestAnimationFrame(tick);
      if (time - last < FRAME_MS) return;
      last = time;
      paint(time);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const start = () => {
      if (reduced || frame || document.hidden) return;
      frame = window.requestAnimationFrame(tick);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    };

    resize();
    start();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canvasRef, reduced]);
}
