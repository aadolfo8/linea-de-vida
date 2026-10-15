'use client';

import { useEffect } from 'react';

const positions = new Map<string, number>();

/** Keep each temporal destination's position while its asynchronous gallery returns. */
export function useTimelinePosition(path: string) {
  useEffect(() => {
    const target = positions.get(path) ?? 0;
    let restoring = target > 0;
    const remember = () => {
      if (!restoring) positions.set(path, window.scrollY);
    };
    const stop = () => {
      restoring = false;
      observer?.disconnect();
    };
    const restore = () => {
      if (!restoring) return;
      window.scrollTo({ top: target, behavior: 'instant' });
      if (document.documentElement.scrollHeight - window.innerHeight >= target) stop();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(restore);
    if (restoring) observer?.observe(document.body);
    const frame = requestAnimationFrame(restore);
    const timeout = window.setTimeout(stop, 4000);
    window.addEventListener('scroll', remember, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      remember();
      stop();
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.removeEventListener('scroll', remember);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stop);
      if (positions.size > 100) positions.delete(positions.keys().next().value!);
    };
  }, [path]);
}
