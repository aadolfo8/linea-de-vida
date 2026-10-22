'use client';

import { ChevronRight, X } from 'lucide-react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { api } from '../../lib/api';
import { suggestionText } from '../../lib/ordering/copy';
import { draftFromStored, draftLabel, storedLabel } from '../../lib/ordering/dates';
import { photoCountLabel } from '../components/timeline-model';
import { thumbnailVariantUrl } from '../../lib/media';
import type {
  FilenameSuggestions,
  FolderDetail,
  FolderNode,
  OrderingPhoto,
} from '../../lib/ordering/types';
import { useDialog } from '../components/use-dialog';

/** "24 fotos llevan la fecha en el nombre … Usar esas fechas". */
export function SuggestionBanner({
  suggestions,
  busy,
  onAccept,
}: {
  suggestions: FilenameSuggestions;
  busy: boolean;
  onAccept: () => void;
}) {
  const { title, detail } = suggestionText(suggestions);
  const examples = suggestions.groups.flatMap((group) => group.examples).slice(0, 5);
  return (
    <section className="sp-banner" aria-label="Fechas que vienen en el nombre">
      {examples.length > 0 && (
        <div className="ord-strip" aria-hidden="true">
          {examples.map((example) => (
            // eslint-disable-next-line @next/next/no-img-element -- private proxy URLs
            <img
              key={example.id}
              src={thumbnailVariantUrl(api, `/v1/photos/${example.id}/thumbnail`, 640)}
              alt=""
            />
          ))}
        </div>
      )}
      <div className="text">
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </div>
      <button type="button" className="sp-btn primary" disabled={busy} onClick={onAccept}>
        Usar esas fechas
      </button>
    </section>
  );
}

/** Where you are inside the source, the subfolder switch and the folder's own date. */
export function FolderBar({
  sourceName,
  folder,
  node,
  includeSubfolders,
  busy,
  onGoTo,
  onIncludeSubfolders,
  onSetDate,
  onRemoveDate,
}: {
  sourceName: string;
  folder: FolderDetail;
  /** The folder as the tree knows it, which is fresher than the detail after a change. */
  node: FolderNode | null;
  includeSubfolders: boolean;
  busy: boolean;
  onGoTo: (id: string | null) => void;
  onIncludeSubfolders: (value: boolean) => void;
  onSetDate: () => void;
  onRemoveDate: () => void;
}) {
  const rule = node?.dateRule ?? folder.dateRule;
  const ruleDraft = rule ? draftFromStored(rule.dateValue, rule.precision) : null;
  const switchId = useId();
  return (
    <section className="ord-folderbar" aria-label={`Carpeta ${folder.name}`}>
      <nav aria-label="Dónde estás">
        <ol className="ord-crumbs">
          <li>
            <button type="button" onClick={() => onGoTo(null)}>
              {sourceName}
            </button>
          </li>
          {folder.breadcrumb.map((crumb, index) => {
            const last = index === folder.breadcrumb.length - 1;
            return (
              <li key={crumb.id}>
                <ChevronRight aria-hidden="true" />
                {last ? (
                  <span aria-current="location">{crumb.name}</span>
                ) : (
                  <button type="button" onClick={() => onGoTo(crumb.id)}>
                    {crumb.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="ord-folderdate">
        <div className="fd">
          {rule && ruleDraft ? (
            <>
              <b>Fecha de la carpeta: {draftLabel(ruleDraft, new Date(Date.UTC(9999, 0, 1)))}</b>
              <small>
                {rule.includeSubfolders ? 'Incluye las subcarpetas.' : 'Solo esta carpeta.'}{' '}
                {rule.overrideCameraDates
                  ? 'También cambia las fotos que traían fecha de cámara.'
                  : 'Respeta las fotos que traen fecha de cámara.'}
              </small>
            </>
          ) : (
            <>
              <b>¿Todas las fotos de «{folder.name}» son del mismo momento?</b>
              <small>
                Ponle una fecha a la carpeta entera de una vez. Las que ya tengan fecha se pueden
                mantener.
              </small>
            </>
          )}
        </div>
        <label className="ord-switch" htmlFor={switchId}>
          <input
            id={switchId}
            type="checkbox"
            checked={includeSubfolders}
            onChange={(event) => onIncludeSubfolders(event.target.checked)}
          />
          Incluir subcarpetas
        </label>
        <button type="button" className="sp-btn" disabled={busy} onClick={onSetDate}>
          Poner fecha a la carpeta
        </button>
        {rule && (
          <button type="button" className="sp-btn ghost" disabled={busy} onClick={onRemoveDate}>
            Quitar fecha de la carpeta
          </button>
        )}
      </div>
    </section>
  );
}

/** The floating bar over the selection. */
export function ActionBar({
  count,
  canClear,
  hiddenPile,
  busy,
  onDate,
  onClear,
  onToggleHidden,
  onCancel,
}: {
  count: number;
  canClear: boolean;
  hiddenPile: boolean;
  busy: boolean;
  onDate: () => void;
  onClear: () => void;
  onToggleHidden: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="ord-actions" role="toolbar" aria-label="Acciones con la selección">
      <span className="count">{photoCountLabel(count)}</span>
      <button
        type="button"
        className={hiddenPile ? 'sp-btn' : 'sp-btn primary'}
        disabled={busy}
        onClick={onDate}
      >
        Poner fecha
      </button>
      {canClear && (
        <button type="button" className="sp-btn" disabled={busy} onClick={onClear}>
          Quitar fecha
        </button>
      )}
      <button
        type="button"
        className={hiddenPile ? 'sp-btn primary' : 'sp-btn'}
        disabled={busy}
        onClick={onToggleHidden}
      >
        {hiddenPile ? 'Volver a mostrar' : 'Ocultar'}
      </button>
      <button type="button" className="sp-btn ghost" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

/** A photo at a larger size, with the arrows to look at its neighbours. */
export function Peek({
  photos,
  index,
  onChange,
  onClose,
}: {
  photos: readonly OrderingPhoto[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(ref, onClose);
  const photo = photos[index];
  if (!photo) return null;
  const date = storedLabel(photo.effectiveDate.value, photo.effectiveDate.precision);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' && index > 0) onChange(index - 1);
    else if (event.key === 'ArrowRight' && index < photos.length - 1) onChange(index + 1);
  };

  return (
    <div
      className="ord-peek"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ord-peek-dialog"
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="ord-peek-close sp-btn"
          data-autofocus
          aria-label="Cerrar"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element -- private proxy URL */}
        <img
          key={photo.id}
          src={thumbnailVariantUrl(api, photo.thumbnailUrl, 1280)}
          alt={`Foto ${photo.fileName}`}
        />
        <p id={titleId}>
          {photo.fileName} · {date ?? 'sin fecha'}
        </p>
      </div>
    </div>
  );
}
