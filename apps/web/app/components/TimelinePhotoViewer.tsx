'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { wrappedFocusIndex, type TimelinePhoto } from './timeline-model';
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
  onClose,
}: {
  photos: TimelinePhoto[];
  initialIndex: number;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const jump = Boolean(reduceMotion);
  const [viewportRef, embla] = useEmblaCarousel({
    loop: true,
    duration: jump ? 0 : 24,
    watchDrag: !jump,
  });
  const [index, setIndex] = useState(initialIndex);
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);

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
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const selected = photos[index];
  if (!selected) return null;

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
      embla?.scrollPrev(jump);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      embla?.scrollNext(jump);
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
            {index + 1} de {photos.length}
          </span>
          <button onClick={onClose}>Cerrar</button>
        </header>
        <div className={styles.viewport} ref={viewportRef}>
          <div className={styles.container}>
            {photos.map((photo, photoIndex) => (
              <div className={styles.slide} key={photo.id}>
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
            <button aria-label="Foto anterior" onClick={() => embla?.scrollPrev(jump)}>
              <ArrowIcon direction="left" />
            </button>
            <button aria-label="Foto siguiente" onClick={() => embla?.scrollNext(jump)}>
              <ArrowIcon direction="right" />
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
