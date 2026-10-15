'use client';

import useEmblaCarousel from 'embla-carousel-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/button';
import { temporalSelectionIndex } from './timeline-model';

export type TemporalCarouselItem = {
  key: string;
  primary: string;
  secondary: string;
  ariaLabel: string;
};

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      className="w-[1.1rem] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
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
      <nav
        className="group relative isolate grid w-full grid-cols-[clamp(2.75rem,5vw,4rem)_minmax(0,1fr)_clamp(2.75rem,5vw,4rem)] items-center text-[var(--timeline-ink,#eef1e8)] data-[variant=year]:mx-auto data-[variant=year]:w-[min(88rem,calc(100%-max(2rem,8vw)))] max-[42.5rem]:grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] max-[42.5rem]:data-[variant=year]:w-[calc(100%-1rem)]"
        data-variant={variant}
        aria-label={label}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-[2] min-h-11 min-w-11 justify-self-center rounded-full border border-[var(--timeline-line,#5a665a)] bg-[var(--timeline-bg,#09100c)] text-inherit transition-[border-color,background,transform] hover:border-[var(--timeline-accent,#b7d43b)] hover:bg-[var(--timeline-surface,#111914)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--timeline-accent,#b7d43b)] disabled:border-[color-mix(in_srgb,var(--timeline-line,#5a665a)_78%,var(--timeline-ink,#eef1e8))] disabled:text-[color-mix(in_srgb,var(--timeline-ink,#eef1e8)_68%,var(--timeline-bg,#09100c))] disabled:opacity-60 motion-reduce:transition-none"
          aria-label={variant === 'year' ? 'Ir al año anterior' : 'Ir al mes anterior'}
          disabled={!canScrollPrev}
          onClick={() => embla?.scrollPrev()}
        >
          <ArrowIcon direction="left" />
        </Button>
        <div
          className="min-w-0 touch-pan-y touch-pinch-zoom overflow-hidden outline-none focus-visible:rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--timeline-accent,#b7d43b)]"
          ref={viewportRef}
          role="region"
          aria-roledescription="carrusel"
          aria-label={label}
          tabIndex={0}
          onKeyDown={keyDown}
        >
          <div className="flex items-center">
            {items.map((item, index) => {
              const active = index === selectedIndex;
              return (
                <div
                  className={`grid min-w-0 flex-[0_0_clamp(7rem,16vw,12rem)] place-items-center py-[1.6rem] max-[42.5rem]:basis-28 ${variant === 'month' ? 'basis-[clamp(6rem,11vw,8.25rem)]' : ''}`}
                  role="group"
                  aria-roledescription="diapositiva"
                  aria-label={`${index + 1} de ${items.length}`}
                  key={item.key}
                >
                  <motion.button
                    className={`relative grid min-h-[clamp(5rem,9vw,6.75rem)] w-[clamp(5rem,9vw,6.75rem)] origin-center content-center gap-1 rounded-full border border-[var(--timeline-line,#afc2bd)] bg-[var(--timeline-surface,#111914)] p-2 text-center text-inherit before:absolute before:inset-[calc(50%-0.3rem)] before:rounded-full before:bg-[var(--timeline-route,#1d7780)] before:shadow-[0_0_0_4px_var(--timeline-bg,#f1efe8)] before:content-[''] aria-[current=date]:before:inset-[calc(50%-0.4rem)] aria-[current=date]:before:bg-[var(--timeline-accent,#e96b4d)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--timeline-accent,#b7d43b)] max-[42.5rem]:min-h-20 max-[42.5rem]:w-20 ${variant === 'month' ? 'min-h-[4.75rem] w-[4.75rem] p-1 aria-[current=date]:before:inset-[calc(50%-0.4rem)]' : ''}`}
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
                        className={`absolute -inset-[0.65rem] z-[-1] rounded-full border-2 border-[var(--timeline-accent,#e96b4d)] ${variant === 'month' ? '-inset-[0.35rem]' : ''}`}
                        layoutId={reduceMotion ? undefined : 'active-halo'}
                      />
                    )}
                    <span className="relative z-[1] text-[clamp(1.05rem,2vw,1.45rem)] font-semibold tracking-tight tabular-nums max-[42.5rem]:text-base">
                      {item.primary}
                    </span>
                    <span
                      className={`relative z-[1] text-xs tabular-nums text-[var(--timeline-muted,#aab3a7)] ${active ? 'text-[var(--timeline-ink,#eef1e8)]' : ''} ${variant === 'month' ? 'text-[0.95rem] capitalize' : ''}`}
                    >
                      {item.secondary}
                    </span>
                  </motion.button>
                </div>
              );
            })}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative z-[2] min-h-11 min-w-11 justify-self-center rounded-full border border-[var(--timeline-line,#5a665a)] bg-[var(--timeline-bg,#09100c)] text-inherit transition-[border-color,background,transform] hover:border-[var(--timeline-accent,#b7d43b)] hover:bg-[var(--timeline-surface,#111914)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--timeline-accent,#b7d43b)] disabled:border-[color-mix(in_srgb,var(--timeline-line,#5a665a)_78%,var(--timeline-ink,#eef1e8))] disabled:text-[color-mix(in_srgb,var(--timeline-ink,#eef1e8)_68%,var(--timeline-bg,#09100c))] disabled:opacity-60 motion-reduce:transition-none"
          aria-label={variant === 'year' ? 'Ir al año siguiente' : 'Ir al mes siguiente'}
          disabled={!canScrollNext}
          onClick={() => embla?.scrollNext()}
        >
          <ArrowIcon direction="right" />
        </Button>
        <span
          className="pointer-events-none absolute -z-[1] left-[clamp(3rem,6vw,5rem)] right-[clamp(3rem,6vw,5rem)] top-1/2 h-px bg-[linear-gradient(90deg,transparent,var(--timeline-line,#5a665a)_14%_86%,transparent)] max-[42.5rem]:left-12 max-[42.5rem]:right-12"
          aria-hidden="true"
        />
      </nav>
    </LayoutGroup>
  );
}
