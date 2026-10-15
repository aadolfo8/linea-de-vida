'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import {
  photoDateLabel,
  wrappedFocusIndex,
  type TimelinePhoto,
  type TimelinePhotoPage,
} from './timeline-model';
import styles from './timeline-photo-viewer.module.css';

const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

export function TimelinePhotoViewer({
  photos,
  initialIndex,
  loadMore,
  onClose,
}: {
  photos: TimelinePhoto[];
  initialIndex: number;
  loadMore?: () => Promise<TimelinePhotoPage | null>;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const jump = Boolean(reduceMotion);
  const [viewportRef, embla] = useEmblaCarousel({
    loop: false,
    duration: jump ? 0 : 24,
    watchDrag: true,
  });
  const [loadedPhotos, setLoadedPhotos] = useState(photos);
  const [hasMore, setHasMore] = useState(Boolean(loadMore));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const [originalPhotoId, setOriginalPhotoId] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!embla) return;
    embla.scrollTo(initialIndex, true);
    const select = () => {
      setIndex(embla.selectedScrollSnap());
      setOriginalPhotoId(null);
    };
    embla.on('select', select);
    return () => {
      embla.off('select', select);
    };
  }, [embla, initialIndex]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const hidden: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    const hiddenElements = new Set<HTMLElement>();
    let current: HTMLElement | null = backdrop.current;

    while (current?.parentElement) {
      const parent = current.parentElement;
      for (const sibling of parent.children) {
        if (sibling === current || !(sibling instanceof HTMLElement) || hiddenElements.has(sibling))
          continue;
        hiddenElements.add(sibling);
        hidden.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (parent === document.body) break;
      current = parent;
    }

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusFirst = () => {
      const first = dialog.current?.querySelector<HTMLElement>(focusableSelector);
      if (first) first.focus();
      else dialog.current?.focus();
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener('focusin', containFocus);

    return () => {
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      hidden.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const selected = loadedPhotos[index];
  if (!selected) return null;
  const isDownloadOnly = /^image\/(heic|heif)$/i.test(selected.mimeType);
  const canViewOriginal = /^image\/(jpeg|png|webp)$/i.test(selected.mimeType);
  const selectedOriginalRequested = originalPhotoId === selected.id;
  const eagerIndexes = galleryEagerIndexes(index, loadedPhotos.length);

  const fetchNextPage = async () => {
    if (!loadMore || !hasMore || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await loadMore();
      if (!page) {
        setLoadMoreError(true);
        return;
      }
      setLoadedPhotos((current) => {
        const currentIds = new Set(current.map((photo) => photo.id));
        return [...current, ...page.items.filter((photo) => !currentIds.has(photo.id))];
      });
      setHasMore(Boolean(page.nextCursor));
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab') {
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
      ];
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const atBoundary = event.shiftKey
        ? currentIndex <= 0
        : currentIndex === -1 || currentIndex === focusable.length - 1;
      if (atBoundary) {
        event.preventDefault();
        const nextIndex = wrappedFocusIndex(currentIndex, focusable.length, event.shiftKey);
        if (nextIndex >= 0) focusable[nextIndex].focus();
        else dialog.current?.focus();
      }
      return;
    }
    if (isEditable(event.target)) return;
    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault();
      onClose();
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (index > 0) embla?.scrollPrev(jump);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (index < loadedPhotos.length - 1) embla?.scrollNext(jump);
      else if (hasMore) void fetchNextPage();
    }
  };

  return (
    <div
      ref={backdrop}
      className={styles.backdrop}
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
          <span aria-live="polite">
            {index + 1} de {loadedPhotos.length}
          </span>
          <button onClick={onClose}>Cerrar</button>
        </header>
        <div className={styles.viewport} ref={viewportRef}>
          <div className={styles.container}>
            {loadedPhotos.map((photo, photoIndex) => (
              <ViewerPhotoSlide
                key={photo.id}
                photo={photo}
                active={photoIndex === index}
                eager={eagerIndexes.has(photoIndex)}
                requestOriginal={photo.id === originalPhotoId}
                onOriginalUnavailable={() => setOriginalPhotoId(null)}
              />
            ))}
          </div>
        </div>
        <footer>
          <div className={styles.caption}>
            <strong>{selected.fileName}</strong>
            <span>{photoDateLabel(selected)}</span>
          </div>
          <div className={styles.controls}>
            {canViewOriginal && (
              <button
                type="button"
                aria-pressed={selectedOriginalRequested}
                onClick={() => setOriginalPhotoId(selectedOriginalRequested ? null : selected.id)}
              >
                {selectedOriginalRequested ? 'Volver a vista previa' : 'Ver original'}
              </button>
            )}
            {isDownloadOnly && (
              <a
                className={styles.download}
                href={mediaUrl(api, `/v1/photos/${selected.id}/content`)}
              >
                Descargar original
              </a>
            )}
            {loadingMore && (
              <span role="status" aria-live="polite">
                Cargando más fotografías…
              </span>
            )}
            {loadMoreError && (
              <button type="button" onClick={() => void fetchNextPage()}>
                Reintentar carga
              </button>
            )}
            <button
              aria-label="Foto anterior"
              disabled={index === 0}
              onClick={() => embla?.scrollPrev(jump)}
            >
              <ArrowIcon direction="left" />
            </button>
            <button
              aria-label={
                index === loadedPhotos.length - 1 && hasMore
                  ? 'Cargar siguientes fotografías'
                  : 'Foto siguiente'
              }
              disabled={index === loadedPhotos.length - 1 && !hasMore}
              onClick={() => {
                if (index < loadedPhotos.length - 1) embla?.scrollNext(jump);
                else void fetchNextPage();
              }}
            >
              <ArrowIcon direction="right" />
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ViewerPhotoSlide({
  photo,
  active,
  eager,
  requestOriginal,
  onOriginalUnavailable,
}: {
  photo: TimelinePhoto;
  active: boolean;
  eager: boolean;
  requestOriginal: boolean;
  onOriginalUnavailable: () => void;
}) {
  const [variant, setVariant] = useState<'thumbnail' | 'original'>('thumbnail');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryKey, setRetryKey] = useState(0);
  const [originalFallback, setOriginalFallback] = useState(false);

  useEffect(() => {
    if (requestOriginal) {
      setVariant('original');
      setOriginalFallback(false);
    } else setVariant('thumbnail');
    setStatus('loading');
    setRetryKey(0);
  }, [photo.id, requestOriginal]);

  const handleError = () => {
    if (variant === 'original') {
      setVariant('thumbnail');
      setStatus('loading');
      setOriginalFallback(true);
      onOriginalUnavailable();
      return;
    }
    setStatus('error');
  };

  const retryThumbnail = () => {
    setStatus('loading');
    setRetryKey((current) => current + 1);
  };
  const src = mediaUrl(
    api,
    variant === 'original' ? `/v1/photos/${photo.id}/content` : photo.thumbnailUrl,
  );

  return (
    <div className={styles.slide} aria-hidden={!active}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
      <img
        key={`${photo.id}-${variant}-${retryKey}`}
        src={src}
        alt={active ? photo.fileName : ''}
        width={photo.dimensions?.width}
        height={photo.dimensions?.height}
        loading={eager ? 'eager' : 'lazy'}
        onLoad={() => setStatus('ready')}
        onError={handleError}
      />
      {active && status === 'loading' && (
        <span className={styles.imageStatus} role="status" aria-live="polite">
          Cargando fotografía…
        </span>
      )}
      {active && status === 'ready' && originalFallback && (
        <span className={styles.imageStatus} role="status" aria-live="polite">
          El original no se pudo cargar; se muestra la miniatura.
        </span>
      )}
      {active && status === 'error' && (
        <div className={styles.imageError} role="alert">
          <p>No se pudo cargar la fotografía.</p>
          <button type="button" onClick={retryThumbnail}>
            Reintentar miniatura
          </button>
        </div>
      )}
    </div>
  );
}

export function galleryEagerIndexes(selectedIndex: number, length: number) {
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= length)
    return new Set<number>();
  const indexes = new Set([selectedIndex]);
  if (selectedIndex > 0) indexes.add(selectedIndex - 1);
  if (selectedIndex < length - 1) indexes.add(selectedIndex + 1);
  return indexes;
}
