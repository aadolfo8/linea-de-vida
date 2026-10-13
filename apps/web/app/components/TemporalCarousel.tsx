'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { temporalSelectionIndex } from './timeline-model';
import styles from './temporal-carousel.module.css';

export type TemporalCarouselItem = {
  key: string;
  primary: string;
  secondary: string;
  ariaLabel: string;
};

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

export function TemporalCarousel({
  items,
  selectedKey,
  label,
  variant,
  onTransientSelect,
  onSettle,
}: {
  items: TemporalCarouselItem[];
  selectedKey: string | null;
  label: string;
  variant: 'year' | 'month';
  onTransientSelect: (key: string) => void;
  onSettle: (key: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [initialIndex] = useState(() => temporalSelectionIndex(items, selectedKey));
  const [viewportRef, embla] = useEmblaCarousel({
    align: 'center',
    containScroll: false,
    dragFree: false,
    duration: reduceMotion ? 0 : 24,
    startIndex: initialIndex,
  });
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const syncSelection = useCallback(() => {
    if (!embla) return;
    const index = embla.selectedScrollSnap();
    setSelectedIndex(index);
    setCanScrollPrev(embla.canScrollPrev());
    setCanScrollNext(embla.canScrollNext());
    const item = items[index];
    if (item) onTransientSelect(item.key);
  }, [embla, items, onTransientSelect]);

  const settleSelection = useCallback(() => {
    if (!embla) return;
    const item = items[embla.selectedScrollSnap()];
    if (item) onSettle(item.key);
  }, [embla, items, onSettle]);

  useEffect(() => {
    if (!embla || !selectedKey) return;
    const index = temporalSelectionIndex(items, selectedKey);
    setSelectedIndex(index);
    if (embla.selectedScrollSnap() !== index) embla.scrollTo(index, true);
  }, [embla, items, selectedKey]);

  useEffect(() => {
    if (!embla) return;
    syncSelection();
    embla.on('select', syncSelection);
    embla.on('settle', settleSelection);
    embla.on('reInit', syncSelection);
    return () => {
      embla.off('select', syncSelection);
      embla.off('settle', settleSelection);
      embla.off('reInit', syncSelection);
    };
  }, [embla, settleSelection, syncSelection]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!embla) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      if (event.key === 'ArrowLeft') embla.scrollPrev();
      else embla.scrollNext();
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      embla.scrollTo(event.key === 'Home' ? 0 : items.length - 1);
    }
  };

  return (
    <LayoutGroup id={`temporal-${variant}`}>
      <nav className={styles.instrument} data-variant={variant} aria-label={label}>
        <button
          className={styles.arrow}
          aria-label={variant === 'year' ? 'Ir al año anterior' : 'Ir al mes anterior'}
          disabled={!canScrollPrev}
          onClick={() => embla?.scrollPrev()}
        >
          <ArrowIcon direction="left" />
        </button>
        <div
          className={styles.viewport}
          ref={viewportRef}
          role="region"
          aria-roledescription="carrusel"
          aria-label={label}
          tabIndex={0}
          onKeyDown={keyDown}
        >
          <div className={styles.container}>
            {items.map((item, index) => {
              const active = index === selectedIndex;
              return (
                <div
                  className={styles.slide}
                  role="group"
                  aria-roledescription="diapositiva"
                  aria-label={`${index + 1} de ${items.length}`}
                  key={item.key}
                >
                  <motion.button
                    className={styles.node}
                    aria-label={item.ariaLabel}
                    aria-current={active ? 'date' : undefined}
                    animate={{
                      opacity: active ? 1 : 0.68,
                      scale: reduceMotion ? 1 : active ? (variant === 'month' ? 1.06 : 1.08) : 0.96,
                    }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: 'easeOut' }}
                    onClick={() => {
                      if (!embla) return;
                      if (index === embla.selectedScrollSnap()) onSettle(item.key);
                      else embla.scrollTo(index);
                    }}
                  >
                    {active && (
                      <motion.span
                        className={styles.halo}
                        layoutId={reduceMotion ? undefined : 'active-halo'}
                      />
                    )}
                    <span className={styles.primary}>{item.primary}</span>
                    <span className={styles.secondary}>{item.secondary}</span>
                  </motion.button>
                </div>
              );
            })}
          </div>
        </div>
        <button
          className={styles.arrow}
          aria-label={variant === 'year' ? 'Ir al año siguiente' : 'Ir al mes siguiente'}
          disabled={!canScrollNext}
          onClick={() => embla?.scrollNext()}
        >
          <ArrowIcon direction="right" />
        </button>
        <span className={styles.axis} aria-hidden="true" />
      </nav>
    </LayoutGroup>
  );
}
