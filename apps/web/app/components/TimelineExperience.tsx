'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError, apiJson } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import styles from './timeline-experience.module.css';

type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';
type Photo = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  effectiveDate: { value: string | null; precision: Precision };
};
type Years = {
  firstYear: number | null;
  lastYear: number | null;
  latestYear: number | null;
  items: { year: number; photoCount: number }[];
};
type Summary = {
  year: number;
  total: number;
  months: { month: number; photoCount: number }[];
  unknownMonthCount: number;
  previews: Photo[];
};
type PhotoPage = { items: Photo[]; nextCursor: string | null };
const monthFormatter = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' });
const monthLabel = (month: number) => monthFormatter.format(new Date(Date.UTC(2024, month - 1)));
const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export function routeFrom(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 3) return { year: null, month: null, unknown: false };
  const year = /^\d{4}$/.test(parts[1] ?? '') ? Number(parts[1]) : null;
  const month = /^\d{1,2}$/.test(parts[2] ?? '') ? Number(parts[2]) : null;
  return {
    year,
    month: month && month >= 1 && month <= 12 ? month : null,
    unknown: parts[2] === 'sin-mes',
  };
}

export function TimelineExperience() {
  const pathname = usePathname();
  const router = useRouter();
  const route = routeFrom(pathname);
  const [years, setYears] = useState<Years | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [yearsError, setYearsError] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [settling, setSettling] = useState(false);
  const [viewer, setViewer] = useState<{ photos: Photo[]; index: number } | null>(null);

  useEffect(() => {
    apiJson<Years>('/timeline/years')
      .then((data) => {
        setYears(data);
        setYearsError('');
        if (!route.year && data.latestYear)
          router.replace(`/timeline/${data.latestYear}`, { scroll: false });
      })
      .catch(() => setYearsError('No se pudieron cargar los años.'));
  }, [router]);
  useEffect(() => {
    if (!route.year) return;
    setSummary(null);
    setSummaryError('');
    setSettling(true);
    const timer = window.setTimeout(() => {
      apiJson<Summary>(`/timeline/years/${route.year}`)
        .then((data) => {
          setSummary(data);
          setSummaryError('');
        })
        .catch(() => setSummaryError('No se pudo cargar el resumen de este año.'))
        .finally(() => setSettling(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [route.year]);
  const selectYear = (year: number) => router.push(`/timeline/${year}`, { scroll: false });
  const selectMonth = (month: number | 'sin-mes') =>
    route.year && router.push(`/timeline/${route.year}/${month}`, { scroll: false });
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
        <PhotoDialog
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
  const [cooldown, setCooldown] = useState(0);
  const loading = useRef(false);
  const load = useCallback(
    async (next?: string | null) => {
      if (loading.current || Date.now() < cooldown) return;
      loading.current = true;
      try {
        const path =
          month === 'sin-mes'
            ? `/timeline/years/${year}/unknown-month/photos`
            : `/timeline/years/${year}/months/${month}/photos`;
        const page = await apiJson<PhotoPage>(
          `${path}?limit=30${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        );
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
        if (error instanceof ApiError && error.status === 429)
          setCooldown(Date.now() + (error.retryAfterSeconds ?? 5) * 1000);
        setState('error');
      } finally {
        loading.current = false;
      }
    },
    [cooldown, month, year],
  );
  useEffect(() => {
    setPhotos([]);
    setCursor(null);
    setState('loading');
    void load();
  }, [load]);
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
            cooldown > Date.now()
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

function PhotoDialog({
  photos,
  initialIndex,
  onClose,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [viewportRef, embla] = useEmblaCarousel({ loop: true, duration: 24 });
  const [index, setIndex] = useState(initialIndex);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!embla) return;
    embla.scrollTo(initialIndex, true);
    const select = () => setIndex(embla.selectedScrollSnap());
    embla.on('select', select);
    return () => {
      embla.off('select', select);
    };
  }, [embla, initialIndex]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  const selected = photos[index];
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isEditable(event.target)) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      onClose();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      embla?.scrollPrev();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      embla?.scrollNext();
    }
  };
  return (
    <div
      className={styles.dialogBackdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Vista ampliada de ${selected.fileName}`}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header>
          <span>
            {index + 1} de {photos.length}
          </span>
          <button onClick={onClose}>Cerrar</button>
        </header>
        <div className={styles.emblaViewport} ref={viewportRef}>
          <div className={styles.emblaContainer}>
            {photos.map((photo, photoIndex) => (
              <div className={styles.emblaSlide} key={photo.id}>
                {galleryOriginalIndexes(index, photos.length).has(photoIndex) ? (
                  <img
                    src={mediaUrl(api, `/v1/photos/${photo.id}/content`)}
                    alt={photo.fileName}
                    onError={(event) => {
                      event.currentTarget.src = mediaUrl(api, photo.thumbnailUrl);
                    }}
                  />
                ) : (
                  <img src={mediaUrl(api, photo.thumbnailUrl)} alt="" />
                )}
              </div>
            ))}
          </div>
        </div>
        <footer>
          <strong>{selected.fileName}</strong>
          <div>
            <button aria-label="Foto anterior" onClick={() => embla?.scrollPrev()}>
              ←
            </button>
            <button aria-label="Foto siguiente" onClick={() => embla?.scrollNext()}>
              →
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
export function galleryOriginalIndexes(selectedIndex: number, length: number) {
  return length
    ? new Set([selectedIndex, (selectedIndex - 1 + length) % length, (selectedIndex + 1) % length])
    : new Set<number>();
}
