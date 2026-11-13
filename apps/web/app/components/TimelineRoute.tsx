import { Focus, X } from 'lucide-react';
import { usePathname, useRouter } from '../../lib/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArchiveNav } from './ArchiveNav';
import { createPinchDetector } from './pinch';
import { ProtectedSurface } from './ProtectedSurface';
import { SkyChrome, type SkyCrumb } from './sky/SkyChrome';
import { SkyStage } from './sky/SkyStage';
import { MonthDepth } from './sky/MonthDepth';
import { YearDepth } from './sky/YearDepth';
import { YearsDepth } from './sky/YearsDepth';
import { readOrientation, writeOrientation, type SkyOrientation } from './sky/orientation';
import { useTravel } from './sky/use-travel';
import { useTimelineFocus } from './TimelineFocus';
import {
  monthTitle,
  parseTimelineRoute,
  safeOrganizeReturnHref,
  timelineHref,
  timelineHrefWithReturn,
} from './timeline-model';

export function TimelineRoute() {
  const pathname = usePathname();
  const router = useRouter();
  const travel = useTravel();
  const { focused, setFocused } = useTimelineFocus();
  const [organizeReturn, setOrganizeReturn] = useState<{ href: string; label: string } | null>(
    null,
  );
  const [orientation, setOrientationState] = useState<SkyOrientation>(readOrientation);
  const enterRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const currentCrumbRef = useRef<HTMLSpanElement>(null);
  const previousFocus = useRef(focused);
  const route = parseTimelineRoute(pathname);
  const routeDepth = route.month || route.unknown ? 'month' : route.year ? 'year' : 'panorama';
  const returnTo = organizeReturn?.href ?? null;
  const returnLabel = organizeReturn?.label ?? null;

  const setOrientation = useCallback((value: SkyOrientation) => {
    setOrientationState(value);
    writeOrientation(value);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const href = safeOrganizeReturnHref(params.get('returnTo'), window.location.origin);
    const label = params.get('returnLabel')?.trim().slice(0, 100) || 'tu carpeta';
    setOrganizeReturn(href ? { href, label } : null);
  }, [pathname]);

  useEffect(() => {
    if (!route.invalid) return;
    router.replace(
      timelineHrefWithReturn(timelineHref({ year: route.year }), returnTo, returnLabel),
    );
  }, [returnLabel, returnTo, route.invalid, route.year, router]);

  useEffect(() => {
    if (previousFocus.current === focused) return;
    previousFocus.current = focused;
    if (focused) exitRef.current?.focus();
    else enterRef.current?.focus();
  }, [focused]);

  const withReturn = (href: string) => timelineHrefWithReturn(href, returnTo, returnLabel);
  const goUp = () => {
    if (!route.year) return;
    if (route.month || route.unknown)
      travel(
        withReturn(timelineHref({ year: route.year })),
        'out',
        null,
        route.unknown ? 'sin-mes' : String(route.month),
      );
    else travel(withReturn(timelineHref()), 'out', null, String(route.year));
  };
  const goUpRef = useRef(goUp);
  useEffect(() => {
    goUpRef.current = goUp;
  });

  // Escape closes what is on top: an open dialog first, then concentration mode, then one depth.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        (event.target instanceof Element && event.target.closest('[role="dialog"]')) ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (focused) {
        event.preventDefault();
        setFocused(false);
      } else if (routeDepth !== 'panorama') {
        event.preventDefault();
        goUpRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focused, routeDepth, setFocused]);

  // A trackpad pinch-out zooms out one depth. Only the gesture that is consumed is prevented;
  // everything else (zoom in, ctrl + mouse wheel, a short pinch) keeps zooming the page.
  useEffect(() => {
    if (routeDepth === 'panorama') return;
    const detect = createPinchDetector();
    const onWheel = (event: WheelEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      const verdict = detect({
        ctrlKey: event.ctrlKey,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        time: event.timeStamp,
      });
      if (verdict === 'pass' || verdict === 'accumulate') return;
      event.preventDefault();
      if (verdict === 'consume') goUpRef.current();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [routeDepth]);

  const crumbs: SkyCrumb[] = [{ label: 'Años' }];
  if (route.year) {
    crumbs[0] = {
      label: 'Años',
      href: withReturn(timelineHref()),
      landKey: String(route.year),
    };
    const undatedMonth = route.unknown;
    const monthKey = undatedMonth ? 'sin-mes' : String(route.month);
    crumbs.push(
      routeDepth === 'month'
        ? {
            label: String(route.year),
            href: withReturn(timelineHref({ year: route.year })),
            landKey: monthKey,
          }
        : { label: String(route.year) },
    );
    if (routeDepth === 'month')
      crumbs.push({ label: undatedMonth ? 'Sin mes' : monthTitle(route.month!) });
  }

  const announcement =
    routeDepth === 'month'
      ? `${route.unknown ? 'Fotos sin mes' : monthTitle(route.month!)} de ${route.year}`
      : routeDepth === 'year'
        ? `Año ${route.year}`
        : 'Todos los años';

  const renderShell = (name: string | null | undefined) => {
    const actions: ReactNode = focused ? (
      <button ref={exitRef} type="button" className="sky-pill" onClick={() => setFocused(false)}>
        <X aria-hidden="true" />
        <span className="sky-long">Salir del modo concentración</span>
      </button>
    ) : (
      <button ref={enterRef} type="button" className="sky-pill" onClick={() => setFocused(true)}>
        <Focus aria-hidden="true" />
        <span className="sky-long">Concentrar vista</span>
      </button>
    );
    const menu = focused ? null : <ArchiveNav variant="sky" name={name} />;
    const onLanded = () => currentCrumbRef.current?.focus({ preventScroll: true });
    const returnAside = organizeReturn && (
      <aside className="sky-return" aria-label="Continuar organizando">
        <p>
          Este periodo reúne fotografías de tus carpetas. Puedes volver a continuar con{' '}
          <strong>{organizeReturn.label}</strong>.
        </p>
        <a href={organizeReturn.href}>Volver a Ordenar</a>
      </aside>
    );

    if (route.invalid)
      return (
        <main className="sky grid min-h-dvh place-items-center p-6" aria-live="polite">
          Corrigiendo la ruta temporal…
        </main>
      );

    return (
      <SkyStage
        orientation={orientation}
        onOrientationChange={setOrientation}
        label="Línea de vida"
        overlay={
          <>
            <a className="sky-skip" href="#timeline-main">
              Saltar a la línea de tiempo
            </a>
            <SkyChrome
              crumbs={crumbs}
              onTravel={travel}
              currentRef={currentCrumbRef}
              orientation={orientation}
              onOrientationChange={setOrientation}
              actions={actions}
              menu={menu}
            />
            {returnAside}
          </>
        }
      >
        {routeDepth === 'month' ? (
          <MonthDepth
            key={`${route.year}/${route.unknown ? 'sin-mes' : route.month}`}
            year={route.year!}
            month={route.unknown ? 'sin-mes' : route.month!}
            returnTo={returnTo}
            returnLabel={returnLabel}
            onLanded={onLanded}
          />
        ) : routeDepth === 'year' ? (
          <YearDepth
            key={route.year}
            year={route.year!}
            returnTo={returnTo}
            returnLabel={returnLabel}
            travel={travel}
            onLanded={onLanded}
          />
        ) : (
          <YearsDepth
            returnTo={returnTo}
            returnLabel={returnLabel}
            travel={travel}
            onLanded={onLanded}
          />
        )}
      </SkyStage>
    );
  };

  return (
    <ProtectedSurface tone="sky">
      {(session) => (
        <div
          className="sky-scope min-h-dvh"
          data-route-depth={routeDepth}
          data-focus={focused ? 'on' : 'off'}
        >
          <p className="sr-only" role="status" aria-live="polite">
            {route.invalid ? '' : announcement}
          </p>
          {renderShell(session.user.displayName)}
        </div>
      )}
    </ProtectedSurface>
  );
}
