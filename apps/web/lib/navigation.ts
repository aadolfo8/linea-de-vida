import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * With `link.tsx`, the only place that knows which router the app uses. Screens ask for the
 * pathname and an imperative `push` / `replace`, so swapping the router never touches them.
 */
export function usePathname(): string {
  return useLocation().pathname;
}

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => void navigate(href),
      replace: (href: string) => void navigate(href, { replace: true }),
    }),
    [navigate],
  );
}
