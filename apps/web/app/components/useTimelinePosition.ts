import { useEffect, useLayoutEffect, useRef } from 'react';

const positions = new Map<string, number>();

/**
 * Keep each temporal destination's position while its asynchronous content returns. A depth
 * with nothing to restore starts at the top, because the document outlives route changes.
 * Pass `restorePosition: false` when something else (landing on a group) decides the position.
 * `variant` (e.g. the travel orientation) splits the saved slot without restarting the hook:
 * changing it keeps the position the owner of the variant chose and leaves the other slot alone.
 */
export function useTimelinePosition(
  path: string,
  { restorePosition = true, variant = '' }: { restorePosition?: boolean; variant?: string } = {},
) {
  const variantRef = useRef(variant);
  useLayoutEffect(() => {
    variantRef.current = variant;
  });
  useEffect(() => {
    const slot = () => `${variantRef.current}:${path}`;
    const target = restorePosition ? (positions.get(slot()) ?? 0) : 0;
    let restoring = target > 0;
    if (!restoring && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
    const remember = () => {
      if (!restoring) positions.set(slot(), window.scrollY);
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
  }, [path, restorePosition]);
}
