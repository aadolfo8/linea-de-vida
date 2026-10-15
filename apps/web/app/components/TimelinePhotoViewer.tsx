'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { mediaUrl, thumbnailVariantUrl } from '../../lib/media';
import { Button } from '../../components/ui/button';
import {
  photoDateLabel,
  wrappedFocusIndex,
  type TimelinePhoto,
  type TimelinePhotoPage,
} from './timeline-model';

const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      className="w-[1.15rem] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
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
  const [thumbnailFallbackPhotoId, setThumbnailFallbackPhotoId] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!embla) return;
    embla.scrollTo(initialIndex, true);
    const select = () => {
      setIndex(embla.selectedScrollSnap());
      setThumbnailFallbackPhotoId(null);
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
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_10_8_/_0.94)] p-4 max-[42rem]:p-2"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="timeline-photo-dialog grid max-h-[calc(100dvh-2rem)] w-[min(70rem,100%)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-[#f3f0e8] text-[#151a16] shadow-[0_1.75rem_5rem_rgb(0_0_0_/_0.38)] outline-none max-[42rem]:max-h-[calc(100dvh-1rem)]"
        role="dialog"
        aria-modal="true"
        aria-label={`Vista ampliada de ${selected.fileName}`}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[#cbd0c7] px-4 py-3 max-[42rem]:min-h-14 max-[42rem]:px-3">
          <span className="tabular-nums" aria-live="polite">
            {index + 1} de {loadedPhotos.length}
          </span>
          <Button
            variant="outline"
            className="min-w-11 rounded-xl border-[#66705f] bg-transparent px-3 text-[#151a16] transition-[background,color,transform] hover:bg-[#151a16] hover:text-[#f3f0e8] active:translate-y-px focus-visible:outline-[#b7d43b] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onClose}
          >
            Cerrar
          </Button>
        </header>
        <div className="min-h-0 overflow-hidden" ref={viewportRef}>
          <div className="flex h-full touch-pan-y touch-pinch-zoom">
            {loadedPhotos.map((photo, photoIndex) => (
              <ViewerPhotoSlide
                key={photo.id}
                photo={photo}
                active={photoIndex === index}
                eager={eagerIndexes.has(photoIndex)}
                requestOriginal={
                  photoIndex === index &&
                  /^image\/(jpeg|png|webp|gif)$/i.test(photo.mimeType) &&
                  thumbnailFallbackPhotoId !== photo.id
                }
                onOriginalUnavailable={() => setThumbnailFallbackPhotoId(photo.id)}
              />
            ))}
          </div>
        </div>
        <footer className="flex min-h-16 items-center justify-between gap-4 border-t border-[#cbd0c7] px-4 py-3 max-[42rem]:min-h-14 max-[42rem]:flex-wrap max-[42rem]:px-3">
          <div className="grid min-w-0 gap-1">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-sm">
              {selected.fileName}
            </strong>
            <span className="text-[0.76rem] tabular-nums text-[#566156]">
              {photoDateLabel(selected)}
            </span>
          </div>
          <div className="flex items-center gap-2 max-[42rem]:flex-wrap max-[42rem]:justify-end">
            {isDownloadOnly && (
              <a
                className="inline-flex min-h-11 items-center px-3 text-[0.8rem] text-inherit underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b7d43b]"
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
              <Button
                type="button"
                variant="outline"
                className="min-w-11 rounded-xl border-[#66705f] text-[#151a16] hover:bg-[#151a16] hover:text-[#f3f0e8]"
                onClick={() => void fetchNextPage()}
              >
                Reintentar carga
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              className="min-h-11 rounded-xl border-[#66705f] bg-transparent text-[#151a16] hover:bg-[#151a16] hover:text-[#f3f0e8] focus-visible:outline-[#b7d43b] disabled:bg-transparent disabled:text-[#151a16]"
              aria-label="Foto anterior"
              disabled={index === 0}
              onClick={() => embla?.scrollPrev(jump)}
            >
              <ArrowIcon direction="left" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="min-h-11 rounded-xl border-[#66705f] bg-transparent text-[#151a16] hover:bg-[#151a16] hover:text-[#f3f0e8] focus-visible:outline-[#b7d43b] disabled:bg-transparent disabled:text-[#151a16]"
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
            </Button>
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
  const thumbnailSrc = thumbnailVariantUrl(api, photo.thumbnailUrl, 1280);
  const src =
    variant === 'original' ? mediaUrl(api, `/v1/photos/${photo.id}/content`) : thumbnailSrc;

  return (
    <div
      className="relative grid min-h-0 min-w-full place-items-center bg-[#080c09]"
      aria-hidden={!active}
    >
      {variant === 'original' && status === 'loading' && (
        <>
          {/* Keep the small preview visible until the full image is ready. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
          <img
            src={thumbnailSrc}
            alt=""
            aria-hidden="true"
            width={photo.dimensions?.width}
            height={photo.dimensions?.height}
            className="absolute left-1/2 top-1/2 z-0 max-h-[min(68dvh,45rem)] max-w-full -translate-x-1/2 -translate-y-1/2 object-contain"
            loading="eager"
          />
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
      <img
        key={`${photo.id}-${variant}-${retryKey}`}
        src={src}
        alt={active ? photo.fileName : ''}
        width={photo.dimensions?.width}
        height={photo.dimensions?.height}
        className="relative z-10 max-h-[min(68dvh,45rem)] max-w-full object-contain"
        loading={eager ? 'eager' : 'lazy'}
        onLoad={() => setStatus('ready')}
        onError={handleError}
      />
      {active && status === 'loading' && (
        <span
          className="absolute bottom-4 left-1/2 w-fit max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[0.65rem] border border-[#f3f0e8]/30 bg-[#151a16]/95 px-3.5 py-2.5 text-center text-sm text-[#f3f0e8]"
          role="status"
          aria-live="polite"
        >
          {variant === 'original' ? 'Cargando fotografía en alta calidad…' : 'Cargando fotografía…'}
        </span>
      )}
      {active && status === 'ready' && originalFallback && (
        <span
          className="absolute bottom-4 left-1/2 w-fit max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[0.65rem] border border-[#f3f0e8]/30 bg-[#151a16]/95 px-3.5 py-2.5 text-center text-sm text-[#f3f0e8]"
          role="status"
          aria-live="polite"
        >
          El original no se pudo cargar; se muestra la miniatura.
        </span>
      )}
      {active && status === 'error' && (
        <div
          className="absolute inset-x-4 bottom-4 mx-auto grid w-fit max-w-[calc(100%-2rem)] justify-items-center gap-3 rounded-[0.65rem] border border-[#f3f0e8]/30 bg-[#151a16]/95 px-3.5 py-2.5 text-center text-[#f3f0e8]"
          role="alert"
        >
          <p className="m-0 text-sm">No se pudo cargar la fotografía.</p>
          <Button
            type="button"
            variant="outline"
            className="min-w-11 rounded-xl border-[#b7d43b] bg-transparent text-[#f3f0e8] hover:bg-[#f3f0e8] hover:text-[#151a16]"
            onClick={retryThumbnail}
          >
            Reintentar miniatura
          </Button>
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
