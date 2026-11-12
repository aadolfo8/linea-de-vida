import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Chrome fades away after this long without pointer or keyboard activity. */
const IDLE_DELAY = 2600;

/**
 * Idle chrome: the controls fade after a still moment, but never from under the pointer or from a
 * keyboard user who has focus inside them. Call `poke` on any activity.
 */
export function useIdleChrome(dialog: RefObject<HTMLElement | null>) {
  const [idle, setIdle] = useState(false);
  const timer = useRef(0);
  const overChrome = useRef(false);
  const keyboardInput = useRef(false);

  const poke = useCallback(
    (keyboard = false) => {
      keyboardInput.current = keyboard;
      setIdle(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const active = document.activeElement;
        const focusInChrome =
          active instanceof HTMLElement &&
          active !== dialog.current &&
          dialog.current?.contains(active);
        if (overChrome.current || (keyboardInput.current && focusInChrome)) return;
        setIdle(true);
      }, IDLE_DELAY);
    },
    [dialog],
  );

  useEffect(() => {
    poke();
    return () => window.clearTimeout(timer.current);
  }, [poke]);

  return { idle, poke, overChrome };
}
