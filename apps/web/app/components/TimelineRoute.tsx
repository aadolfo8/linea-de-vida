'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { ArchiveNav } from './ArchiveNav';
import { ImmersiveTimelineExperience } from './ImmersiveTimelineExperience';
import { ProtectedSurface } from './ProtectedSurface';
import { TimelineExperience } from './TimelineExperience';
import { useTimelineFocus } from './TimelineFocus';
import { parseTimelineRoute, timelineHref, type TimelineView } from './timeline-model';
import styles from './timeline-route.module.css';

export function TimelineRoute({ view = 'immersive' }: { view?: TimelineView }) {
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
    router.replace(timelineHref({ year: route.year, view }), { scroll: false });
  }, [route.invalid, route.year, router, view]);

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
          className={`${styles.shell} ${view === 'editorial' ? 'timeline-editorial-shell' : 'timeline-immersive-shell'}`}
          data-mode={view}
          data-route-depth={routeDepth}
          data-focus={focused ? 'on' : 'off'}
        >
          {!focused && (
            <>
              <ArchiveNav name={session.user.displayName} timelinePath={timelineHref({ view })} />
              <nav className={styles.modeBar} aria-label="Vista de la cronología">
                <span>Vista</span>
                <div>
                  <Link
                    href={pathname}
                    aria-current={view === 'immersive' ? 'page' : undefined}
                    scroll={false}
                  >
                    Inmersiva
                  </Link>
                  <Link
                    href={`${pathname}?view=editorial`}
                    aria-current={view === 'editorial' ? 'page' : undefined}
                    scroll={false}
                  >
                    Editorial
                  </Link>
                </div>
                <button
                  ref={enterRef}
                  className={styles.focusButton}
                  onClick={() => setFocused(true)}
                >
                  Concentrar vista
                </button>
              </nav>
            </>
          )}
          {focused && (
            <div className={styles.focusExit}>
              <button
                ref={exitRef}
                className={styles.focusButton}
                onClick={() => setFocused(false)}
              >
                Salir del modo concentración
              </button>
            </div>
          )}
          {route.invalid ? (
            <main className="route-pending" aria-live="polite">
              Corrigiendo la ruta temporal…
            </main>
          ) : view === 'editorial' ? (
            <TimelineExperience view="editorial" />
          ) : (
            <ImmersiveTimelineExperience />
          )}
        </div>
      )}
    </ProtectedSurface>
  );
}
