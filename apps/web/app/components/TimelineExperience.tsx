'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, apiJson } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { TimelinePhotoViewer } from './TimelinePhotoViewer';
import {
  isCurrentTimelineRequest,
  monthLabel,
  parseTimelineRoute,
  shouldStartTimelineRequest,
  timelineHref,
  type TimelinePhoto,
  type TimelinePhotoPage,
  type TimelineView,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from './timeline-model';
import styles from './timeline-experience.module.css';

type Photo = TimelinePhoto;
type Years = TimelineYearsPage;
type Summary = TimelineYearSummary;
type PhotoPage = TimelinePhotoPage;
const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export function routeFrom(pathname: string) {
  const route = parseTimelineRoute(pathname);
  return route.invalid
    ? { year: null, month: null, unknown: false }
    : { year: route.year, month: route.month, unknown: route.unknown };
}

export function TimelineExperience({ view = 'editorial' }: { view?: TimelineView }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = routeFrom(pathname);
  const [years, setYears] = useState<Years | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [yearsError, setYearsError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [settling, setSettling] = useState(false);
  const [viewer, setViewer] = useState<{ photos: Photo[]; index: number } | null>(null);
  const yearsCache = useRef<Years | null>(null);
  const yearsRequest = useRef(0);
  const redirectedToYear = useRef<string | null>(null);
  const summaryRequest = useRef(0);

  useEffect(() => {
    if (yearsCache.current) return;

    const controller = new AbortController();
    const requestId = ++yearsRequest.current;
    setYearsError('');
    apiJson<Years>('/timeline/years', { signal: controller.signal })
      .then((data) => {
        if (!isCurrentTimelineRequest(requestId, yearsRequest.current)) return;
        yearsCache.current = data;
        setYears(data);
        setYearsError('');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (isCurrentTimelineRequest(requestId, yearsRequest.current))
          setYearsError('No se pudieron cargar los años.');
      });

    return () => {
      controller.abort();
      if (isCurrentTimelineRequest(requestId, yearsRequest.current)) yearsRequest.current += 1;
    };
  }, [route.year, view]);

  useEffect(() => {
    if (route.year || !years?.latestYear) {
      redirectedToYear.current = null;
      return;
    }
    const target = timelineHref({ year: years.latestYear, view });
    if (redirectedToYear.current === target) return;
    redirectedToYear.current = target;
    router.replace(target, { scroll: false });
  }, [route.year, router, view, years?.latestYear]);

  useEffect(() => {
    const requestId = ++summaryRequest.current;
    if (!route.year) {
      setSummary(null);
      setSummaryError('');
      setSettling(false);
      return;
    }
    const controller = new AbortController();
    setSummary(null);
    setSummaryError('');
    setSettling(true);
    const timer = window.setTimeout(() => {
      apiJson<Summary>(`/timeline/years/${route.year}`, { signal: controller.signal })
        .then((data) => {
          if (!isCurrentTimelineRequest(requestId, summaryRequest.current)) return;
          setSummary(data);
          setSummaryError('');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (isCurrentTimelineRequest(requestId, summaryRequest.current))
            setSummaryError('No se pudo cargar el resumen de este año.');
        })
        .finally(() => {
          if (isCurrentTimelineRequest(requestId, summaryRequest.current)) setSettling(false);
        });
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [route.year]);
  const selectYear = (year: number) => router.push(timelineHref({ year, view }), { scroll: false });
  const selectMonth = (month: number | 'sin-mes') =>
    route.year && router.push(timelineHref({ year: route.year, month, view }), { scroll: false });
  const selectedYear = route.year ?? years?.latestYear ?? null;
  const selectedMonthLabel = route.unknown
    ? 'Sin mes'
    : route.month
      ? monthLabel(route.month)
      : null;
  return (
    <main className={styles.experience}>
      <a className={styles.skipLink} href="#timeline-content">
        Saltar al contenido temporal
      </a>
      <header className={styles.intro}>
        <div>
          <h1>La vida se vuelve a mirar por partes.</h1>
          <p>
            Elige un año, recorre sus meses y abre las fotografías. La precisión original siempre se
            conserva.
          </p>
        </div>
        <p className={styles.context} aria-live="polite">
          {selectedMonthLabel
            ? `${selectedMonthLabel} de ${selectedYear}`
            : selectedYear
              ? `Año ${selectedYear}`
              : 'Preparando archivo'}
        </p>
      </header>
      <YearRail years={years?.items ?? []} selectedYear={selectedYear} onSelect={selectYear} />
      {yearsError && <Retry text={yearsError} action={() => window.location.reload()} />}
      {!years && !yearsError && <YearSkeleton />}
      {years?.items.length === 0 && <EmptyArchive />}
      {selectedYear && years?.items.length !== 0 && (
        <section id="timeline-content" className={styles.content} aria-busy={settling}>
          <div className={styles.breadcrumb}>
            {route.month || route.unknown ? (
              <button onClick={() => selectYear(selectedYear)}>← Volver a {selectedYear}</button>
            ) : (
              <span>Exploración anual</span>
            )}
            {selectedMonthLabel && <strong>{selectedMonthLabel}</strong>}
          </div>
          {summaryError && <Retry text={summaryError} action={() => selectYear(selectedYear)} />}
          {!summary && !summaryError ? (
            <SummarySkeleton />
          ) : summary && (route.month || route.unknown) ? (
            <MonthGallery
              year={selectedYear}
              month={route.unknown ? 'sin-mes' : route.month!}
              label={selectedMonthLabel!}
              onOpen={setViewer}
            />
          ) : summary ? (
            <YearOverview summary={summary} onSelectMonth={selectMonth} onOpen={setViewer} />
          ) : null}
        </section>
      )}
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

function YearRail({
  years,
  selectedYear,
  onSelect,
}: {
  years: { year: number; photoCount: number }[];
  selectedYear: number | null;
  onSelect: (year: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; scroll: number } | null>(null);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isEditable(event.target)) return;
    const index = years.findIndex((item) => item.year === selectedYear);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const next = years[index + (event.key === 'ArrowLeft' ? 1 : -1)];
      if (next) onSelect(next.year);
    }
  };
  return (
    <nav className={styles.railWrap} aria-label="Años del archivo">
      <button
        aria-label="Desplazar años hacia años recientes"
        onClick={() =>
          ref.current?.scrollBy({ left: -220, behavior: isReduced() ? 'auto' : 'smooth' })
        }
      >
        ←
      </button>
      <div
        ref={ref}
        className={styles.rail}
        tabIndex={0}
        onKeyDown={keyDown}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, scroll: ref.current?.scrollLeft ?? 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current && ref.current)
            ref.current.scrollLeft = drag.current.scroll - (event.clientX - drag.current.x);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onWheel={(event) => {
          if (document.activeElement === ref.current || ref.current?.matches(':hover')) {
            ref.current!.scrollLeft += event.deltaY;
          }
        }}
      >
        {years.map(({ year, photoCount }) => (
          <button
            key={year}
            className={year === selectedYear ? styles.activeYear : ''}
            aria-current={year === selectedYear ? 'date' : undefined}
            onClick={() => onSelect(year)}
          >
            <strong>{year}</strong>
            <span>{photoCount}</span>
          </button>
        ))}
      </div>
      <button
        aria-label="Desplazar años hacia años anteriores"
        onClick={() =>
          ref.current?.scrollBy({ left: 220, behavior: isReduced() ? 'auto' : 'smooth' })
        }
      >
        →
      </button>
    </nav>
  );
}

function YearOverview({
  summary,
  onSelectMonth,
  onOpen,
}: {
  summary: Summary;
  onSelectMonth: (month: number | 'sin-mes') => void;
  onOpen: (value: { photos: Photo[]; index: number }) => void;
}) {
  return (
    <>
      <section className={styles.yearHero} aria-labelledby="year-title">
        <div>
          <h2 id="year-title">{summary.year}</h2>
          <p>
            {summary.total} {summary.total === 1 ? 'fotografía situada' : 'fotografías situadas'} en
            este año.
          </p>
        </div>
        <div className={styles.collage}>
          {summary.previews.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              variation={index}
              onOpen={() => onOpen({ photos: summary.previews, index })}
            />
          ))}
          {!summary.previews.length && <p>Sin fotografías con fecha en este año.</p>}
        </div>
      </section>
      <section className={styles.months} aria-label={`Meses de ${summary.year}`}>
        <h2>Meses</h2>
        <div>
          {summary.months.map(({ month, photoCount }) => (
            <button key={month} disabled={!photoCount} onClick={() => onSelectMonth(month)}>
              <span>{monthLabel(month)}</span>
              <strong>{photoCount}</strong>
            </button>
          ))}
          {summary.unknownMonthCount > 0 && (
            <button className={styles.unknownMonth} onClick={() => onSelectMonth('sin-mes')}>
              <span>Sin mes</span>
              <strong>{summary.unknownMonthCount}</strong>
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function MonthGallery({
  year,
  month,
  label,
  onOpen,
}: {
  year: number;
  month: number | 'sin-mes';
  label: string;
  onOpen: (value: { photos: Photo[]; index: number }) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
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
        const page = await apiJson<PhotoPage>(
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
    setState('loading');
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
  return (
    <section className={styles.gallery} aria-labelledby="month-title">
      <header>
        <h2 id="month-title">
          {label} de {year}
        </h2>
        <p>
          {month === 'sin-mes'
            ? 'Fotografías con precisión de año: no se les asigna un mes.'
            : 'Fotos con precisión de mes o día, ordenadas sin mostrar días.'}
        </p>
      </header>
      {state === 'loading' && !photos.length ? <GallerySkeleton /> : null}
      {photos.length ? (
        <div className={styles.masonry}>
          {photos.map((photo, index) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              variation={index}
              onOpen={() => onOpen({ photos, index })}
            />
          ))}
        </div>
      ) : null}
      {state === 'ready' && !photos.length ? (
        <p className={styles.emptyMonth}>No hay fotografías en esta categoría.</p>
      ) : null}
      {state === 'error' ? (
        <Retry
          text={
            cooldownUntil > Date.now()
              ? 'La carga se pausó para proteger el archivo. Espera unos segundos.'
              : 'No se pudieron cargar las fotografías.'
          }
          action={() => void load(cursor && photos.length ? cursor : null)}
        />
      ) : null}
      {cursor && (
        <button className={styles.more} onClick={() => void load(cursor)}>
          Cargar más fotografías
        </button>
      )}
    </section>
  );
}

function PhotoTile({
  photo,
  variation,
  onOpen,
}: {
  photo: Photo;
  variation: number;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const unsupported = /^image\/(heic|heif)$/i.test(photo.mimeType);
  return (
    <article className={`${styles.photo} ${styles[`photo${variation % 6}`]}`}>
      <button onClick={onOpen} aria-label={`Abrir ${photo.fileName}`}>
        {unsupported ? (
          <span className={styles.fallback}>
            HEIC/HEIF se conserva, pero este navegador no puede previsualizarlo.
          </span>
        ) : failed ? (
          <span className={styles.fallback}>
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
function Retry({ text, action }: { text: string; action: () => void }) {
  return (
    <section className={styles.notice} role="alert">
      <p>{text}</p>
      <button onClick={action}>Reintentar</button>
    </section>
  );
}
function EmptyArchive() {
  return (
    <section className={styles.empty}>
      <h2>Tu archivo todavía no tiene fechas disponibles.</h2>
      <p>Selecciona una fuente y ejecuta una sincronización desde Ajustes.</p>
      <a href="/settings">Ir a Ajustes</a>
    </section>
  );
}
function YearSkeleton() {
  return (
    <div className={styles.skeleton} aria-label="Cargando años">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function SummarySkeleton() {
  return (
    <div className={styles.summarySkeleton} aria-label="Cargando resumen anual">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
function GallerySkeleton() {
  return (
    <div className={styles.masonry} aria-label="Cargando fotografías">
      {Array.from({ length: 6 }, (_, index) => (
        <i className={styles.gallerySkeleton} key={index} />
      ))}
    </div>
  );
}

export { galleryOriginalIndexes } from './TimelinePhotoViewer';
