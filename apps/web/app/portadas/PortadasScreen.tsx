'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError, activeDriveConnection, type Session } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { coversApi } from '../../lib/covers/client';
import {
  DEFAULT_LIMITS,
  UNKNOWN_MONTH_SCOPE,
  YEAR_SCOPE,
  coverStatus,
  dropReasonCopy,
  monthScope,
  moveChoice,
  previewPhotos,
  sameOrder,
  sameScope,
  scopeKey,
  scopeName,
  scopeTitle,
  toggleChoice,
  type CoverScope,
} from '../../lib/covers/model';
import { apiErrorCopy } from '../../lib/sources/errors';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { SkyToast } from '../components/SkyToast';
import { photoCountLabel, type TimelinePhoto } from '../components/timeline-model';
import { GridSkeleton, LoadMore } from '../ordenar/PhotoGrid';
import { CandidateGrid, ChosenStrip } from './CoverParts';
import { CoverPreview } from './CoverPreview';
import { useCandidates, useYearData, useYears } from './use-covers-data';
import '../ordenar/ordenar.css';
import './portadas.css';

type Toast = {
  key: number;
  message: string;
  tone: 'ok' | 'error';
  link?: { href: string; label: string };
  undo?: () => Promise<void>;
};
type Target = { year: number; scope: CoverScope };

const TOAST_MS = 9000;

/** Portadas: choose, in order, the photos that stand for each year, month and "Sin mes" group. */
export function PortadasScreen({ session }: { session: Session }) {
  const years = useYears();
  const [year, setYear] = useState<number | null>(null);
  const [scope, setScope] = useState<CoverScope>(YEAR_SCOPE);
  const yearData = useYearData(year);
  const candidates = useCandidates(year, scope);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Target | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const known = useRef(new Map<string, TimelinePhoto>());
  const toastTimer = useRef<number | undefined>(undefined);
  const toastKey = useRef(0);
  const focusRequest = useRef<{ id: string; act: string; index: number } | null>(null);
  const yearSelectId = useId();

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // The newest year with photos opens first.
  useEffect(() => {
    if (year === null && years.status === 'ready' && years.years.length) setYear(years.years[0]!);
  }, [year, years.status, years.years]);

  const data =
    yearData.status === 'ready' && yearData.data?.covers.year === year ? yearData.data : null;
  const limits = data?.covers.limits ?? DEFAULT_LIMITS;
  const limit = limits[scope.kind];
  const saved = data?.covers.items.find((item) => sameScope(item, scope));
  const savedIds = useMemo(() => saved?.photos.map((photo) => photo.id) ?? [], [saved]);
  const dropped = saved?.dropped ?? [];
  const scopeId = scopeKey(scope);

  // A different cover (or fresh data after saving) starts from what is saved.
  useEffect(() => {
    if (!data) return;
    const current = data.covers.items.find((item) => sameScope(item, scope));
    for (const photo of current?.photos ?? []) known.current.set(photo.id, photo);
    setDraft(current?.photos.map((photo) => photo.id) ?? []);
    // `scope` is identified by its key.
  }, [data, scopeId]);

  const dirty = data !== null && !sameOrder(draft, savedIds);
  const canSave = data !== null && !busy && (dirty || dropped.length > 0);
  const hasChoice = savedIds.length > 0 || dropped.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const chosenPhotos = draft
    .map((id) => known.current.get(id))
    .filter((photo): photo is TimelinePhoto => Boolean(photo));

  const automatic = useMemo(() => {
    if (!data) return [];
    if (scope.kind === 'YEAR') return data.summary.previews;
    const group = data.monthPreviews.items.find((item) =>
      scope.kind === 'UNKNOWN_MONTH' ? item.month === null : item.month === scope.month,
    );
    return group?.previews ?? [];
  }, [data, scope]);
  const shown = previewPhotos(chosenPhotos, automatic, limit);

  const show = useCallback((next: Omit<Toast, 'key'>) => {
    window.clearTimeout(toastTimer.current);
    toastKey.current += 1;
    setToast({ ...next, key: toastKey.current });
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  const dismiss = useCallback(() => {
    window.clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  // Keyboard focus follows a moved or removed photo instead of falling back to the page.
  useEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request) return;
    const items = document.querySelectorAll<HTMLElement>('.cov-strip li');
    if (request.act === 'remove') {
      const next = items[Math.min(request.index, items.length - 1)];
      (
        next?.querySelector<HTMLElement>('[data-act="remove"]') ??
        document.querySelector<HTMLElement>('.cov-grid button')
      )?.focus();
      return;
    }
    const item = document.querySelector<HTMLElement>(`[data-chosen-id="${request.id}"]`);
    const button =
      item?.querySelector<HTMLButtonElement>(`[data-act="${request.act}"]:not(:disabled)`) ??
      item?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    button?.focus();
  }, [draft]);

  const onToggle = (photo: TimelinePhoto) => {
    const result = toggleChoice(draft, photo.id, limit);
    if (result.blocked) {
      setAnnouncement(`La portada ya tiene ${limit} fotos. Quita una para añadir otra.`);
      return;
    }
    known.current.set(photo.id, photo);
    setDraft(result.ids);
    setAnnouncement(
      result.ids.includes(photo.id)
        ? `Foto añadida en el puesto ${result.ids.length}. ${result.ids.length} de ${limit}.`
        : `Foto quitada. ${result.ids.length} de ${limit}.`,
    );
  };
  const onMove = (id: string, delta: -1 | 1) => {
    focusRequest.current = { id, act: delta < 0 ? 'earlier' : 'later', index: 0 };
    const next = moveChoice(draft, id, delta);
    setDraft(next);
    setAnnouncement(`Foto movida al puesto ${next.indexOf(id) + 1} de ${next.length}.`);
  };
  const onRemove = (id: string) => {
    focusRequest.current = { id, act: 'remove', index: draft.indexOf(id) };
    const next = draft.filter((other) => other !== id);
    setDraft(next);
    setAnnouncement(`Foto quitada. ${next.length} de ${limit}.`);
  };

  const failure = async (error: unknown, fallback: string) => {
    show({
      tone: 'error',
      message:
        error instanceof ApiError && error.code === 'COVER_PHOTOS_REJECTED'
          ? 'Alguna foto ya no puede estar en esta portada. Hemos recargado las portadas; revisa tu elección.'
          : apiErrorCopy(error, fallback),
    });
    if (error instanceof ApiError && error.code === 'COVER_PHOTOS_REJECTED')
      await yearData.reload();
  };

  const save = async (): Promise<boolean> => {
    if (year === null || !canSave) return false;
    setBusy(true);
    try {
      await coversApi.save(year, scope, draft);
      notifyArchiveIndexUpdated();
      await yearData.reload();
      show({
        tone: 'ok',
        message: draft.length
          ? `Portada guardada: ${photoCountLabel(draft.length)} elegidas.`
          : 'Portada vuelta a automática.',
        link: { href: `/timeline/${year}`, label: 'Verla en la cronología' },
      });
      setAnnouncement('Portada guardada.');
      return true;
    } catch (error) {
      await failure(
        error,
        'No se pudo guardar la portada. Tu elección sigue aquí; inténtalo de nuevo.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (year === null || busy) return;
    const previous = savedIds;
    const target = { year, scope };
    setBusy(true);
    try {
      await coversApi.reset(year, scope);
      notifyArchiveIndexUpdated();
      await yearData.reload();
      show({
        tone: 'ok',
        message: 'La portada vuelve a ser automática.',
        undo: previous.length
          ? async () => {
              setBusy(true);
              try {
                await coversApi.save(target.year, target.scope, previous);
                notifyArchiveIndexUpdated();
                await yearData.reload();
                setAnnouncement('Portada recuperada.');
              } catch (error) {
                await failure(error, 'No se pudo recuperar la portada.');
              } finally {
                setBusy(false);
              }
            }
          : undefined,
      });
      setAnnouncement('La portada vuelve a ser automática.');
    } catch (error) {
      await failure(error, 'No se pudo volver a la portada automática. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

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
      return (
        <div role="alert" className="sp-alert">
          No se pudo cargar tu archivo.{' '}
          <button type="button" className="sp-btn" onClick={years.reload}>
            Reintentar
          </button>
        </div>
      );
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
        <aside className="ord-side" aria-label="Años y portadas">
          <div className="ord-source">
            <label className="sp-label" htmlFor={yearSelectId}>
              Año
            </label>
            <select
              id={yearSelectId}
              value={year ?? ''}
              onChange={(event) => goTo({ year: Number(event.target.value), scope: YEAR_SCOPE })}
            >
              {years.years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label={`Portadas de ${year ?? ''}`} className="ord-piles">
            <h2 className="sp-label">Portadas de {year}</h2>
            {scopes.map((target) => (
              <button
                key={scopeKey(target)}
                type="button"
                className="ord-pile cov-scope"
                aria-current={sameScope(target, scope) ? 'true' : undefined}
                onClick={() => year !== null && goTo({ year, scope: target })}
              >
                <b>{scopeName(target)}</b>
                <span>
                  {coverStatus(data?.covers.items.find((item) => sameScope(item, target)))}
                </span>
              </button>
            ))}
          </nav>
        </aside>

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
            <div role="alert" className="sp-alert">
              No se pudieron cargar las portadas de este año.{' '}
              <button type="button" className="sp-btn" onClick={() => void yearData.reload()}>
                Reintentar
              </button>
            </div>
          )}
          {yearData.status === 'loading' && <GridSkeleton />}

          {pending && (
            <div className="cov-guard" role="alertdialog" aria-label="Cambios sin guardar">
              <p>Tienes cambios sin guardar en esta portada.</p>
              <div>
                <button
                  type="button"
                  className="sp-btn primary"
                  disabled={busy}
                  onClick={() => void save().then((ok) => ok && apply(pending))}
                >
                  Guardar y cambiar
                </button>
                <button
                  type="button"
                  className="sp-btn"
                  disabled={busy}
                  onClick={() => apply(pending)}
                >
                  Descartar y cambiar
                </button>
                <button type="button" className="sp-btn ghost" onClick={() => setPending(null)}>
                  Seguir editando
                </button>
              </div>
            </div>
          )}

          {data && (
            <>
              {dropped.length > 0 && (
                <div className="sp-alert cov-missing" role="status">
                  <b>
                    {dropped.length === 1
                      ? 'Una foto elegida ya no está en esta portada.'
                      : `${dropped.length} fotos elegidas ya no están en esta portada.`}
                  </b>{' '}
                  {[...new Set(dropped.map((item) => dropReasonCopy[item.reason]))].join('; ')}.
                  Mientras tanto la portada se completa sola; elige otra y guarda para sustituirla.
                </div>
              )}

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
                <div role="alert" className="sp-alert">
                  No se pudieron cargar las fotos. Tu archivo sigue intacto.{' '}
                  <button type="button" className="sp-btn" onClick={candidates.reload}>
                    Reintentar
                  </button>
                </div>
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

      {toast && (
        <SkyToast
          key={toast.key}
          message={toast.message}
          tone={toast.tone}
          link={toast.link}
          busy={busy}
          onUndo={
            toast.undo
              ? () => {
                  const undo = toast.undo;
                  dismiss();
                  void undo?.();
                }
              : undefined
          }
          onDismiss={dismiss}
        />
      )}
      <p className="sp-sr" role="status" aria-live="polite">
        {announcement}
      </p>
    </SkyPage>
  );
}
