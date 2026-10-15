'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArchiveNav } from './ArchiveNav';
import { ImmersiveTimelineExperience } from './ImmersiveTimelineExperience';
import { ProtectedSurface } from './ProtectedSurface';
import { useTimelineFocus } from './TimelineFocus';
import {
  parseTimelineRoute,
  safeOrganizeReturnHref,
  timelineHref,
  timelineHrefWithReturn,
} from './timeline-model';
import { Button } from '../../components/ui/button';

export function TimelineRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const { focused, setFocused } = useTimelineFocus();
  const [organizeReturn, setOrganizeReturn] = useState<{ href: string; label: string } | null>(
    null,
  );
  const enterRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef(focused);
  const route = parseTimelineRoute(pathname);
  const routeDepth = route.month || route.unknown ? 'month' : route.year ? 'year' : 'panorama';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const href = safeOrganizeReturnHref(params.get('returnTo'), window.location.origin);
    const label = params.get('returnLabel')?.trim().slice(0, 100) || 'tu carpeta';
    setOrganizeReturn(href ? { href, label } : null);
  }, [pathname]);

  useEffect(() => {
    if (!route.invalid) return;
    router.replace(
      timelineHrefWithReturn(
        timelineHref({ year: route.year }),
        organizeReturn?.href ?? null,
        organizeReturn?.label,
      ),
      { scroll: false },
    );
  }, [organizeReturn?.href, route.invalid, route.year, router]);

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
          {organizeReturn && (
            <aside
              className="flex flex-wrap items-center justify-between gap-3 border-b border-map-line bg-map-panel px-[max(1rem,5vw)] py-3 text-sm"
              aria-label="Continuar organizando"
            >
              <p className="m-0 max-w-[70ch] text-map-muted">
                Este periodo reúne fotografías de tus carpetas. Puedes volver a continuar con{' '}
                <strong className="text-map-ink">{organizeReturn.label}</strong>.
              </p>
              <a
                className="inline-flex min-h-11 items-center font-semibold text-map-ink underline-offset-4 hover:text-map-route hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-route"
                href={organizeReturn.href}
              >
                Volver a Organizar
              </a>
            </aside>
          )}
          {route.invalid ? (
            <main
              className="grid min-h-dvh place-items-center bg-map-paper p-6 text-map-ink"
              aria-live="polite"
            >
              Corrigiendo la ruta temporal…
            </main>
          ) : (
            <ImmersiveTimelineExperience
              organizeReturnTo={organizeReturn?.href ?? null}
              organizeReturnLabel={organizeReturn?.label ?? null}
            />
          )}
        </div>
      )}
    </ProtectedSurface>
  );
}
