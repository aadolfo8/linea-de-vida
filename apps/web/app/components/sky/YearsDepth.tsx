'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '../../../lib/api';
import { subscribeArchiveIndexUpdated } from '../../../lib/archive-index-events';
import {
  getCachedTimelineYears,
  getCachedYearSummary,
  loadTimelineYears,
  loadYearSummary,
} from '../timeline-cache';
import {
  monthCountLabel,
  photoCountLabel,
  timelineHref,
  timelineHrefWithReturn,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from '../timeline-model';
import { useTimelinePosition } from '../useTimelinePosition';
import { Constellation } from './Constellation';
import { YEAR_CONSTELLATION } from './constellation-layout';
import { SkyHint } from './SkyChrome';
import { SkyRail, type SkyRailEntry } from './SkyRail';
import { SkyOverlay, useSky } from './SkyStage';
import { SkyEmptyArchive, SkyError, SkyLoading } from './SkyStates';
import { SkyThread } from './SkyThread';
import { shouldRestorePosition, travelLocation } from './travel';
import { useTravelEntry, type TravelTo } from './use-travel';

const monthsWithPhotos = (summary: TimelineYearSummary | null | undefined) =>
  summary?.months.filter((month) => month.photoCount > 0).length;

type YearsState = 'loading' | 'ready' | 'error';
const ROOT = travelLocation('/timeline');

/**
 * Depth 0: every year with photos is a constellation, oldest first so a life reads forward.
 * A year's preview photos are fetched when its group approaches the viewport.
 */
export function YearsDepth({
  returnTo,
  returnLabel,
  travel,
  onLanded,
}: {
  returnTo: string | null;
  returnLabel: string | null;
  travel: TravelTo;
  onLanded: () => void;
}) {
  const { orientation } = useSky();
  const [restore] = useState(() => shouldRestorePosition(ROOT));
  useTimelinePosition('sky:/timeline', { restorePosition: restore, variant: orientation });

  const [years, setYears] = useState<TimelineYearsPage | null>(() => getCachedTimelineYears());
  const [state, setState] = useState<YearsState>(() => (years ? 'ready' : 'loading'));
  const [attempt, setAttempt] = useState(0);
  const [summaries, setSummaries] = useState<Record<number, TimelineYearSummary>>({});
  // Bumped when the archive index changes, so groups that already asked ask for their photos again.
  const [epoch, setEpoch] = useState(0);
  const requested = useRef(new Set<number>());

  useEffect(
    () =>
      subscribeArchiveIndexUpdated(() => {
        requested.current.clear();
        setSummaries({});
        setEpoch((value) => value + 1);
        setAttempt((value) => value + 1);
      }),
    [],
  );

  useEffect(() => {
    let current = true;
    loadTimelineYears((cursor) =>
      apiJson<TimelineYearsPage>(
        `/timeline/years?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    )
      .then((data) => {
        if (!current) return;
        setYears(data);
        setState('ready');
      })
      .catch(() => {
        if (current) setState('error');
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  const retry = () => {
    setState('loading');
    setAttempt((value) => value + 1);
  };

  const requestSummary = useCallback((year: number) => {
    if (requested.current.has(year)) return;
    requested.current.add(year);
    loadYearSummary(year)
      .then((summary) => setSummaries((current) => ({ ...current, [year]: summary })))
      // The stars stay; a later visit asks again.
      .catch(() => requested.current.delete(year));
  }, []);

  const items = useMemo(() => (years?.items ?? []).filter((item) => item.photoCount > 0), [years]);
  const keys = useMemo(() => items.map((item) => String(item.year)), [items]);
  const summaryOf = (year: number) => summaries[year] ?? getCachedYearSummary(year);
  const monthsOf = (year: number) => monthsWithPhotos(summaryOf(year));

  const empty = state === 'ready' && items.length === 0;
  useTravelEntry({ ready: state !== 'loading', location: ROOT, onLanded });

  const rail = useMemo<SkyRailEntry[]>(
    () =>
      items.map((item) => {
        const months = monthsWithPhotos(summaries[item.year] ?? getCachedYearSummary(item.year));
        return {
          key: String(item.year),
          label: String(item.year),
          short: `’${String(item.year).slice(-2)}`,
          small: months ? `${months}m` : null,
          aria: `Ir a ${item.year}`,
        };
      }),
    [items, summaries],
  );

  if (state === 'loading' && !years) return <SkyLoading label="Cargando años…" />;
  if (state === 'error' && !years)
    return (
      <SkyError
        message="No se pudieron cargar los años. Tu archivo sigue intacto."
        onRetry={retry}
      />
    );
  if (empty) return <SkyEmptyArchive />;

  return (
    <>
      <h1 className="sr-only">Cronología: todos los años</h1>
      <SkyThread keys={keys} />
      {items.map((item, index) => {
        const summary = summaryOf(item.year);
        const months = monthsOf(item.year);
        return (
          <Constellation
            key={item.year}
            itemKey={String(item.year)}
            index={index}
            count={items.length}
            kind={YEAR_CONSTELLATION}
            seed={item.year}
            title={String(item.year)}
            meta={
              <>
                <b>{item.photoCount.toLocaleString('es-ES')}</b>{' '}
                {item.photoCount === 1 ? 'foto' : 'fotos'}
                {months ? ` · ${monthCountLabel(months)}` : ''}
              </>
            }
            cta="Entrar en"
            ariaLabel={`Entrar en ${item.year}: ${photoCountLabel(item.photoCount)}`}
            href={timelineHrefWithReturn(timelineHref({ year: item.year }), returnTo, returnLabel)}
            photos={summary ? summary.previews : null}
            more={summary ? Math.max(0, item.photoCount - summary.previews.length) : 0}
            epoch={epoch}
            onNear={() => requestSummary(item.year)}
            onEnter={(href, cluster, title) => travel(href, 'in', cluster, null, title)}
          />
        );
      })}
      <SkyOverlay>
        <SkyRail entries={rail} label="Saltar a un año" />
        <SkyHint text="Desplázate por los años · pulsa uno para entrar" />
      </SkyOverlay>
    </>
  );
}
