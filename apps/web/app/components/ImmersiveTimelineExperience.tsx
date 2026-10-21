'use client';

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError, apiJson } from '../../lib/api';
import { subscribeArchiveIndexUpdated } from '../../lib/archive-index-events';
import { thumbnailVariantUrl } from '../../lib/media';
import {
  getCachedGallery,
  getCachedTimelineYears,
  getCachedYearSummary,
  loadGalleryPage,
  loadTimelineYears,
  loadYearSummary,
} from './timeline-cache';
import { TemporalCarousel, type TemporalCarouselItem } from './TemporalCarousel';
import { TimelinePhotoViewer } from './TimelinePhotoViewer';
import { TimelineNavigation } from './TimelineNavigation';
import { useTimelinePosition } from './useTimelinePosition';
import {
  groupTimelineGalleryRows,
  isCurrentTimelineRequest,
  monthLabel,
  parseTimelineRoute,
  resolveTimelineYearSelection,
  shouldCommitTemporalSelection,
  shouldStartTimelineRequest,
  timelineHref,
  timelineHrefWithReturn,
  type TimelineMonth,
  type TimelinePhoto,
  type TimelinePhotoPage,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from './timeline-model';

const styles: Record<string, string> = {
  experience:
    'min-h-dvh overflow-clip bg-map-paper text-map-ink [--timeline-bg:var(--map-paper)] [--timeline-surface:var(--map-surface)] [--timeline-surface-raised:var(--map-panel)] [--timeline-ink:var(--map-ink)] [--timeline-muted:var(--map-muted)] [--timeline-line:var(--map-line)] [--timeline-route:var(--map-route)] [--timeline-accent:var(--map-active)]',
  skipLink:
    'fixed left-4 top-[-5rem] z-[60] rounded-xl bg-map-active px-4 py-3 text-map-ink transition-[top] focus:top-4',
  stage:
    'grid min-h-0 grid-rows-[auto_auto_minmax(22rem,1fr)] content-start py-[clamp(1.5rem,3vw,2.75rem)] pb-[clamp(2.5rem,5vw,5rem)] data-[depth=month]:grid-rows-[auto_auto_auto] data-[depth=month]:pb-0 max-[42.5rem]:grid-rows-[auto_auto_auto]',
  stageHeader:
    'mx-auto mb-[clamp(1.5rem,3vw,2.5rem)] flex w-[min(88rem,calc(100%_-_max(2rem,8vw)))] items-baseline justify-between gap-8 max-[42.5rem]:block max-[42.5rem]:w-[calc(100%_-_2rem)]',
  stageTitle: 'm-0 text-[clamp(1.15rem,2vw,1.55rem)] font-semibold tracking-tight',
  stageDescription:
    'm-0 max-w-[34rem] text-right text-sm leading-relaxed text-map-muted text-pretty max-[42.5rem]:mt-2 max-[42.5rem]:text-left',
  yearInstrument: 'relative mx-auto mb-[clamp(1rem,2vw,2rem)] w-full',
  monthInstrument: 'relative mx-auto w-[min(88rem,100%)]',
  yearAnchor:
    'mx-auto flex w-[min(88rem,calc(100%_-_max(2rem,8vw)))] items-baseline gap-3 text-xs text-map-muted',
  yearAnchorValue: 'text-lg font-semibold tabular-nums text-map-ink',
  announcement: 'sr-only',
  focus:
    'mx-auto min-h-0 w-[min(88rem,calc(100%_-_max(2rem,8vw)))] max-[42.5rem]:w-[calc(100%_-_2rem)]',
  yearFocus:
    'grid min-h-[clamp(25rem,46dvh,38rem)] grid-cols-[minmax(0,1.3fr)_minmax(14rem,0.7fr)] items-center gap-[clamp(1.5rem,3vw,3rem)] max-[58rem]:grid-cols-1 max-[42.5rem]:gap-6',
  yearSummary:
    'relative z-[2] self-center max-[58rem]:grid max-[58rem]:grid-cols-[auto_1fr] max-[58rem]:items-end max-[58rem]:gap-x-8 max-[42.5rem]:grid-cols-1 max-[42.5rem]:px-2',
  periodTitle:
    'm-0 font-serif text-[clamp(4.5rem,11vw,6rem)] font-normal leading-[0.82] tracking-[-0.04em] text-balance max-[42.5rem]:text-[clamp(3.75rem,20vw,5.4rem)]',
  photoCount: 'mt-5 text-base tabular-nums text-map-muted max-[58rem]:self-end',
  collage:
    'relative isolate min-h-[clamp(25rem,46dvh,36rem)] max-[58rem]:min-h-[min(54dvh,34rem)] max-[42.5rem]:min-h-96',
  photo:
    'min-w-0 overflow-hidden rounded-2xl bg-map-panel shadow-[0_0.25rem_0.75rem_rgb(0_0_0_/_0.08)]',
  photoButton:
    'block h-full w-full border-0 bg-transparent p-0 text-inherit focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-map-active',
  photoImage: 'block h-full w-full object-cover',
  orbit0: 'absolute inset-[5%_45%_19%_2%] z-[3] max-[42.5rem]:inset-[3%_42%_33%_0]',
  orbit1: 'absolute inset-[0_4%_50%_58%] z-[2] max-[42.5rem]:inset-[0_0_58%_62%]',
  orbit2: 'absolute inset-[56%_34%_0_37%] z-[4] max-[42.5rem]:inset-[64%_59%_0_4%]',
  orbit3: 'absolute inset-[56%_4%_4%_72%] z-[5] max-[42.5rem]:inset-[50%_0_5%_45%]',
  orbit4: 'absolute inset-[8%_72%_65%_14%] z-[1] max-[42.5rem]:hidden',
  orbit5: 'absolute inset-[30%_1%_46%_79%] z-[1] max-[42.5rem]:hidden',
  distribution:
    'mt-[clamp(2rem,4vw,3.5rem)] flex h-[5.5rem] list-none items-end gap-[clamp(0.2rem,0.5vw,0.45rem)] p-0 max-[58rem]:col-span-full',
  distributionItem: 'grid h-full flex-1 grid-rows-[1fr_auto] items-end gap-2',
  distributionBar:
    'block min-h-[2px] w-full rounded-t bg-[color-mix(in_srgb,var(--timeline-accent)_72%,var(--timeline-line))] [height:calc(var(--month-share)*100%)]',
  distributionLabel: 'text-center text-[0.62rem] text-map-muted',
  enterYear:
    'mt-8 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-map-active bg-map-active px-4 py-3 font-semibold text-map-ink transition-colors hover:bg-map-ink hover:text-map-paper active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-ink max-[58rem]:self-end',
  monthFocus:
    'flex min-h-0 items-end justify-between gap-8 py-[clamp(1rem,2vw,2rem)] pb-[clamp(1.5rem,3vw,2.5rem)] text-left max-[42.5rem]:block',
  monthTitle:
    'm-0 max-w-[13ch] font-serif text-[clamp(2.5rem,5.5vw,4.75rem)] font-normal leading-[0.9] tracking-[-0.04em] lowercase text-balance max-[42.5rem]:text-[clamp(3.75rem,20vw,5.4rem)]',
  monthDescription: 'm-0 max-w-[30rem] leading-relaxed text-map-muted max-[42.5rem]:mt-3',
  monthLevel: 'relative bg-map-paper py-[clamp(1.5rem,3vw,2.5rem)] pb-[clamp(3rem,5vw,4.5rem)]',
  monthHeader:
    'mx-auto mb-[clamp(1.25rem,2vw,2rem)] flex w-[min(78rem,calc(100%-max(2rem,10vw)))] items-end justify-between gap-8 max-[42.5rem]:block max-[42.5rem]:w-[calc(100%-2rem)]',
  monthHeaderTitle: 'm-0 text-[clamp(2rem,4.5vw,3.75rem)] font-semibold tracking-[-0.035em]',
  monthHeaderDescription: 'mt-3 mb-0 max-w-[41rem] leading-relaxed text-map-muted',
  backToYear:
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-map-active px-4 py-3 text-map-active transition-colors hover:bg-map-active hover:text-map-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-ink max-[42.5rem]:mt-6',
  galleryWrap: 'bg-map-paper text-map-ink',
  gallery:
    'mx-auto w-[min(82rem,calc(100%_-_max(2rem,10vw)))] pb-[clamp(5rem,10vw,10rem)] max-[42.5rem]:w-[calc(100%_-_2rem)]',
  galleryBridge: 'flex min-h-48 items-start justify-between gap-8 pt-4 text-map-ink',
  galleryBridgeYear: 'tabular-nums text-map-muted',
  galleryBridgeLabel: 'text-[clamp(1.5rem,3vw,2.75rem)] font-semibold tracking-tight lowercase',
  galleryHeader:
    'mb-[clamp(3rem,6vw,5rem)] grid grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.55fr)] items-end gap-8 max-[58rem]:grid-cols-1',
  galleryTitle:
    'm-0 max-w-[12ch] text-[clamp(3.25rem,8vw,6rem)] font-semibold leading-[0.92] tracking-[-0.04em] lowercase text-balance',
  galleryDescription: 'm-0 leading-relaxed text-map-muted text-pretty',
  galleryGrid: 'grid gap-[clamp(0.75rem,1.5vw,1.25rem)] max-[42.5rem]:gap-3',
  galleryRow:
    'grid h-[clamp(18rem,34vw,32rem)] grid-cols-12 gap-[clamp(0.65rem,1.25vw,1rem)] [content-visibility:auto] [contain-intrinsic-size:auto_28rem] data-[size=3]:h-[clamp(17rem,28vw,26rem)] data-[size=1]:h-[clamp(20rem,38vw,34rem)] max-[42.5rem]:h-[clamp(13rem,52vw,20rem)] max-[42.5rem]:gap-2 max-[42.5rem]:data-[size=3]:h-[clamp(11rem,42vw,17rem)] max-[42.5rem]:data-[size=1]:h-[clamp(18rem,76vw,28rem)]',
  galleryTile: '[grid-column:span_var(--gallery-span)] h-full',
  galleryPhoto: 'bg-map-panel shadow-[0_1rem_2rem_rgb(12_41_53_/_0.1)]',
  photoFallback:
    'grid min-h-full place-items-center p-5 text-center text-sm leading-relaxed text-map-muted',
  loadMore:
    'mt-12 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-map-line px-4 py-3 text-map-ink transition-colors hover:border-map-route hover:bg-map-route hover:text-map-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-ink',
  notice: 'mx-auto w-[min(42rem,calc(100%-2rem))] py-[clamp(3rem,8vw,7rem)] text-center',
  emptyArchive:
    'mx-auto grid min-h-[calc(100dvh-3.25rem)] w-[min(42rem,calc(100%-2rem))] content-center justify-items-center py-[clamp(3rem,8vw,7rem)] text-center',
  emptyArchiveTitle:
    'm-0 text-[clamp(2.5rem,6vw,5rem)] leading-[0.96] tracking-[-0.04em] text-balance',
  emptyText: 'leading-relaxed text-map-muted',
  emptyAction:
    'mt-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-map-active px-4 py-3 text-map-active no-underline hover:bg-map-active hover:text-map-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-ink',
  emptyGallery: 'leading-relaxed text-map-muted',
  emptyCollage: 'place-self-center text-map-muted',
  compactSkeleton: 'flex min-h-32 gap-4 overflow-hidden px-[max(1rem,8vw)] py-6',
  summarySkeleton: 'mt-8 grid gap-3 overflow-hidden',
  collageSkeleton:
    'grid min-h-[clamp(26rem,49dvh,40rem)] grid-cols-[1.4fr_0.8fr] gap-3 overflow-hidden max-[58rem]:min-h-[min(54dvh,34rem)] max-[42.5rem]:min-h-96',
  skeletonLine:
    'block min-h-3 rounded-xl bg-[linear-gradient(100deg,var(--timeline-surface-raised)_34%,var(--map-surface)_50%,var(--timeline-surface-raised)_66%)] [background-size:200%_100%] animate-[shimmer_1.35s_infinite_linear] motion-reduce:animate-none',
  compactSkeletonItem: 'min-h-20 flex-1',
  summarySkeletonItem: 'min-h-3 first:w-[72%]',
  collageSkeletonMain: 'row-span-2',
  gallerySkeleton: 'col-span-[var(--gallery-span)] h-full',
};

function useYearSummary(year: number | null, archiveRevision: number) {
  const [data, setData] = useState<TimelineYearSummary | null>(() =>
    year ? getCachedYearSummary(year) : null,
  );
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() =>
    year ? (getCachedYearSummary(year) ? 'ready' : 'loading') : 'idle',
  );
  const request = useRef(0);

  useEffect(() => {
    const requestId = ++request.current;
    if (!year) {
      setData(null);
      setState('idle');
      return;
    }

    const controller = new AbortController();
    const cached = getCachedYearSummary(year);
    setData(cached);
    setState(cached ? 'ready' : 'loading');
    const timer = window.setTimeout(() => {
      loadYearSummary(year)
        .then((summary) => {
          if (!isCurrentTimelineRequest(requestId, request.current)) return;
          setData(summary);
          setState('ready');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (isCurrentTimelineRequest(requestId, request.current)) setState('error');
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [archiveRevision, year]);

  return { data, state };
}

function parseMonthKey(key: string): TimelineMonth {
  return key === 'sin-mes' ? 'sin-mes' : Number(key);
}

export function ImmersiveTimelineExperience({
  organizeReturnTo = null,
  organizeReturnLabel = null,
}: {
  organizeReturnTo?: string | null;
  organizeReturnLabel?: string | null;
}) {
  const pathname = usePathname();
  useTimelinePosition(`immersive:${pathname}`);
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const route = parseTimelineRoute(pathname);
  const [years, setYears] = useState<TimelineYearsPage | null>(() => getCachedTimelineYears());
  const [yearsState, setYearsState] = useState<'loading' | 'ready' | 'error'>(() =>
    getCachedTimelineYears() ? 'ready' : 'loading',
  );
  const [yearSelection, setYearSelection] = useState(() =>
    resolveTimelineYearSelection(null, route.year),
  );
  const [visualMonth, setVisualMonth] = useState<string | null>(
    route.unknown ? 'sin-mes' : (route.month?.toString() ?? null),
  );
  const [viewer, setViewer] = useState<{
    photos: TimelinePhoto[];
    index: number;
    loadMore?: () => Promise<TimelinePhotoPage | null>;
  } | null>(null);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const resolvedYearSelection = resolveTimelineYearSelection(years, route.year, yearSelection);
  const selectedVisualYear = resolvedYearSelection.visualYear;
  const selectedSettledYear = resolvedYearSelection.settledYear;

  useEffect(
    () =>
      subscribeArchiveIndexUpdated(() => {
        setArchiveRevision((revision) => revision + 1);
        setViewer(null);
      }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const cached = getCachedTimelineYears();
    if (cached) {
      setYears(cached);
      setYearsState('ready');
    } else setYearsState('loading');
    loadTimelineYears((cursor) =>
      apiJson<TimelineYearsPage>(
        `/timeline/years?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setYears(data);
        setYearsState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setYearsState('error');
      });
    return () => controller.abort();
  }, [archiveRevision]);

  useEffect(() => {
    if (!years?.items.length || !route.year) return;
    if (!years.items.some((item) => item.year === route.year)) {
      router.replace(timelineHrefWithReturn('/timeline', organizeReturnTo, organizeReturnLabel), {
        scroll: false,
      });
    }
  }, [organizeReturnLabel, organizeReturnTo, route.year, router, years]);

  const { data: loadedSummary, state: summaryState } = useYearSummary(
    selectedSettledYear,
    archiveRevision,
  );
  const summary = loadedSummary?.year === selectedSettledYear ? loadedSummary : null;
  const isMonthRoute = Boolean(route.month || route.unknown);

  useEffect(() => {
    if (!summary || !selectedSettledYear) return;
    let target: { year: number; month: TimelineMonth } | null = null;
    if (route.year && (route.month || route.unknown)) {
      const available = summary.months
        .filter((item) => item.photoCount > 0)
        .map((item) => item.month);
      const selected = route.unknown ? -1 : (route.month ?? -1);
      const nearby = available.find((month) => month > selected) ?? available.at(-1);
      if (nearby && nearby !== selected) target = { year: route.year, month: nearby };
    }
    const yearIndex = years?.items.findIndex((item) => item.year === selectedSettledYear) ?? -1;
    const nearbyYear = years?.items[yearIndex > 0 ? yearIndex - 1 : yearIndex + 1]?.year;
    const timer = window.setTimeout(() => {
      if (target) {
        if (!getCachedGallery(target.year, target.month))
          void loadGalleryPage(target.year, target.month, null).catch(() => {});
      } else if (nearbyYear && !getCachedYearSummary(nearbyYear)) {
        void loadYearSummary(nearbyYear).catch(() => {});
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [route.month, route.unknown, route.year, selectedSettledYear, summary, years]);

  const yearItems = useMemo<TemporalCarouselItem[]>(
    () =>
      (years?.items ?? []).map(({ year, photoCount }) => ({
        key: year.toString(),
        primary: year.toString(),
        secondary: `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}`,
        ariaLabel: `Seleccionar ${year}, ${photoCount} ${photoCount === 1 ? 'fotografía' : 'fotografías'}`,
      })),
    [years],
  );

  const monthItems = useMemo<TemporalCarouselItem[]>(() => {
    if (!summary) return [];
    const counts = new Map(summary.months.map((item) => [item.month, item.photoCount]));
    const items = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const count = counts.get(month) ?? 0;
      const label = monthLabel(month);
      return {
        key: month.toString(),
        primary: label,
        secondary: `${count} ${count === 1 ? 'foto' : 'fotos'}`,
        ariaLabel: `Seleccionar ${label} de ${summary.year}, ${count} ${count === 1 ? 'fotografía' : 'fotografías'}`,
      };
    });
    if (summary.unknownMonthCount > 0) {
      items.push({
        key: 'sin-mes',
        primary: 'Sin mes',
        secondary: `${summary.unknownMonthCount} ${summary.unknownMonthCount === 1 ? 'foto' : 'fotos'}`,
        ariaLabel: `Seleccionar fotografías sin mes de ${summary.year}, ${summary.unknownMonthCount} ${summary.unknownMonthCount === 1 ? 'fotografía' : 'fotografías'}`,
      });
    }
    return items;
  }, [summary]);

  useEffect(() => {
    if (!monthItems.length) return;
    const routeKey = route.unknown ? 'sin-mes' : (route.month?.toString() ?? null);
    const firstWithPhotos = monthItems.find((item) => !item.secondary.startsWith('0 '));
    setVisualMonth(routeKey ?? firstWithPhotos?.key ?? monthItems[0].key);
  }, [monthItems, route.month, route.unknown]);

  const transientYear = useCallback(
    (key: string) => {
      const year = Number(key);
      setYearSelection((current) => ({
        ...resolveTimelineYearSelection(years, route.year, current),
        visualYear: year,
      }));
    },
    [route.year, years],
  );

  const settleYear = useCallback(
    (key: string) => {
      const year = Number(key);
      setYearSelection((current) => ({
        ...resolveTimelineYearSelection(years, route.year, current),
        visualYear: year,
        settledYear: year,
      }));
      if (route.year && shouldCommitTemporalSelection(route.year, year)) {
        router.push(
          timelineHrefWithReturn(timelineHref({ year }), organizeReturnTo, organizeReturnLabel),
          { scroll: false },
        );
      }
    },
    [organizeReturnLabel, organizeReturnTo, route.year, router, years],
  );

  const settleMonth = useCallback(
    (key: string) => {
      if (!route.year) return;
      const committed = route.unknown ? 'sin-mes' : (route.month?.toString() ?? null);
      if (!shouldCommitTemporalSelection(committed, key)) return;
      router.push(
        timelineHrefWithReturn(
          timelineHref({ year: route.year, month: parseMonthKey(key) }),
          organizeReturnTo,
          organizeReturnLabel,
        ),
        { scroll: false },
      );
    },
    [organizeReturnLabel, organizeReturnTo, route.month, route.unknown, route.year, router],
  );

  const selectedMonthLabel = route.unknown
    ? 'Sin mes'
    : route.month
      ? monthLabel(route.month)
      : null;

  if (yearsState === 'error')
    return (
      <main className={styles.experience}>
        <Notice
          text="No se pudieron cargar los años del archivo."
          action={() => window.location.reload()}
        />
      </main>
    );

  if (yearsState === 'ready' && years?.items.length === 0)
    return (
      <main className={styles.experience}>
        <EmptyArchive />
      </main>
    );

  return (
    <main className={styles.experience}>
      <TimelineNavigation
        years={years?.items ?? []}
        year={selectedSettledYear}
        month={route.unknown ? 'sin-mes' : route.month}
        organizeReturnTo={organizeReturnTo}
        organizeReturnLabel={organizeReturnLabel}
        onYear={(year) =>
          router.push(
            timelineHrefWithReturn(timelineHref({ year }), organizeReturnTo, organizeReturnLabel),
            { scroll: false },
          )
        }
        onMonth={(month) =>
          router.push(
            timelineHrefWithReturn(
              timelineHref({ year: selectedSettledYear, month }),
              organizeReturnTo,
              organizeReturnLabel,
            ),
            { scroll: false },
          )
        }
      />
      <a className={styles.skipLink} href="#timeline-focus">
        Saltar a la selección temporal
      </a>
      <LayoutGroup id="immersive-timeline">
        <section
          className={styles.stage}
          data-depth={isMonthRoute ? 'month' : route.year ? 'year' : 'panorama'}
          aria-busy={yearsState === 'loading' || summaryState === 'loading'}
        >
          <header className={styles.stageHeader}>
            <h1 className={styles.stageTitle}>Cronología</h1>
            <p className={styles.stageDescription}>
              {isMonthRoute
                ? `${selectedMonthLabel} de ${route.year}`
                : route.year
                  ? 'Elige un mes para abrir sus fotografías.'
                  : 'Un archivo de momentos compartidos.'}
            </p>
          </header>

          {isMonthRoute && route.year ? (
            <p className={styles.yearAnchor} aria-label={`Año de referencia: ${route.year}`}>
              <span>Año de referencia</span>
              <strong className={styles.yearAnchorValue}>{route.year}</strong>
            </p>
          ) : yearItems.length ? (
            <div className={styles.yearInstrument}>
              <TemporalCarousel
                items={yearItems}
                selectedKey={selectedVisualYear?.toString() ?? null}
                label="Años del archivo"
                variant="year"
                onTransientSelect={transientYear}
                onSettle={settleYear}
              />
              <p className={styles.announcement} aria-live="polite">
                {selectedVisualYear ? `Año seleccionado: ${selectedVisualYear}` : 'Cargando años'}
              </p>
            </div>
          ) : (
            <TimelineSkeleton label="Cargando años" compact />
          )}

          <div id="timeline-focus" className={styles.focus}>
            <AnimatePresence mode="wait" initial={false}>
              {isMonthRoute && route.year && selectedMonthLabel ? (
                <motion.div
                  className={styles.monthFocus}
                  key={`month-${route.year}-${selectedMonthLabel}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
                >
                  <motion.h2
                    className={styles.monthTitle}
                    layoutId={reduceMotion ? undefined : 'active-period'}
                  >
                    {selectedMonthLabel} de {route.year}
                  </motion.h2>
                  <p className={styles.monthDescription}>
                    {route.unknown
                      ? 'Conocemos el año, pero no el mes.'
                      : summary
                        ? `${summary.months.find((item) => item.month === route.month)?.photoCount ?? 0} fotografías`
                        : 'Cargando fotografías…'}
                  </p>
                </motion.div>
              ) : selectedSettledYear ? (
                <motion.div
                  className={styles.yearFocus}
                  key={`year-${selectedSettledYear}`}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
                >
                  <YearCollage
                    summary={summary}
                    loading={summaryState === 'loading'}
                    onOpen={setViewer}
                  />
                  <div className={styles.yearSummary}>
                    <motion.h2
                      className={styles.periodTitle}
                      layoutId={reduceMotion ? undefined : 'active-period'}
                    >
                      {selectedSettledYear}
                    </motion.h2>
                    {summary ? (
                      <>
                        <p className={styles.photoCount}>
                          {summary.total} {summary.total === 1 ? 'fotografía' : 'fotografías'}
                        </p>
                        <MonthDistribution summary={summary} />
                      </>
                    ) : summaryState === 'error' ? (
                      <Notice text="No se pudo cargar el resumen de este año." />
                    ) : (
                      <TimelineSkeleton label="Cargando resumen anual" />
                    )}
                    {!route.year && (
                      <button
                        className={styles.enterYear}
                        onClick={() =>
                          router.push(
                            timelineHrefWithReturn(
                              timelineHref({ year: selectedSettledYear }),
                              organizeReturnTo,
                              organizeReturnLabel,
                            ),
                            { scroll: false },
                          )
                        }
                      >
                        Entrar en {selectedSettledYear}
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </section>

        {route.year && summary && (
          <motion.section
            className={styles.monthLevel}
            layout={reduceMotion ? false : true}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
            aria-labelledby="month-level-title"
          >
            <header className={styles.monthHeader}>
              <div>
                <h2 className={styles.monthHeaderTitle} id="month-level-title">
                  {isMonthRoute ? `Meses de ${route.year}` : `${route.year} por meses`}
                </h2>
                <p className={styles.monthHeaderDescription}>Cada mes, un lugar al que volver.</p>
              </div>
              {isMonthRoute && (
                <button
                  className={styles.backToYear}
                  onClick={() =>
                    router.push(
                      timelineHrefWithReturn(
                        timelineHref({ year: route.year }),
                        organizeReturnTo,
                        organizeReturnLabel,
                      ),
                      { scroll: false },
                    )
                  }
                >
                  Volver a {route.year}
                </button>
              )}
            </header>
            <div className={styles.monthInstrument}>
              <TemporalCarousel
                items={monthItems}
                selectedKey={visualMonth}
                label={`Meses de ${route.year}`}
                variant="month"
                onTransientSelect={setVisualMonth}
                onSettle={settleMonth}
              />
              <p className={styles.announcement} aria-live="polite">
                {visualMonth
                  ? `Mes seleccionado: ${visualMonth === 'sin-mes' ? 'Sin mes' : monthLabel(Number(visualMonth))}`
                  : 'Preparando meses'}
              </p>
            </div>
          </motion.section>
        )}

        {isMonthRoute && route.year && selectedMonthLabel && (
          <motion.div
            className={styles.galleryWrap}
            layout={reduceMotion ? false : true}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
          >
            <ImmersiveMonthGallery
              key={`${route.year}-${route.unknown ? 'sin-mes' : route.month}-${archiveRevision}`}
              year={route.year}
              month={route.unknown ? 'sin-mes' : route.month!}
              label={selectedMonthLabel}
              onOpen={setViewer}
            />
          </motion.div>
        )}
      </LayoutGroup>

      {viewer && (
        <TimelinePhotoViewer
          photos={viewer.photos}
          initialIndex={viewer.index}
          loadMore={viewer.loadMore}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  );
}

function YearCollage({
  summary,
  loading,
  onOpen,
}: {
  summary: TimelineYearSummary | null;
  loading: boolean;
  onOpen: (viewer: {
    photos: TimelinePhoto[];
    index: number;
    loadMore?: () => Promise<TimelinePhotoPage | null>;
  }) => void;
}) {
  if (!summary) return <CollageSkeleton label={loading ? 'Cargando fotografías' : 'Sin resumen'} />;
  if (!summary.previews.length)
    return <p className={styles.emptyCollage}>Este año no tiene fotografías con fecha.</p>;

  const previews = summary.previews.slice(0, 6);

  return (
    <div className={styles.collage} aria-label={`Vista previa de ${summary.year}`}>
      {previews.map((photo, index) => (
        <ImmersivePhotoTile
          key={photo.id}
          photo={photo}
          thumbnailWidth={640}
          className={styles[`orbit${index}`] ?? ''}
          onOpen={() => onOpen({ photos: previews, index })}
        />
      ))}
    </div>
  );
}

function MonthDistribution({ summary }: { summary: TimelineYearSummary }) {
  const counts = new Map(summary.months.map((item) => [item.month, item.photoCount]));
  const max = Math.max(1, ...counts.values(), summary.unknownMonthCount);
  return (
    <ol className={styles.distribution} aria-label={`Distribución mensual de ${summary.year}`}>
      {Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const count = counts.get(month) ?? 0;
        return (
          <li
            className={styles.distributionItem}
            key={month}
            aria-label={`${monthLabel(month)}: ${count} fotografías`}
          >
            <span
              className={styles.distributionBar}
              style={{ '--month-share': Math.max(0.08, count / max) } as CSSProperties}
            />
            <abbr className={styles.distributionLabel} title={monthLabel(month)}>
              {monthLabel(month).slice(0, 1)}
            </abbr>
          </li>
        );
      })}
      {summary.unknownMonthCount > 0 && (
        <li
          className={styles.distributionItem}
          aria-label={`Sin mes: ${summary.unknownMonthCount} fotografías`}
        >
          <span
            className={styles.distributionBar}
            style={{ '--month-share': summary.unknownMonthCount / max } as CSSProperties}
          />
          <abbr className={styles.distributionLabel} title="Sin mes">
            —
          </abbr>
        </li>
      )}
    </ol>
  );
}

function ImmersiveMonthGallery({
  year,
  month,
  label,
  onOpen,
}: {
  year: number;
  month: TimelineMonth;
  label: string;
  onOpen: (viewer: {
    photos: TimelinePhoto[];
    index: number;
    loadMore?: () => Promise<TimelinePhotoPage | null>;
  }) => void;
}) {
  const initialGallery = getCachedGallery(year, month);
  const [photos, setPhotos] = useState<TimelinePhoto[]>(() => initialGallery?.photos ?? []);
  const [cursor, setCursor] = useState<string | null>(() => initialGallery?.nextCursor ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() =>
    initialGallery ? 'ready' : 'loading',
  );
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldown = useRef(0);
  const loading = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingCursor = useRef<string | null | undefined>(undefined);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (next?: string | null, reset = false) => {
      if (reset) {
        controller.current?.abort();
        request.current += 1;
        loading.current = false;
        cursorRef.current = null;
      }
      if (loading.current && !reset && loadingCursor.current === (next ?? null))
        return loadGalleryPage(year, month, next ?? null).catch(() => null);
      if (
        !shouldStartTimelineRequest({
          reset,
          loading: loading.current,
          cooldownUntil: cooldown.current,
          now: Date.now(),
        })
      )
        return null;
      const activeController = new AbortController();
      controller.current = activeController;
      const requestId = ++request.current;
      loading.current = true;
      loadingCursor.current = next ?? null;
      setState('loading');
      try {
        const page = await loadGalleryPage(year, month, next ?? null);
        if (!isCurrentTimelineRequest(requestId, request.current)) return null;
        setPhotos((current) => {
          const cachedPhotos = getCachedGallery(year, month)?.photos;
          if (cachedPhotos) return cachedPhotos;
          if (!next) return page.items;
          const seen = new Set(current.map((photo) => photo.id));
          return [...current, ...page.items.filter((photo) => !seen.has(photo.id))];
        });
        cursorRef.current = page.nextCursor;
        setCursor(page.nextCursor);
        setState('ready');
        return page;
      } catch (error) {
        if (activeController.signal.aborted) return null;
        if (!isCurrentTimelineRequest(requestId, request.current)) return null;
        if (error instanceof ApiError && error.status === 429) {
          const until = Date.now() + (error.retryAfterSeconds ?? 5) * 1000;
          cooldown.current = until;
          setCooldownUntil(until);
        }
        setState('error');
        return null;
      } finally {
        if (isCurrentTimelineRequest(requestId, request.current)) {
          loading.current = false;
          loadingCursor.current = undefined;
        }
      }
    },
    [month, year],
  );

  useEffect(() => {
    const cachedGallery = getCachedGallery(year, month);
    if (cachedGallery) {
      setPhotos(cachedGallery.photos);
      setCursor(cachedGallery.nextCursor);
      cursorRef.current = cachedGallery.nextCursor;
      setState('ready');
      return;
    }
    setPhotos([]);
    setCursor(null);
    cursorRef.current = null;
    setCooldownUntil(0);
    cooldown.current = 0;
    void load(null, true);
    return () => {
      request.current += 1;
      controller.current?.abort();
      loading.current = false;
    };
  }, [load]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || state === 'error' || state === 'loading') return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load(cursor);
      },
      { rootMargin: `${window.innerHeight}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, load, photos.length, state]);

  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setTimeout(
      () => {
        cooldown.current = 0;
        setCooldownUntil(0);
      },
      Math.max(0, cooldownUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [cooldownUntil]);

  const galleryRows = useMemo(() => groupTimelineGalleryRows(photos), [photos]);

  return (
    <section className={styles.gallery} aria-labelledby="month-gallery-title">
      <div className={styles.galleryBridge} aria-hidden="true">
        <span className={styles.galleryBridgeYear}>{year}</span>
        <strong className={styles.galleryBridgeLabel}>{label}</strong>
      </div>
      <header className={styles.galleryHeader}>
        <h2 className={styles.galleryTitle} id="month-gallery-title">
          {label} de {year}
        </h2>
        {month === 'sin-mes' && (
          <p className={styles.galleryDescription}>Conocemos el año, pero no el mes.</p>
        )}
      </header>
      {state === 'loading' && !photos.length && <GallerySkeleton />}
      {photos.length > 0 && (
        <div className={styles.galleryGrid}>
          {galleryRows.map((row, rowIndex) => (
            <div
              className={styles.galleryRow}
              data-size={row.entries.length}
              key={row.entries[0]?.item.id ?? rowIndex}
            >
              {row.entries.map(({ item: photo, index, span }) => (
                <ImmersivePhotoTile
                  key={photo.id}
                  photo={photo}
                  className={styles.galleryTile}
                  style={{ '--gallery-span': span } as CSSProperties}
                  onOpen={() =>
                    onOpen({
                      photos,
                      index,
                      ...(cursorRef.current
                        ? {
                            loadMore: () => {
                              const next = cursorRef.current;
                              return next ? load(next) : Promise.resolve(null);
                            },
                          }
                        : {}),
                    })
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {state === 'ready' && !photos.length && (
        <p className={styles.emptyGallery}>No hay fotografías en esta categoría.</p>
      )}
      {state === 'error' && (
        <Notice
          text={
            cooldownUntil > Date.now()
              ? 'La carga se pausó para proteger el archivo. Podrás reintentarlo en unos segundos.'
              : 'No se pudieron cargar las fotografías.'
          }
          action={cooldownUntil > Date.now() ? undefined : () => void load(cursor)}
        />
      )}
      {cursor && state !== 'error' && (
        <div
          ref={sentinel}
          className="mt-10 min-h-10 text-center text-sm text-map-muted"
          role="status"
          aria-live="polite"
        >
          {state === 'loading' ? 'Preparando más fotografías…' : ''}
        </div>
      )}
    </section>
  );
}

function ImmersivePhotoTile({
  photo,
  thumbnailWidth = 1280,
  className = '',
  style,
  onOpen,
}: {
  photo: TimelinePhoto;
  thumbnailWidth?: 640 | 1280;
  className?: string;
  style?: CSSProperties;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <article className={`${styles.photo} ${styles.galleryPhoto} ${className}`} style={style}>
      <button
        className={styles.photoButton}
        onClick={onOpen}
        aria-label={`Abrir ${photo.fileName}`}
        data-cursor="photo"
      >
        {failed ? (
          <span className={styles.photoFallback}>
            No se pudo cargar la miniatura. Abre para reintentar.
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */
          <img
            src={thumbnailVariantUrl(api, photo.thumbnailUrl, thumbnailWidth)}
            srcSet={`${thumbnailVariantUrl(api, photo.thumbnailUrl, 640)} 640w, ${thumbnailVariantUrl(api, photo.thumbnailUrl, 1280)} 1280w`}
            sizes="(max-width: 42rem) 100vw, (max-width: 70rem) 50vw, 34vw"
            className={styles.photoImage}
            alt={photo.fileName}
            width={photo.dimensions?.width}
            height={photo.dimensions?.height}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        )}
      </button>
    </article>
  );
}

function Notice({ text, action }: { text: string; action?: () => void }) {
  return (
    <section className={styles.notice} role="alert">
      <p className={styles.emptyText}>{text}</p>
      {action && (
        <button className={styles.loadMore} onClick={action}>
          Reintentar
        </button>
      )}
    </section>
  );
}

function EmptyArchive() {
  return (
    <section className={styles.emptyArchive}>
      <h1 className={styles.emptyArchiveTitle}>Tu archivo todavía no tiene fechas disponibles.</h1>
      <p className={styles.emptyText}>
        Añade una carpeta o revisa las fotografías que todavía no tienen fecha.
      </p>
      <a className={styles.emptyAction} href="/organizar">
        Ir a Organizar
      </a>
      <a className={styles.emptyAction} href="/organizar?filter=undated#photos-workspace">
        Fotografías sin fecha
      </a>
    </section>
  );
}

function TimelineSkeleton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={compact ? styles.compactSkeleton : styles.summarySkeleton} aria-label={label}>
      <i
        className={`${styles.skeletonLine} ${compact ? styles.compactSkeletonItem : styles.summarySkeletonItem}`}
      />
      <i
        className={`${styles.skeletonLine} ${compact ? styles.compactSkeletonItem : styles.summarySkeletonItem}`}
      />
      <i
        className={`${styles.skeletonLine} ${compact ? styles.compactSkeletonItem : styles.summarySkeletonItem}`}
      />
    </div>
  );
}

function CollageSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.collageSkeleton} aria-label={label}>
      <i className={`${styles.skeletonLine} ${styles.collageSkeletonMain}`} />
      <i className={styles.skeletonLine} />
      <i className={styles.skeletonLine} />
      <i className={styles.skeletonLine} />
    </div>
  );
}

function GallerySkeleton() {
  const rows = groupTimelineGalleryRows(Array.from({ length: 8 }, (_, index) => index));
  return (
    <div className={styles.galleryGrid} aria-label="Cargando fotografías">
      {rows.map((row, rowIndex) => (
        <div className={styles.galleryRow} data-size={row.entries.length} key={rowIndex}>
          {row.entries.map(({ index, span }) => (
            <i
              className={`${styles.skeletonLine} ${styles.gallerySkeleton}`}
              key={index}
              style={{ '--gallery-span': span } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
