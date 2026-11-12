import { useId } from 'react';
import {
  YEAR_SCOPE,
  coverStatus,
  dropReasonCopy,
  sameScope,
  scopeKey,
  scopeName,
  type CoverItem,
  type CoverScope,
} from '../../lib/covers/model';

/** Year picker and the list of covers of that year (the year itself, each month, "Sin mes"). */
export function YearSidebar({
  years,
  year,
  scopes,
  scope,
  items,
  onChange,
}: {
  years: number[];
  year: number | null;
  scopes: CoverScope[];
  scope: CoverScope;
  items: CoverItem[] | undefined;
  onChange: (target: { year: number; scope: CoverScope }) => void;
}) {
  const yearSelectId = useId();
  return (
    <aside className="ord-side" aria-label="Años y portadas">
      <div className="ord-source">
        <label className="sp-label" htmlFor={yearSelectId}>
          Año
        </label>
        <select
          id={yearSelectId}
          value={year ?? ''}
          onChange={(event) => onChange({ year: Number(event.target.value), scope: YEAR_SCOPE })}
        >
          {years.map((value) => (
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
            onClick={() => year !== null && onChange({ year, scope: target })}
          >
            <b>{scopeName(target)}</b>
            <span>{coverStatus(items?.find((item) => sameScope(item, target)))}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

/** Asks what to do with unsaved changes before moving to another cover. */
export function UnsavedGuard({
  busy,
  onSave,
  onDiscard,
  onKeepEditing,
}: {
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  return (
    <div className="cov-guard" role="alertdialog" aria-label="Cambios sin guardar">
      <p>Tienes cambios sin guardar en esta portada.</p>
      <div>
        <button type="button" className="sp-btn primary" disabled={busy} onClick={onSave}>
          Guardar y cambiar
        </button>
        <button type="button" className="sp-btn" disabled={busy} onClick={onDiscard}>
          Descartar y cambiar
        </button>
        <button type="button" className="sp-btn ghost" onClick={onKeepEditing}>
          Seguir editando
        </button>
      </div>
    </div>
  );
}

/** Chosen photos that are no longer eligible; the cover fills itself until the person replaces them. */
export function DroppedNotice({ dropped }: { dropped: { reason: keyof typeof dropReasonCopy }[] }) {
  if (!dropped.length) return null;
  return (
    <div className="sp-alert cov-missing" role="status">
      <b>
        {dropped.length === 1
          ? 'Una foto elegida ya no está en esta portada.'
          : `${dropped.length} fotos elegidas ya no están en esta portada.`}
      </b>{' '}
      {[...new Set(dropped.map((item) => dropReasonCopy[item.reason]))].join('; ')}. Mientras tanto
      la portada se completa sola; elige otra y guarda para sustituirla.
    </div>
  );
}
