'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { subscribeArchiveIndexUpdated } from '../../../lib/archive-index-events';
import { getCachedMonthPreviews, loadMonthPreviews } from '../timeline-cache';
import {
  monthCountLabel,
  monthLabel,
  monthTitle,
  photoCountLabel,
  timelineHref,
  timelineHrefWithReturn,
  type TimelineMonthPreview,
  type TimelineMonthPreviews,
} from '../timeline-model';
import { useTimelinePosition } from '../useTimelinePosition';
import { Constellation } from './Constellation';
import { MONTH_CONSTELLATION } from './constellation-layout';
import { SkyHint } from './SkyChrome';
import { SkyRail, type SkyRailEntry } from './SkyRail';
import { SkyOverlay, useSky } from './SkyStage';
import { SkyError, SkyLoading } from './SkyStates';
import { PeriodHeader, SkyThread } from './SkyThread';
import { shouldRestorePosition, travelLocation } from './travel';
import { useTravelEntry, type TravelTo } from './use-travel';

const SHORT_MONTHS = [
  'ENE',
  'FEB',
  'MAR',
  'ABR',
  'MAY',
  'JUN',
  'JUL',
  'AGO',
  'SEP',
  'OCT',
  'NOV',
  'DIC',
];

const groupKey = (group: TimelineMonthPreview) =>
  group.month === null ? 'sin-mes' : String(group.month);

/**
 * Depth 1: one year as a list of month constellations plus, when some photos only know their
 * year, a "Sin mes" group. Everything comes from the month-previews endpoint.
 */
export function YearDepth({
  year,
  returnTo,
  returnLabel,
  travel,
  onLanded,
}: {
  year: number;
  returnTo: string | null;
  returnLabel: string | null;
  travel: TravelTo;
  onLanded: () => void;
}) {
  const router = useRouter();
  const { orientation } = useSky();
  const [restore] = useState(() => shouldRestorePosition(travelLocation(`/timeline/${year}`)));
  useTimelinePosition(`sky:/timeline/${year}`, { restorePosition: restore, variant: orientation });

  const [data, setData] = useState<TimelineMonthPreviews | null>(() =>
    getCachedMonthPreviews(year),
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => subscribeArchiveIndexUpdated(() => setAttempt((value) => value + 1)), []);

  useEffect(() => {
    let current = true;
    loadMonthPreviews(year)
      .then((result) => {
        if (!current) return;
        setData(result);
        setFailed(false);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [attempt, year]);

  const groups = useMemo(() => data?.items.filter((group) => group.photoCount > 0) ?? [], [data]);
  const keys = useMemo(() => groups.map(groupKey), [groups]);
  const unavailable = data !== null && groups.length === 0;

  // A year without photos is not a destination: send people back to the years.
  useEffect(() => {
    if (!unavailable) return;
    router.replace(timelineHrefWithReturn(timelineHref(), returnTo, returnLabel), {
      scroll: false,
    });
  }, [returnLabel, returnTo, router, unavailable]);

  useTravelEntry({
    ready: data !== null || failed,
    location: travelLocation(`/timeline/${year}`),
    onLanded,
  });

  const rail = useMemo<SkyRailEntry[]>(() => {
    const byMonth = new Map(groups.map((group) => [group.month, group]));
    const entries = SHORT_MONTHS.map((label, index) => {
      const month = index + 1;
      const group = byMonth.get(month);
      const name = monthLabel(month);
      return {
        key: String(month),
        label,
        small: group ? group.photoCount.toLocaleString('es-ES') : null,
        aria: group ? `Ir a ${name}` : `${monthTitle(month)}: sin fotos`,
        disabled: !group,
      };
    });
    const undated = byMonth.get(null);
    if (undated)
      entries.push({
        key: 'sin-mes',
        label: 'S/M',
        small: undated.photoCount.toLocaleString('es-ES'),
        aria: 'Ir a las fotos sin mes',
        disabled: false,
      });
    return entries;
  }, [groups]);

  if (failed && !data)
    return (
      <SkyError
        message="No se pudieron cargar los meses de este año. Tu archivo sigue intacto."
        onRetry={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      />
    );
  if (!data || unavailable) return <SkyLoading label={`Cargando ${year}…`} />;

  const total = groups.reduce((sum, group) => sum + group.photoCount, 0);
  const months = groups.filter((group) => group.month !== null).length;

  return (
    <>
      <PeriodHeader
        itemKey="header"
        title={String(year)}
        meta={
          <>
            <b>{total.toLocaleString('es-ES')}</b> {total === 1 ? 'foto' : 'fotos'} ·{' '}
            {monthCountLabel(months)} con fotos
          </>
        }
      />
      <SkyThread keys={keys} />
      {groups.map((group, index) => {
        const undated = group.month === null;
        const key = groupKey(group);
        const title = undated ? 'Sin mes' : monthTitle(group.month!);
        return (
          <Constellation
            key={key}
            itemKey={key}
            index={index}
            count={groups.length}
            kind={MONTH_CONSTELLATION}
            seed={year * 13 + (group.month ?? 0)}
            title={title}
            meta={
              <>
                <b>{group.photoCount.toLocaleString('es-ES')}</b>{' '}
                {group.photoCount === 1 ? 'foto' : 'fotos'}
                {undated ? ` · ${group.label ?? 'Fecha sin concretar'}` : ''}
              </>
            }
            cta="Ver"
            ariaLabel={
              undated
                ? `Ver las fotos de ${year} sin mes: ${photoCountLabel(group.photoCount)}`
                : `Ver ${title}: ${photoCountLabel(group.photoCount)}`
            }
            href={timelineHrefWithReturn(
              timelineHref({ year, month: undated ? 'sin-mes' : group.month }),
              returnTo,
              returnLabel,
            )}
            undated={undated}
            afterHeader={index === 0}
            photos={group.previews}
            more={Math.max(0, group.photoCount - group.previews.length)}
            onEnter={(href, cluster) => travel(href, 'in', cluster, null)}
          />
        );
      })}
      <SkyOverlay>
        <SkyRail entries={rail} label="Saltar a un mes" />
        <SkyHint text="Pulsa un mes para ver todas sus fotos · Esc para volver a los años" />
      </SkyOverlay>
    </>
  );
}
