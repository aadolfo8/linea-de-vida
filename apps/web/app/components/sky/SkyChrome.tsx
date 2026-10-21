'use client';

import { ArrowDownUp, ArrowLeftRight, ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { SkyOrientation } from './orientation';
import type { TravelTo } from './use-travel';

export type SkyCrumb = {
  label: string;
  /** Ancestors are real links; the current crumb has none. */
  href?: string;
  /** Group of the destination list to land on (the year or month we came from). */
  landKey?: string | null;
};

const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** Brand, breadcrumb, back button, orientation switch and any extra actions. */
export function SkyChrome({
  crumbs,
  onTravel,
  currentRef,
  orientation,
  onOrientationChange,
  actions,
  showTitle = true,
}: {
  crumbs: SkyCrumb[];
  onTravel: TravelTo;
  currentRef?: Ref<HTMLSpanElement>;
  orientation?: SkyOrientation;
  onOrientationChange?: (orientation: SkyOrientation) => void;
  actions?: ReactNode;
  showTitle?: boolean;
}) {
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2]! : null;
  const goUp = (event: MouseEvent<HTMLElement>, crumb: SkyCrumb) => {
    if (!crumb.href || !isPlainClick(event)) return;
    event.preventDefault();
    onTravel(crumb.href, 'out', null, crumb.landKey ?? null);
  };

  return (
    <header className="sky-bar">
      <div className="sky-where">
        {showTitle && (
          <Link
            className="sky-brand"
            href="/timeline"
            aria-label="Línea de vida, ir a la cronología"
          >
            Línea de vida
          </Link>
        )}
        <div className="sky-crumbs">
          {parent?.href && (
            <button
              type="button"
              className="sky-round sky-back"
              aria-label={`Volver a ${parent.label}`}
              onClick={(event) => goUp(event, parent)}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          )}
          <nav aria-label="Dónde estás">
            <ol>
              {crumbs.map((crumb, index) => {
                const current = index === crumbs.length - 1;
                return (
                  <li key={`${index}:${crumb.label}`}>
                    {index > 0 && (
                      <span className="sky-sep" aria-hidden="true">
                        /
                      </span>
                    )}
                    {current ? (
                      <span ref={currentRef} aria-current="location" tabIndex={-1}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href ?? '/timeline'}
                        onClick={(event) => goUp(event, crumb)}
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </div>
      <div className="sky-actions">
        {actions}
        {orientation && onOrientationChange && (
          <div className="sky-actions-row">
            <div className="sky-seg" role="group" aria-label="Orientación de la línea">
              <button
                type="button"
                aria-pressed={orientation === 'vertical'}
                title="Vertical"
                onClick={() => onOrientationChange('vertical')}
              >
                <ArrowDownUp aria-hidden="true" />
                <span className="sky-long">Vertical</span>
              </button>
              <button
                type="button"
                aria-pressed={orientation === 'horizontal'}
                title="Horizontal"
                onClick={() => onOrientationChange('horizontal')}
              >
                <ArrowLeftRight aria-hidden="true" />
                <span className="sky-long">Horizontal</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

/** One line of guidance that fades once the visitor starts travelling. */
export function SkyHint({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 60) setGone(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <p className="sky-hint" data-gone={gone}>
      {text}
    </p>
  );
}
