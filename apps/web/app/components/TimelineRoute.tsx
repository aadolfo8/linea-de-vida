'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ArchiveNav } from './ArchiveNav';
import { ImmersiveTimelineExperience } from './ImmersiveTimelineExperience';
import { ProtectedSurface } from './ProtectedSurface';
import { useTimelineFocus } from './TimelineFocus';
import { parseTimelineRoute, timelineHref } from './timeline-model';
import { Button } from '../../components/ui/button';

export function TimelineRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const { focused, setFocused } = useTimelineFocus();
  const enterRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(focused);
  const route = parseTimelineRoute(pathname);
  const routeDepth = route.month || route.unknown ? 'month' : route.year ? 'year' : 'panorama';

  useEffect(() => {
    if (!route.invalid) return;
    router.replace(timelineHref({ year: route.year }), { scroll: false });
  }, [route.invalid, route.year, router]);

  useEffect(() => {
    if (previousFocus.current === focused) return;
    previousFocus.current = focused;
    if (focused) exitRef.current?.focus();
    else enterRef.current?.focus();
  }, [focused]);

  useEffect(() => {
    if (!focused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest('[role="dialog"]'))
      )
        return;
      event.preventDefault();
      setFocused(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focused, setFocused]);

  return (
    <ProtectedSurface>
      {(session) => (
        <div
          className="timeline-immersive-shell min-h-dvh"
          data-route-depth={routeDepth}
          data-focus={focused ? 'on' : 'off'}
        >
          {!focused && (
            <>
              <ArchiveNav name={session.user.displayName} />
              <nav
                className="relative z-[19] flex min-h-[3.25rem] items-center justify-end gap-3 border-b border-map-line bg-map-paper px-[max(1rem,5vw)] py-2 text-map-muted max-[680px]:justify-between max-[680px]:flex-wrap"
                aria-label="Vista de la cronología"
              >
                <Button
                  ref={enterRef}
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-current text-inherit hover:bg-map-route-soft/40"
                  onClick={() => setFocused(true)}
                >
                  Concentrar vista
                </Button>
              </nav>
            </>
          )}
          {focused && (
            <div
              className="sticky top-0 z-[21] flex justify-end bg-map-paper px-[max(1rem,5vw)] py-2 text-map-ink data-[route-depth=month]:relative"
              data-route-depth={routeDepth}
            >
              <Button
                ref={exitRef}
                variant="outline"
                size="sm"
                className="rounded-lg border-current text-inherit"
                onClick={() => setFocused(false)}
              >
                Salir del modo concentración
              </Button>
            </div>
          )}
          {route.invalid ? (
            <main
              className="grid min-h-dvh place-items-center bg-map-paper p-6 text-map-ink"
              aria-live="polite"
            >
              Corrigiendo la ruta temporal…
            </main>
          ) : (
            <ImmersiveTimelineExperience />
          )}
        </div>
      )}
    </ProtectedSurface>
  );
}
