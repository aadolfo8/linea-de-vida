'use client';

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, ApiError, apiJson } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { TemporalCarousel, type TemporalCarouselItem } from './TemporalCarousel';
import { TimelinePhotoViewer } from './TimelinePhotoViewer';
import {
  collectTimelineYears,
  groupTimelineGalleryRows,
  isCurrentTimelineRequest,
  monthLabel,
  parseTimelineRoute,
  resolveTimelineYearSelection,
  shouldCommitTemporalSelection,
  shouldStartTimelineRequest,
  timelineHref,
  type TimelineMonth,
  type TimelinePhoto,
  type TimelinePhotoPage,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from './timeline-model';
import styles from './immersive-timeline.module.css';

function useYearSummary(year: number | null) {
  const [data, setData] = useState<TimelineYearSummary | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const request = useRef(0);

  useEffect(() => {
    const requestId = ++request.current;
    if (!year) {
      setData(null);
      setState('idle');
      return;
    }

    const controller = new AbortController();
    setData((current) => (current?.year === year ? current : null));
    setState('loading');
    const timer = window.setTimeout(() => {
      apiJson<TimelineYearSummary>(`/timeline/years/${year}`, { signal: controller.signal })
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
  }, [year]);

  return { data, state };
}

function parseMonthKey(key: string): TimelineMonth {
  return key === 'sin-mes' ? 'sin-mes' : Number(key);
}

export function ImmersiveTimelineExperience() {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const route = parseTimelineRoute(pathname);
  const [years, setYears] = useState<TimelineYearsPage | null>(null);
  const [yearsState, setYearsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [yearSelection, setYearSelection] = useState(() =>
    resolveTimelineYearSelection(null, route.year),
  );
  const [visualMonth, setVisualMonth] = useState<string | null>(
    route.unknown ? 'sin-mes' : (route.month?.toString() ?? null),
  );
  const [viewer, setViewer] = useState<{ photos: TimelinePhoto[]; index: number } | null>(null);
  const resolvedYearSelection = resolveTimelineYearSelection(years, route.year, yearSelection);
  const selectedVisualYear = resolvedYearSelection.visualYear;
  const selectedSettledYear = resolvedYearSelection.settledYear;

  useEffect(() => {
    const controller = new AbortController();
    setYearsState('loading');
    collectTimelineYears((cursor) =>
      apiJson<TimelineYearsPage>(
        `/timeline/years?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal: controller.signal },
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
  }, []);

  useEffect(() => {
    if (!years?.items.length || !route.year) return;
    if (!years.items.some((item) => item.year === route.year)) {
      router.replace('/timeline', { scroll: false });
    }
  }, [route.year, router, years]);

  const { data: loadedSummary, state: summaryState } = useYearSummary(selectedSettledYear);
  const summary = loadedSummary?.year === selectedSettledYear ? loadedSummary : null;
  const isMonthRoute = Boolean(route.month || route.unknown);

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
        router.push(timelineHref({ year }), { scroll: false });
      }
    },
    [route.year, router, years],
  );

  const settleMonth = useCallback(
    (key: string) => {
      if (!route.year) return;
      const committed = route.unknown ? 'sin-mes' : (route.month?.toString() ?? null);
      if (!shouldCommitTemporalSelection(committed, key)) return;
      router.push(timelineHref({ year: route.year, month: parseMonthKey(key) }), {
        scroll: false,
      });
    },
    [route.month, route.unknown, route.year, router],
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
            <h1>Cronología</h1>
            <p>
              {isMonthRoute
                ? 'Recorre los meses sin perder el año de referencia.'
                : route.year
                  ? 'Elige un mes para abrir sus fotografías.'
                  : 'Arrastra para elegir un año y entra para recorrer sus meses.'}
            </p>
          </header>

          {isMonthRoute && route.year ? (
            <p className={styles.yearAnchor} aria-label={`Año de referencia: ${route.year}`}>
              <span>Año de referencia</span>
              <strong>{route.year}</strong>
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
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.96, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.03, filter: 'blur(8px)' }
                  }
                  transition={{ duration: reduceMotion ? 0 : 0.36, ease: 'easeOut' }}
                >
                  <motion.h2
                    className={styles.monthTitle}
                    layoutId={reduceMotion ? undefined : 'active-period'}
                  >
                    {selectedMonthLabel} de {route.year}
                  </motion.h2>
                  <p>
                    {route.unknown
                      ? 'Fotografías con precisión de año, sin un mes asignado.'
                      : 'Fotografías del mes, sin navegación por días.'}
                  </p>
                </motion.div>
              ) : selectedSettledYear ? (
                <motion.div
                  className={styles.yearFocus}
                  key={`year-${selectedSettledYear}`}
                  initial={reduceMotion ? false : { opacity: 0, filter: 'blur(10px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: 'blur(10px)' }}
                  transition={{ duration: reduceMotion ? 0 : 0.42, ease: 'easeOut' }}
                >
                  <YearCollage
                    summary={summary}
                    loading={summaryState === 'loading'}
                    onOpen={setViewer}
                  />
                  <div className={styles.yearSummary}>
                    <motion.h2 layoutId={reduceMotion ? undefined : 'active-period'}>
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
                          router.push(timelineHref({ year: selectedSettledYear }), {
                            scroll: false,
                          })
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
            initial={reduceMotion ? false : { opacity: 0, y: 34, clipPath: 'inset(8% 0 0 0)' }}
            animate={{ opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)' }}
            transition={{ duration: reduceMotion ? 0 : 0.42, ease: 'easeOut' }}
            aria-labelledby="month-level-title"
          >
            <header className={styles.monthHeader}>
              <div>
                <h2 id="month-level-title">
                  {isMonthRoute ? `Meses de ${route.year}` : `${route.year} por meses`}
                </h2>
                <p>
                  La categoría “Sin mes” aparece solo cuando la fecha conserva precisión de año.
                </p>
              </div>
              {isMonthRoute && (
                <button
                  className={styles.backToYear}
                  onClick={() => router.push(timelineHref({ year: route.year }), { scroll: false })}
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
            initial={reduceMotion ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.36, ease: 'easeOut' }}
          >
            <ImmersiveMonthGallery
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
  onOpen: (viewer: { photos: TimelinePhoto[]; index: number }) => void;
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
          variation={index}
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
          <li key={month} aria-label={`${monthLabel(month)}: ${count} fotografías`}>
            <span
              className={styles.distributionBar}
              style={{ '--month-share': Math.max(0.08, count / max) } as CSSProperties}
            />
            <abbr title={monthLabel(month)}>{monthLabel(month).slice(0, 1)}</abbr>
          </li>
        );
      })}
      {summary.unknownMonthCount > 0 && (
        <li aria-label={`Sin mes: ${summary.unknownMonthCount} fotografías`}>
          <span
            className={styles.distributionBar}
            style={{ '--month-share': summary.unknownMonthCount / max } as CSSProperties}
          />
          <abbr title="Sin mes">—</abbr>
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
  onOpen: (viewer: { photos: TimelinePhoto[]; index: number }) => void;
}) {
  const [photos, setPhotos] = useState<TimelinePhoto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldown = useRef(0);
  const loading = useRef(false);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    async (next?: string | null, reset = false) => {
      if (reset) {
        controller.current?.abort();
        request.current += 1;
        loading.current = false;
      }
      if (
        !shouldStartTimelineRequest({
          reset,
          loading: loading.current,
          cooldownUntil: cooldown.current,
          now: Date.now(),
        })
      )
        return;
      const activeController = new AbortController();
      controller.current = activeController;
      const requestId = ++request.current;
      loading.current = true;
      if (reset) setState('loading');
      try {
        const path =
          month === 'sin-mes'
            ? `/timeline/years/${year}/unknown-month/photos`
            : `/timeline/years/${year}/months/${month}/photos`;
        const page = await apiJson<TimelinePhotoPage>(
          `${path}?limit=30${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
          { signal: activeController.signal },
        );
        if (!isCurrentTimelineRequest(requestId, request.current)) return;
        setPhotos((current) =>
          next
            ? [
                ...current,
                ...page.items.filter((item) => !current.some((photo) => photo.id === item.id)),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
        setState('ready');
      } catch (error) {
        if (activeController.signal.aborted) return;
        if (!isCurrentTimelineRequest(requestId, request.current)) return;
        if (error instanceof ApiError && error.status === 429) {
          const until = Date.now() + (error.retryAfterSeconds ?? 5) * 1000;
          cooldown.current = until;
          setCooldownUntil(until);
        }
        setState('error');
      } finally {
        if (isCurrentTimelineRequest(requestId, request.current)) loading.current = false;
      }
    },
    [month, year],
  );

  useEffect(() => {
    setPhotos([]);
    setCursor(null);
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
        <span>{year}</span>
        <strong>{label}</strong>
      </div>
      <header>
        <h2 id="month-gallery-title">
          {label} de {year}
        </h2>
        <p>
          {month === 'sin-mes'
            ? 'Estas fotografías conservan precisión de año y no reciben un mes inventado.'
            : 'Galería completa del mes, ordenada sin añadir navegación por días.'}
        </p>
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
                  variation={index}
                  className={styles.galleryTile}
                  style={{ '--gallery-span': span } as CSSProperties}
                  onOpen={() => onOpen({ photos, index })}
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
        <button
          className={styles.loadMore}
          disabled={loading.current}
          onClick={() => void load(cursor)}
        >
          Cargar más fotografías
        </button>
      )}
    </section>
  );
}

function ImmersivePhotoTile({
  photo,
  variation,
  className = '',
  style,
  onOpen,
}: {
  photo: TimelinePhoto;
  variation: number;
  className?: string;
  style?: CSSProperties;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <article
      className={`${styles.photo} ${styles[`photo${variation % 6}`]} ${className}`}
      style={style}
    >
      <button onClick={onOpen} aria-label={`Abrir ${photo.fileName}`} data-cursor="photo">
        {failed ? (
          <span className={styles.photoFallback}>
            No se pudo cargar la miniatura. Abre para reintentar.
          </span>
        ) : (
          <img
            src={mediaUrl(api, photo.thumbnailUrl)}
            alt={photo.fileName}
            loading="lazy"
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
      <p>{text}</p>
      {action && <button onClick={action}>Reintentar</button>}
    </section>
  );
}

function EmptyArchive() {
  return (
    <section className={styles.emptyArchive}>
      <h1>Tu archivo todavía no tiene fechas disponibles.</h1>
      <p>Selecciona una fuente y ejecuta una sincronización desde Ajustes.</p>
      <a href="/settings">Ir a Ajustes</a>
    </section>
  );
}

function TimelineSkeleton({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={compact ? styles.compactSkeleton : styles.summarySkeleton} aria-label={label}>
      <i />
      <i />
      <i />
    </div>
  );
}

function CollageSkeleton({ label }: { label: string }) {
  return (
    <div className={styles.collageSkeleton} aria-label={label}>
      <i />
      <i />
      <i />
      <i />
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
              className={styles.gallerySkeleton}
              key={index}
              style={{ '--gallery-span': span } as CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
