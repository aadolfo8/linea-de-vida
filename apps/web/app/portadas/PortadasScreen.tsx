'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { activeDriveConnection, type Session } from '../../lib/api';
import {
  UNKNOWN_MONTH_SCOPE,
  YEAR_SCOPE,
  monthScope,
  previewPhotos,
  sameScope,
  scopeTitle,
  type CoverScope,
} from '../../lib/covers/model';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { ToastHost } from '../components/ToastHost';
import { photoCountLabel } from '../components/timeline-model';
import { GridSkeleton, LoadMore } from '../ordenar/PhotoGrid';
import { CandidateGrid, ChosenStrip } from './CoverParts';
import { RetryAlert } from '../components/RetryAlert';
import { DroppedNotice, UnsavedGuard, YearSidebar } from './PortadasParts';
import { CoverPreview } from './CoverPreview';
import { useCoverEditor } from './use-cover-editor';
import { useCandidates, useYearData, useYears } from './use-covers-data';
import '../ordenar/ordenar.css';
import './portadas.css';

type Target = { year: number; scope: CoverScope };

/** Portadas: choose, in order, the photos that stand for each year, month and "Sin mes" group. */
export function PortadasScreen({ session }: { session: Session }) {
  const years = useYears();
  const [year, setYear] = useState<number | null>(null);
  const [scope, setScope] = useState<CoverScope>(YEAR_SCOPE);
  const yearData = useYearData(year);
  const candidates = useCandidates(year, scope);
  const [pending, setPending] = useState<Target | null>(null);

  // The newest year with photos opens first.
  useEffect(() => {
    if (year === null && years.status === 'ready' && years.years.length) setYear(years.years[0]!);
  }, [year, years.status, years.years]);

  const data =
    yearData.status === 'ready' && yearData.data?.covers.year === year ? yearData.data : null;

  const editor = useCoverEditor({ year, scope, data, reload: yearData.reload });
  const { draft, setDraft, busy, dirty, limit, dropped, hasChoice, canSave, chosenPhotos } = editor;
  const { toast, dismiss, announcement, onToggle, onMove, onRemove, save, reset } = editor;

  const automatic = useMemo(() => {
    if (!data) return [];
    if (scope.kind === 'YEAR') return data.summary.previews;
    const group = data.monthPreviews.items.find((item) =>
      scope.kind === 'UNKNOWN_MONTH' ? item.month === null : item.month === scope.month,
    );
    return group?.previews ?? [];
  }, [data, scope]);
  const shown = previewPhotos(chosenPhotos, automatic, limit);

  const apply = (target: Target) => {
    setPending(null);
    dismiss();
    if (target.year !== year) {
      setYear(target.year);
      setDraft([]);
    }
    setScope(target.scope);
  };
  // Leaving a cover with unsaved changes asks first.
  const goTo = (target: Target) => {
    if (target.year === year && sameScope(target.scope, scope)) return;
    if (dirty) setPending(target);
    else apply(target);
  };

  const summary = data?.summary;
  const scopes: CoverScope[] = [
    YEAR_SCOPE,
    ...(summary?.months.filter((month) => month.photoCount > 0).map((m) => monthScope(m.month)) ??
      []),
    ...(summary && summary.unknownMonthCount > 0 ? [UNKNOWN_MONTH_SCOPE] : []),
  ];
  const countOf = (target: CoverScope) =>
    !summary
      ? 0
      : target.kind === 'YEAR'
        ? summary.total
        : target.kind === 'UNKNOWN_MONTH'
          ? summary.unknownMonthCount
          : (summary.months.find((month) => month.month === target.month)?.photoCount ?? 0);

  const body = () => {
    if (years.status === 'loading') return <p className="ord-hint">Cargando tu archivo…</p>;
    if (years.status === 'error')
      return <RetryAlert message="No se pudo cargar tu archivo." onRetry={years.reload} />;
    if (!years.years.length)
      return (
        <div className="sp-empty">
          <b>Aún no hay fotos con fecha</b>
          Pon fecha a tus fotos en Ordenar y podrás elegir la portada de cada año.
          <p>
            <Link className="sp-btn primary" href="/ordenar">
              Ir a Ordenar
            </Link>
          </p>
        </div>
      );
    return (
      <div className="ord-desk">
        <YearSidebar
          years={years.years}
          year={year}
          scopes={scopes}
          scope={scope}
          items={data?.covers.items}
          onChange={goTo}
        />

        <section className="ord-content" aria-label={year ? scopeTitle(scope, year) : 'Portada'}>
          {year !== null && (
            <div className="ord-toolbar">
              <div>
                <h2>{scopeTitle(scope, year)}</h2>
                <p className="ord-sub">
                  {data ? `${photoCountLabel(countOf(scope))} en este grupo. ` : ''}
                  Elegidas: {draft.length} de {limit}.
                </p>
              </div>
            </div>
          )}

          {yearData.status === 'error' && (
            <RetryAlert
              message="No se pudieron cargar las portadas de este año."
              onRetry={() => void yearData.reload()}
            />
          )}
          {yearData.status === 'loading' && <GridSkeleton />}

          {pending && (
            <UnsavedGuard
              busy={busy}
              onSave={() => void save().then((ok) => ok && apply(pending))}
              onDiscard={() => apply(pending)}
              onKeepEditing={() => setPending(null)}
            />
          )}

          {data && (
            <>
              <DroppedNotice dropped={dropped} />

              <div className="cov-stage">
                <div>
                  <h3 className="sp-label">Así se verá</h3>
                  <CoverPreview
                    photos={shown}
                    seed={
                      year! * 13 + (scope.month ?? 0) + (scope.kind === 'UNKNOWN_MONTH' ? 99 : 0)
                    }
                    label={`Vista previa de ${scopeTitle(scope, year!)}`}
                  />
                  <p className="ord-hint">
                    Vista aproximada: las fotos automáticas se recalculan al guardar.
                  </p>
                </div>
                <div>
                  <h3 className="sp-label">Tu elección</h3>
                  <ChosenStrip
                    photos={chosenPhotos}
                    limit={limit}
                    busy={busy}
                    onMove={onMove}
                    onRemove={onRemove}
                  />
                  {draft.length >= limit && (
                    <p className="cov-full">
                      Has llegado al máximo de {limit} fotos. Quita una para añadir otra.
                    </p>
                  )}
                </div>
              </div>

              <h3 className="sp-label cov-pick">Elige las fotos</h3>
              {candidates.status === 'loading' && <GridSkeleton />}
              {candidates.status === 'error' && (
                <RetryAlert
                  message="No se pudieron cargar las fotos. Tu archivo sigue intacto."
                  onRetry={candidates.reload}
                />
              )}
              {candidates.status === 'ready' && candidates.items.length === 0 && (
                <div className="sp-empty">
                  <b>No hay fotos en este grupo</b>
                  Cuando haya fotos con esta fecha podrás elegirlas aquí.
                </div>
              )}
              {candidates.items.length > 0 && (
                <CandidateGrid photos={candidates.items} chosen={draft} onToggle={onToggle} />
              )}
              {candidates.nextCursor && (
                <LoadMore
                  loading={candidates.loadingMore}
                  failed={candidates.moreFailed}
                  onLoad={candidates.loadMore}
                />
              )}
            </>
          )}
        </section>
      </div>
    );
  };

  return (
    <SkyPage name={session.user.displayName} mainId="portadas-main">
      <div className="sp-head">
        <div>
          <h1>Portadas</h1>
          <p>Elige qué fotos representan cada año y cada mes en la cronología, y en qué orden.</p>
        </div>
      </div>
      <DriveBanner connected={activeDriveConnection(session) !== null} />
      {body()}

      {data && (
        <div className="ord-actions" role="toolbar" aria-label="Acciones de la portada">
          <span className="count">
            {dirty ? 'Cambios sin guardar' : hasChoice ? 'Portada guardada' : 'Portada automática'}
          </span>
          <button
            type="button"
            className="sp-btn primary"
            disabled={!canSave}
            onClick={() => void save()}
          >
            Guardar portada
          </button>
          <button
            type="button"
            className="sp-btn"
            disabled={busy || !hasChoice}
            onClick={() => void reset()}
          >
            Volver a automática
          </button>
        </div>
      )}

      <ToastHost toast={toast} busy={busy} onDismiss={dismiss} />
      <p className="sp-sr" role="status" aria-live="polite">
        {announcement}
      </p>
    </SkyPage>
  );
}
