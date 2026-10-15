'use client';

import Link from 'next/link';
import {
  monthLabel,
  timelineHref,
  type TimelineMonth,
  type TimelineView,
  type TimelineYearItem,
} from './timeline-model';
import styles from './timeline-navigation.module.css';

export function TimelineNavigation({
  years,
  year,
  month,
  view = 'immersive',
  onYear,
  onMonth,
}: {
  years: TimelineYearItem[];
  year: number | null;
  month: TimelineMonth | null;
  view?: TimelineView;
  onYear: (year: number) => void;
  onMonth: (month: TimelineMonth) => void;
}) {
  return (
    <nav className={styles.navigation} aria-label="Navegación temporal directa">
      <div className={styles.context}>
        <Link href={timelineHref({ view })} scroll={false}>
          Cronología
        </Link>
        {year && (
          <>
            <span aria-hidden="true">/</span>
            <Link
              href={timelineHref({ year, view })}
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
      <div className={styles.controls}>
        <label>
          Año
          <select
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
          <label>
            Mes
            <select
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
        <Link className={styles.undated} href="/organizar?filter=undated#photos-workspace">
          Fotografías sin fecha
        </Link>
      </div>
    </nav>
  );
}
