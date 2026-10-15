'use client';

import Link from 'next/link';
import {
  monthLabel,
  timelineHref,
  timelineHrefWithReturn,
  type TimelineMonth,
  type TimelineYearItem,
} from './timeline-model';

export function TimelineNavigation({
  years,
  year,
  month,
  organizeReturnTo,
  organizeReturnLabel,
  onYear,
  onMonth,
}: {
  years: TimelineYearItem[];
  year: number | null;
  month: TimelineMonth | null;
  organizeReturnTo?: string | null;
  organizeReturnLabel?: string | null;
  onYear: (year: number) => void;
  onMonth: (month: TimelineMonth) => void;
}) {
  return (
    <nav
      className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-map-line bg-map-paper px-[max(1rem,4vw)] py-3 text-map-ink max-[600px]:gap-y-1"
      aria-label="Navegación temporal directa"
    >
      <div className="flex flex-wrap items-center gap-3 tabular-nums max-[600px]:w-full">
        <Link
          href={timelineHrefWithReturn(
            timelineHref(),
            organizeReturnTo ?? null,
            organizeReturnLabel,
          )}
          scroll={false}
        >
          Cronología
        </Link>
        {year && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              href={timelineHrefWithReturn(
                timelineHref({ year }),
                organizeReturnTo ?? null,
                organizeReturnLabel,
              )}
              scroll={false}
              aria-label={`Volver a ${year}`}
            >
              {year}
            </Link>
          </>
        )}
        {month && (
          <>
            <span aria-hidden="true">/</span>
            <span aria-current="date">{month === 'sin-mes' ? 'Sin mes' : monthLabel(month)}</span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm max-[600px]:gap-x-3 max-[600px]:gap-y-2">
        <label className="flex items-center gap-3 max-[600px]:gap-1.5">
          Año
          <select
            className="min-h-11 max-w-full rounded-md border border-map-line bg-map-surface px-3 py-2 pr-7 text-map-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-route"
            value={year ?? ''}
            disabled={!years.length}
            onChange={(event) => onYear(Number(event.target.value))}
          >
            <option value="" disabled>
              {years.length ? 'Elegir año' : 'Sin años disponibles'}
            </option>
            {years.map((item) => (
              <option key={item.year} value={item.year}>
                {item.year}
              </option>
            ))}
          </select>
        </label>
        {year && (
          <label className="flex items-center gap-3 max-[600px]:gap-1.5">
            Mes
            <select
              className="min-h-11 max-w-full rounded-md border border-map-line bg-map-surface px-3 py-2 pr-7 text-map-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-map-route"
              value={month ?? ''}
              onChange={(event) =>
                onMonth(event.target.value === 'sin-mes' ? 'sin-mes' : Number(event.target.value))
              }
            >
              <option value="" disabled>
                Elegir mes
              </option>
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index} value={index + 1}>
                  {monthLabel(index + 1)}
                </option>
              ))}
              <option value="sin-mes">Sin mes</option>
            </select>
          </label>
        )}
        <Link
          className="inline-flex min-h-11 items-center text-map-ink underline-offset-4 hover:text-map-route"
          href="/organizar?filter=undated#photos-workspace"
        >
          Fotografías sin fecha
        </Link>
      </div>
    </nav>
  );
}
