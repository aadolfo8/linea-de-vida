import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

const media = () => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);

function subscribe(notify: () => void) {
  const query = media();
  query?.addEventListener?.('change', notify);
  return () => query?.removeEventListener?.('change', notify);
}

/** True when the person asked the system for less motion. Server render assumes motion is fine. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => media()?.matches ?? false,
    () => false,
  );
}
