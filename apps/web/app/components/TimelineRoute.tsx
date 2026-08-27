'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ArchiveNav } from './ArchiveNav';
import { ImmersiveTimelineExperience } from './ImmersiveTimelineExperience';
import { ProtectedSurface } from './ProtectedSurface';
import { TimelineExperience } from './TimelineExperience';
import { parseTimelineRoute, timelineHref, type TimelineView } from './timeline-model';
import styles from './timeline-route.module.css';

export function TimelineRoute({ view = 'immersive' }: { view?: TimelineView }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = parseTimelineRoute(pathname);

  useEffect(() => {
    if (!route.invalid) return;
    router.replace(timelineHref({ year: route.year, view }), { scroll: false });
  }, [route.invalid, route.year, router, view]);

  return (
    <ProtectedSurface>
      {(session) => (
        <div
          className={`${styles.shell} ${view === 'editorial' ? 'timeline-editorial-shell' : 'timeline-immersive-shell'}`}
          data-mode={view}
        >
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
          </nav>
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
