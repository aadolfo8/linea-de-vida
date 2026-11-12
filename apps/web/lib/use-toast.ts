import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One toast at a time. `show` replaces the current one (a new `key` restarts its animation) and,
 * when `expires` allows, removes it after `ms`; `dismiss` removes it now.
 */
export function useToast<T extends object>(
  ms: number,
  expires: (toast: T) => boolean = () => true,
) {
  const [toast, setToast] = useState<(T & { key: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const counter = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (next: T) => {
      window.clearTimeout(timer.current);
      counter.current += 1;
      setToast({ ...next, key: counter.current });
      if (expires(next)) timer.current = window.setTimeout(() => setToast(null), ms);
    },
    // `expires` is a pure rule supplied inline by callers; `ms` is a constant.
    [ms],
  );

  return { toast, show, dismiss };
}
