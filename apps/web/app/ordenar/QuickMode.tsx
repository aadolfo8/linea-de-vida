import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api, signOutIfExpired } from '../../lib/api';
import { orderingApi } from '../../lib/ordering/client';
import {
  DECADES,
  MONTH_ABBREVIATIONS,
  draftLabel,
  draftToPayload,
  monthName,
  parseYearInput,
  storedLabel,
} from '../../lib/ordering/dates';
import {
  DATE_STATUSES,
  HIDE_STATUSES,
  classifyResults,
  withMissingAsFailed,
} from '../../lib/ordering/results';
import {
  flushBuffer,
  initialQuickState,
  nextPhotoState,
  pushDigit,
  quickKey,
  setQuickMonth,
  setQuickYear,
  stepQuickYear,
  type QuickState,
} from '../../lib/ordering/quick';
import { thumbnailVariantUrl } from '../../lib/media';
import type { OrderScope, OrderingPhoto } from '../../lib/ordering/types';
import { apiErrorCopy } from '../../lib/sources/errors';
import { useDialog } from '../components/use-dialog';

const MAX_PHOTOS = 1000;

export type QuickSummary = { dated: number; hidden: number };
export type QuickResult = QuickSummary & { empty: boolean };

/** Loads the photos still to date (no date, then year only) of the current scope, page by page. */
function useQuickPhotos(scope: OrderScope) {
  const [photos, setPhotos] = useState<OrderingPhoto[]>([]);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhotos([]);
    setStatus('loading');
    (async () => {
      // A photo dated with only a year moves from "undated" to "year only" while this runs, so it
      // can come back in the second pile: every id is taken once per session.
      const seen = new Set<string>();
      for (const pile of ['undated', 'yearOnly'] as const) {
        let cursor: string | null = null;
        do {
          if (seen.size >= MAX_PHOTOS) break;
          const page = await orderingApi.photos(scope, pile, {
            cursor,
            limit: 100,
            order: 'name',
          });
          if (cancelled) return;
          const fresh = page.items
            .filter((item) => !seen.has(item.id))
            .slice(0, MAX_PHOTOS - seen.size);
          for (const item of fresh) seen.add(item.id);
          if (fresh.length) setPhotos((current) => [...current, ...fresh]);
          cursor = page.nextCursor;
        } while (cursor);
      }
      if (!cancelled) setStatus('done');
    })().catch((error: unknown) => {
      signOutIfExpired(error);
      if (!cancelled) setStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [scope, attempt]);

  return { photos, status, retry: () => setAttempt((value) => value + 1) };
}

/**
 * "Fechar una a una": one big photo at a time. The year stays between photos, so a run of photos
 * from the same year needs only a month and Enter.
 */
export function QuickMode({
  scope,
  onClose,
}: {
  scope: OrderScope;
  onClose: (result: QuickResult) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { photos, status, retry } = useQuickPhotos(scope);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<QuickState>(initialQuickState(null));
  const [yearText, setYearText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<QuickSummary>({ dated: 0, hidden: 0 });
  const summaryRef = useRef(summary);
  summaryRef.current = summary;
  const finish = useCallback(() => onClose({ ...summaryRef.current, empty: false }), [onClose]);
  useDialog(dialogRef, finish);

  useEffect(() => setYearText(state.year?.toString() ?? ''), [state.year]);

  const photo = photos[index] ?? null;
  const atEnd = !photo && status !== 'loading';

  // Nothing left (or nothing to begin with): close and let the screen say so.
  useEffect(() => {
    if (atEnd && status === 'done') onClose({ ...summaryRef.current, empty: photos.length === 0 });
  }, [atEnd, status, onClose, photos.length]);

  const advance = useCallback(() => {
    setError('');
    setIndex((value) => value + 1);
    setState(nextPhotoState);
  }, []);

  const save = useCallback(async () => {
    if (!photo || saving) return;
    const committed = flushBuffer(state);
    setState(committed);
    if (committed.year === null) {
      setError('Escribe primero el año de esta foto.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = draftToPayload({ year: committed.year, month: committed.month, day: null });
      const result = withMissingAsFailed(
        [photo.id],
        classifyResults((await orderingApi.setDates([photo.id], payload)).results, DATE_STATUSES),
      );
      if (result.failed.length) {
        setError('No se pudo guardar esta fecha. Inténtalo de nuevo o pulsa Saltar.');
        return;
      }
      setSummary((current) => ({ ...current, dated: current.dated + 1 }));
      advance();
    } catch (failure) {
      signOutIfExpired(failure);
      setError(apiErrorCopy(failure, 'No se pudo guardar esta fecha. Comprueba la conexión.'));
    } finally {
      setSaving(false);
    }
  }, [advance, photo, saving, state]);

  const hide = useCallback(async () => {
    if (!photo || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = withMissingAsFailed(
        [photo.id],
        classifyResults((await orderingApi.hide([photo.id])).results, HIDE_STATUSES),
      );
      if (result.failed.length) {
        setError('No se pudo ocultar esta foto. Inténtalo de nuevo.');
        return;
      }
      setSummary((current) => ({ ...current, hidden: current.hidden + 1 }));
      advance();
    } catch (failure) {
      signOutIfExpired(failure);
      setError(apiErrorCopy(failure, 'No se pudo ocultar esta foto. Comprueba la conexión.'));
    } finally {
      setSaving(false);
    }
  }, [advance, photo, saving]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    const inTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    // Enter on a focused button presses that button, not "save".
    if (event.key === 'Enter' && target instanceof HTMLButtonElement) return;
    const command = quickKey(event.key, inTextField);
    if (command.kind === 'none' || command.kind === 'finish') return;
    event.preventDefault();
    if (command.kind === 'digit') setState((current) => pushDigit(current, command.digit));
    else if (command.kind === 'year-step')
      setState((current) => stepQuickYear(current, command.delta));
    else if (command.kind === 'save') void save();
    else if (command.kind === 'skip') advance();
    else if (command.kind === 'hide') void hide();
  };

  const currentLabel = photo
    ? storedLabel(photo.effectiveDate.value, photo.effectiveDate.precision)
    : null;
  const saveLabel =
    state.year === null
      ? 'Guardar y siguiente'
      : `Guardar «${state.month ? `${monthName(state.month)} ` : ''}${state.year}» y siguiente`;
  const total = photos.length;

  return (
    <div className="ord-quick" role="presentation">
      <div
        ref={dialogRef}
        className="ord-quick-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ord-quick-photo" tabIndex={-1} data-autofocus>
          {photo && (
            <>
              <div
                className="ord-quick-ambient"
                aria-hidden="true"
                style={{
                  backgroundImage: `url("${thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}")`,
                }}
              />
              <img
                key={photo.id}
                src={thumbnailVariantUrl(api, photo.thumbnailUrl, 1280)}
                alt={`Foto ${photo.fileName}`}
              />
              <div className="ord-quick-meta">
                {photo.fileName}
                <br />
                {currentLabel ? `Ahora: ${currentLabel}` : 'Ahora: sin fecha'}
              </div>
            </>
          )}
          {!photo && status === 'loading' && <p className="ord-quick-wait">Cargando fotos…</p>}
          {!photo && status === 'error' && (
            <div className="ord-quick-wait" role="alert">
              <p>No se pudieron cargar las fotos.</p>
              <button type="button" className="sp-btn" onClick={retry}>
                Reintentar
              </button>
            </div>
          )}
        </div>
        <aside className="ord-quick-side">
          <h2 id={titleId}>Fechar una a una</h2>
          <p className="ord-quick-count" aria-live="polite">
            {photo
              ? `Foto ${index + 1} de ${total}${status === 'loading' ? '…' : ''} · ${summary.dated} fechadas`
              : 'Preparando…'}
          </p>
          <div
            className="ord-progress"
            role="progressbar"
            aria-label="Progreso"
            aria-valuemin={0}
            aria-valuemax={Math.max(total, 1)}
            aria-valuenow={Math.min(index, total)}
          >
            <i style={{ width: `${total ? (Math.min(index, total) / total) * 100 : 0}%` }} />
          </div>

          <label className="sp-label" htmlFor={`${titleId}-year`}>
            Año
          </label>
          <div className="sp-yearrow">
            <button
              type="button"
              className="step"
              aria-label="Año anterior"
              onClick={() => setState((current) => stepQuickYear(current, -1))}
            >
              −
            </button>
            <input
              id={`${titleId}-year`}
              inputMode="numeric"
              maxLength={4}
              value={yearText}
              aria-invalid={yearText !== '' && parseYearInput(yearText) === null}
              onChange={(event) => {
                const text = event.target.value.replace(/\D/g, '').slice(0, 4);
                setYearText(text);
                const year = parseYearInput(text);
                if (year !== null) setState((current) => setQuickYear(current, year));
              }}
            />
            <button
              type="button"
              className="step"
              aria-label="Año siguiente"
              onClick={() => setState((current) => stepQuickYear(current, 1))}
            >
              +
            </button>
          </div>
          <div className="sp-chips" role="group" aria-label="Décadas">
            {DECADES.map((decade) => (
              <button
                key={decade}
                type="button"
                onClick={() => setState((current) => setQuickYear(current, decade))}
              >
                {decade}s
              </button>
            ))}
          </div>

          <span className="sp-label" id={`${titleId}-month`}>
            Mes
          </span>
          <div className="sp-months" role="group" aria-labelledby={`${titleId}-month`}>
            {MONTH_ABBREVIATIONS.map((name, monthIndex) => (
              <button
                key={name}
                type="button"
                aria-pressed={state.month === monthIndex + 1}
                onClick={() =>
                  setState((current) =>
                    setQuickMonth(
                      current,
                      current.month === monthIndex + 1 ? null : monthIndex + 1,
                    ),
                  )
                }
              >
                {name}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="sp-alert">
              {error}
            </p>
          )}
          {state.buffer && (
            <p className="ord-quick-buffer" aria-live="polite">
              Escribiendo: {state.buffer}…
            </p>
          )}

          <div className="ord-quick-actions">
            <button
              type="button"
              className="sp-btn primary"
              disabled={!photo || saving || state.year === null}
              onClick={() => void save()}
            >
              {saveLabel}
            </button>
            <button type="button" className="sp-btn" disabled={!photo || saving} onClick={advance}>
              Saltar
            </button>
          </div>
          <div className="ord-quick-actions">
            <button
              type="button"
              className="sp-btn ghost"
              disabled={!photo || saving}
              onClick={() => void hide()}
            >
              Ocultar esta foto
            </button>
            <button type="button" className="sp-btn ghost" onClick={finish}>
              Terminar
            </button>
          </div>
          <p className="ord-keys">
            <kbd>0-9</kbd> escribir año · <kbd>←</kbd>
            <kbd>→</kbd> año ±1
            <br />
            <kbd>1</kbd>…<kbd>12</kbd> tras el año: mes · <kbd>Enter</kbd> guardar
            <br />
            <kbd>S</kbd> saltar · <kbd>H</kbd> ocultar · <kbd>Esc</kbd> terminar
          </p>
          <span className="sp-sr" aria-live="polite">
            {state.year !== null
              ? draftLabel({ year: state.year, month: state.month, day: null })
              : ''}
          </span>
        </aside>
      </div>
    </div>
  );
}
