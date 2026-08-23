'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiCall } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import styles from './timeline-experience.module.css';

type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';
type Photo = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  effectiveDate: { value: string | null; precision: Precision };
  period: { year: number | null; month: number | null; key: string };
};
type FeedPage = { items: Photo[]; nextCursor: string | null };
const monthName = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' });
const precisionLabel = (precision: Precision) =>
  ({ DAY: 'Día conocido', MONTH: 'Mes conocido', YEAR: 'Solo año', UNKNOWN: 'Sin fecha' })[
    precision
  ];
const periodLabel = (photo: Photo) =>
  photo.period.year === null
    ? 'Fecha sin situar'
    : photo.period.month === null
      ? `${photo.period.year} · solo año`
      : `${monthName.format(new Date(Date.UTC(2024, photo.period.month - 1)))} de ${photo.period.year}`;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TimelineExperience() {
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activePeriod, setActivePeriod] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const sections = useRef(new Map<string, HTMLElement>());
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = async (next: string | null = null, replace = false) => {
    if (loading.current) return;
    loading.current = true;
    setLoadingMore(true);
    try {
      const response = await apiCall(
        `/timeline/feed?limit=30${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
      );
      if (!response.ok) throw new Error('feed');
      const page = (await response.json()) as FeedPage;
      setPhotos((current) => {
        const known = new Set((replace ? [] : current).map((photo) => photo.id));
        return [...(replace ? [] : current), ...page.items.filter((photo) => !known.has(photo.id))];
      });
      setCursor(page.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    } finally {
      loading.current = false;
      setLoadingMore(false);
    }
  };
  useEffect(() => {
    void load(null, true);
  }, []);
  const groups = useMemo(() => {
    const byPeriod = new Map<string, { key: string; label: string; photos: Photo[] }>();
    for (const photo of photos) {
      const current = byPeriod.get(photo.period.key);
      if (current) current.photos.push(photo);
      else
        byPeriod.set(photo.period.key, {
          key: photo.period.key,
          label: periodLabel(photo),
          photos: [photo],
        });
    }
    return [...byPeriod.values()];
  }, [photos]);
  useEffect(() => {
    if (!groups.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActivePeriod(visible.target.getAttribute('data-period'));
      },
      { rootMargin: '-20% 0px -54% 0px', threshold: [0.1, 0.45, 0.8] },
    );
    sections.current.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [groups]);
  useEffect(() => {
    if (!cursor || !sentinel.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void load(cursor);
      },
      { rootMargin: '640px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor]);
  const jumpTo = (key: string) => {
    setActivePeriod(key);
    sections.current
      .get(key)
      ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  const selected = selectedIndex === null ? null : photos[selectedIndex];
  return (
    <main className={styles.experience}>
      <a className={styles.skipLink} href="#timeline">
        Saltar a la línea de vida
      </a>
      <section className={styles.intro} aria-labelledby="timeline-title">
        <div className={styles.routeArt} aria-hidden="true">
          <svg viewBox="0 0 48 520" preserveAspectRatio="none">
            <path d="M24 0V520" />
            <circle cx="24" cy="142" r="8" />
            <circle cx="24" cy="370" r="5" />
          </svg>
        </div>
        <div className={styles.introCopy}>
          <p>Archivo privado, en movimiento</p>
          <h1 id="timeline-title">
            La vida no se consulta.
            <br />
            Se recorre.
          </h1>
          <p className={styles.lede}>
            Cada desvío conserva lo que sabemos de su fecha. La ruta solo une los períodos ya
            cargados.
          </p>
        </div>
        <div className={styles.routeStatus} aria-live="polite">
          <span>Ahora</span>
          <strong>
            {groups.find((group) => group.key === activePeriod)?.label ?? 'Preparando la ruta'}
          </strong>
          <span>
            {state === 'ready' ? `${photos.length} recuerdos cargados` : 'Cargando archivo'}
          </span>
        </div>
      </section>
      {state === 'loading' && (
        <State
          title="Preparando tu recorrido"
          text="Comprobamos los períodos disponibles sin sustituir fotos ni fechas."
        />
      )}
      {state === 'error' && (
        <State
          title="No se pudo cargar la ruta"
          text="El archivo no ha cambiado. Revisa la conexión y vuelve a intentarlo."
          action={() => void load(null, true)}
        />
      )}
      {state === 'ready' && !photos.length && (
        <State
          title="Aún no hay recuerdos en la ruta"
          text="Selecciona una carpeta y sincronízala desde Ajustes. Las fotos aparecerán aquí con su precisión temporal real."
        />
      )}
      {!!groups.length && (
        <>
          <nav className={styles.navigator} aria-label="Períodos cargados">
            <span>Saltos de ruta</span>
            <div>
              {groups.map((group) => (
                <button
                  key={group.key}
                  className={activePeriod === group.key ? styles.current : ''}
                  aria-current={activePeriod === group.key ? 'location' : undefined}
                  onClick={() => jumpTo(group.key)}
                  data-cursor="route"
                >
                  {group.label}
                </button>
              ))}
            </div>
          </nav>
          <section className={styles.timeline} id="timeline" aria-label="Línea de vida cargada">
            {groups.map((group, periodIndex) => (
              <section
                key={group.key}
                data-period={group.key}
                ref={(node) => {
                  if (node) sections.current.set(group.key, node);
                  else sections.current.delete(group.key);
                }}
                className={styles.period}
              >
                <header>
                  <span>{String(periodIndex + 1).padStart(2, '0')}</span>
                  <div>
                    <h2>{group.label}</h2>
                    <p>
                      {group.photos.length} {group.photos.length === 1 ? 'recuerdo' : 'recuerdos'} ·{' '}
                      {[
                        ...new Set(
                          group.photos.map((photo) =>
                            precisionLabel(photo.effectiveDate.precision),
                          ),
                        ),
                      ].join(', ')}
                    </p>
                  </div>
                </header>
                <div className={styles.photoSequence}>
                  {group.photos.map((photo, index) => (
                    <Memory
                      key={photo.id}
                      photo={photo}
                      position={(index + periodIndex) % 5}
                      onOpen={() => {
                        setSelectedIndex(photos.findIndex((item) => item.id === photo.id));
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </section>
          <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
          {cursor && (
            <button
              className={styles.loadMore}
              onClick={() => void load(cursor)}
              disabled={loadingMore}
            >
              {loadingMore ? 'Cargando el siguiente tramo…' : 'Cargar el siguiente tramo'}
            </button>
          )}
        </>
      )}
      {selected && (
        <PhotoDialog
          photos={photos}
          initialIndex={selectedIndex ?? 0}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </main>
  );
}
function State({ title, text, action }: { title: string; text: string; action?: () => void }) {
  return (
    <section className={styles.state} aria-live="polite">
      <h2>{title}</h2>
      <p>{text}</p>
      {action && <button onClick={action}>Reintentar</button>}
    </section>
  );
}
function Memory({
  photo,
  position,
  onOpen,
}: {
  photo: Photo;
  position: number;
  onOpen: () => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const unsupported = /^image\/(heic|heif)$/i.test(photo.mimeType);
  return (
    <article className={`${styles.memory} ${styles[`memory${position}`]}`}>
      <button data-cursor="photo" onClick={onOpen} aria-label={`Abrir ${photo.fileName}`}>
        <span className={styles.photoFrame}>
          {unsupported ? (
            <span>Este formato sigue indexado, pero no se puede previsualizar aquí.</span>
          ) : state === 'error' ? (
            <span>
              No se pudo cargar la miniatura. Abre el recuerdo para intentar cargar el original.
            </span>
          ) : (
            <>
              <img
                src={mediaUrl(api, photo.thumbnailUrl)}
                alt=""
                loading="lazy"
                onLoad={() => setState('ready')}
                onError={() => setState('error')}
              />
              {state === 'loading' && <span>Cargando imagen</span>}
            </>
          )}
        </span>
        <span className={styles.memoryCaption}>
          <strong>{photo.fileName}</strong>
          <span>{precisionLabel(photo.effectiveDate.precision)}</span>
        </span>
      </button>
    </article>
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
  const [viewportRef, emblaApi] = useEmblaCarousel({ loop: true, duration: 24 });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onSelect = useCallback(() => {
    if (emblaApi) setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);
  const scrollPrevious = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((index: number) => emblaApi?.scrollTo(index), [emblaApi]);
  const selected = photos[selectedIndex];

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.scrollTo(initialIndex, true);
    onSelect();
    emblaApi.on('select', onSelect).on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect).off('reInit', onSelect);
    };
  }, [emblaApi, initialIndex, onSelect]);
  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => previousFocus.current?.focus();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollNext();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollPrevious();
    }
    if (event.key === 'Tab') {
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Vista ampliada de ${selected.fileName}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header>
          <span>
            {String(selectedIndex + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}
          </span>
          <button data-cursor="action" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <div className={styles.emblaViewport} ref={viewportRef} aria-roledescription="carrusel">
          <div className={styles.emblaContainer}>
            {photos.map((item) => (
              <GallerySlide key={item.id} photo={item} />
            ))}
          </div>
        </div>
        <footer>
          <div>
            <strong>{selected.fileName}</strong>
            <span>{precisionLabel(selected.effectiveDate.precision)}</span>
          </div>
          <div>
            <button data-cursor="action" onClick={scrollPrevious}>
              Anterior
            </button>
            <button data-cursor="action" onClick={scrollNext}>
              Siguiente
            </button>
          </div>
        </footer>
        <nav className={styles.galleryNav} aria-label="Navegación de fotos">
          {photos.map((item, index) => (
            <button
              key={item.id}
              className={selectedIndex === index ? styles.selectedThumbnail : ''}
              aria-current={selectedIndex === index ? 'true' : undefined}
              aria-label={`Ver foto ${index + 1}: ${item.fileName}`}
              onClick={() => scrollTo(index)}
            >
              <img src={mediaUrl(api, item.thumbnailUrl)} alt="" />
            </button>
          ))}
        </nav>
      </section>
    </div>
  );
}
function GallerySlide({ photo }: { photo: Photo }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const unsupported = /^image\/(heic|heif)$/i.test(photo.mimeType);
  return (
    <div className={styles.emblaSlide} role="group" aria-label={photo.fileName}>
      <div className={styles.dialogImage}>
        {unsupported ? (
          <p>
            Este formato está indexado, pero el navegador no puede mostrarlo en tamaño completo.
          </p>
        ) : state === 'error' ? (
          <p>
            No se pudo cargar el archivo completo. Puedes cerrar esta vista e intentarlo más tarde.
          </p>
        ) : (
          <>
            <img
              src={mediaUrl(api, `/v1/photos/${photo.id}/content`)}
              alt={photo.fileName}
              onLoad={() => setState('ready')}
              onError={() => setState('error')}
            />
            {state === 'loading' && <span>Cargando original…</span>}
          </>
        )}
      </div>
    </div>
  );
}
