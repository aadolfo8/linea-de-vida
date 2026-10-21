'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { previewSentence } from '../../lib/ordering/copy';
import {
  DECADES,
  MONTH_ABBREVIATIONS,
  daysInMonth,
  draftLabel,
  parseYearInput,
  stepYear,
} from '../../lib/ordering/dates';
import type { DateDraft, FolderDatePreview } from '../../lib/ordering/types';
import { useDialog } from '../components/use-dialog';

export type FolderOptions = { includeSubfolders: boolean; overrideCameraDates: boolean };

/**
 * The date sheet, for photos and for a folder. The year is required; the month ("No sé el mes")
 * and the day are optional, and the result line says exactly what will be saved.
 */
export function DateSheet({
  title,
  subtitle,
  previewUrls,
  extraPhotos,
  initial,
  applyText,
  folder,
  onApply,
  onCancel,
}: {
  title: string;
  subtitle: string;
  previewUrls: readonly string[];
  extraPhotos: number;
  initial: { year: number | null; month: number | null; day: number | null };
  applyText: string;
  /** Present for a folder date: the two choices and how to preview their effect. */
  folder?: {
    initial: FolderOptions;
    loadPreview: (draft: DateDraft, options: FolderOptions) => Promise<FolderDatePreview>;
  };
  onApply: (draft: DateDraft, options: FolderOptions) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(dialogRef, onCancel);

  const [yearText, setYearText] = useState(initial.year?.toString() ?? '');
  const [month, setMonth] = useState<number | null>(initial.month);
  const [day, setDay] = useState<number | null>(initial.day);
  const [showDays, setShowDays] = useState(initial.day !== null);
  const [options, setOptions] = useState<FolderOptions>(
    folder?.initial ?? { includeSubfolders: true, overrideCameraDates: false },
  );
  const [preview, setPreview] = useState<
    { state: 'idle' } | { state: 'loading' } | { state: 'error' } | { state: 'ready'; text: string }
  >({ state: 'idle' });

  const year = parseYearInput(yearText);
  const draft: DateDraft | null = useMemo(
    () => (year === null ? null : { year, month, day: month ? day : null }),
    [year, month, day],
  );

  useEffect(() => {
    if (!folder || !draft) {
      setPreview({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setPreview({ state: 'loading' });
    const timer = window.setTimeout(() => {
      folder
        .loadPreview(draft, options)
        .then((value) => !cancelled && setPreview({ state: 'ready', text: previewSentence(value) }))
        .catch(() => !cancelled && setPreview({ state: 'error' }));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The preview depends on what will be sent, not on the identity of the loader.
  }, [draft, options.includeSubfolders, options.overrideCameraDates]);

  const apply = () => {
    if (draft) onApply(draft, options);
  };

  const dayCount = year && month ? daysInMonth(year, month) : 31;

  return (
    <div
      className="sp-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div
        ref={dialogRef}
        className="sp-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
            event.preventDefault();
            apply();
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <p className="sub">{subtitle}</p>
        {previewUrls.length > 0 && (
          <div className="sp-preview" aria-hidden="true">
            {previewUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element -- private proxy URLs
              <img key={url} src={url} alt="" />
            ))}
            {extraPhotos > 0 && <span>+{extraPhotos}</span>}
          </div>
        )}

        <label className="sp-label" htmlFor={`${titleId}-year`}>
          Año
        </label>
        <div className="sp-yearrow">
          <button
            type="button"
            className="step"
            aria-label="Año anterior"
            onClick={() => setYearText(String(stepYear(year ?? 2001, -1)))}
          >
            −
          </button>
          <input
            id={`${titleId}-year`}
            data-autofocus
            inputMode="numeric"
            maxLength={4}
            value={yearText}
            aria-invalid={yearText !== '' && year === null}
            onChange={(event) => setYearText(event.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <button
            type="button"
            className="step"
            aria-label="Año siguiente"
            onClick={() => setYearText(String(stepYear(year ?? 1999, 1)))}
          >
            +
          </button>
        </div>
        <div className="sp-chips" role="group" aria-label="Décadas">
          {DECADES.map((decade) => (
            <button
              key={decade}
              type="button"
              aria-pressed={year !== null && year >= decade && year < decade + 10}
              onClick={() => setYearText(String(decade))}
            >
              {decade}s
            </button>
          ))}
        </div>

        <span className="sp-label" id={`${titleId}-month`}>
          Mes
        </span>
        <div className="sp-months" role="group" aria-labelledby={`${titleId}-month`}>
          {MONTH_ABBREVIATIONS.map((name, index) => (
            <button
              key={name}
              type="button"
              aria-pressed={month === index + 1}
              onClick={() => {
                setMonth(index + 1);
              }}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            className="nomonth"
            aria-pressed={month === null}
            onClick={() => {
              setMonth(null);
              setDay(null);
              setShowDays(false);
            }}
          >
            No sé el mes
          </button>
        </div>

        {month !== null && (
          <>
            {!showDays ? (
              <p>
                <button type="button" className="sp-btn ghost" onClick={() => setShowDays(true)}>
                  Sé el día exacto
                </button>
              </p>
            ) : (
              <>
                <span className="sp-label" id={`${titleId}-day`}>
                  Día
                </span>
                <div className="sp-days" role="group" aria-labelledby={`${titleId}-day`}>
                  {Array.from({ length: dayCount }, (_, index) => index + 1).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={day === value}
                      onClick={() => setDay(day === value ? null : value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {folder && (
          <>
            <label className="sp-opt">
              <input
                type="checkbox"
                checked={options.includeSubfolders}
                onChange={(event) =>
                  setOptions((current) => ({ ...current, includeSubfolders: event.target.checked }))
                }
              />
              <span>
                Incluir subcarpetas
                <small>La fecha vale también para las fotos de las carpetas de dentro.</small>
              </span>
            </label>
            <label className="sp-opt">
              <input
                type="checkbox"
                checked={options.overrideCameraDates}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    overrideCameraDates: event.target.checked,
                  }))
                }
              />
              <span>
                Cambiar también las que ya traen fecha de cámara
                <small>Normalmente es mejor dejarlas. Las que pusiste a mano nunca se tocan.</small>
              </span>
            </label>
            <p className="sp-sentence" aria-live="polite">
              {preview.state === 'loading'
                ? 'Calculando qué cambiaría…'
                : preview.state === 'error'
                  ? 'No pudimos calcular qué cambiaría, pero puedes aplicar la fecha igualmente.'
                  : preview.state === 'ready'
                    ? preview.text
                    : 'Escribe el año para ver qué cambiaría.'}
            </p>
          </>
        )}

        <div className="sp-foot">
          <span className="sp-result" aria-live="polite">
            {draft ? draftLabel(draft) : 'Escribe un año de cuatro cifras'}
          </span>
          <button type="button" className="sp-btn ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="sp-btn primary" disabled={!draft} onClick={apply}>
            {applyText}
          </button>
        </div>
      </div>
    </div>
  );
}
