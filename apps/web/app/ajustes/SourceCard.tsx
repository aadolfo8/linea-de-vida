'use client';

import { FolderOpen, Images } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { describeSource } from '../../lib/sources/sync';
import { SOURCE_KIND } from '../../lib/sources/takeout';
import type { SourceView } from './use-sources';

const CONFIRM_MS = 6000;

/** One place the photos come from: its state, its numbers, and what can be done with it. */
export function SourceCard({
  view,
  syncing,
  onSync,
  onRemove,
}: {
  view: SourceView;
  /** A request to start a reading is in flight. */
  syncing: boolean;
  onSync: (sourceId: string) => void;
  onRemove: (sourceId: string) => Promise<string | null>;
}) {
  const { source, run, counts } = view;
  const kind = SOURCE_KIND[source.type] ?? SOURCE_KIND.GENERIC;
  const state = describeSource({ status: source.status, run });
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const busy = state.tone === 'busy' || syncing;
  const Icon = source.type === 'GOOGLE_TAKEOUT' ? Images : FolderOpen;

  const remove = async () => {
    if (!confirming) {
      setConfirming(true);
      setError('');
      timer.current = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
      return;
    }
    window.clearTimeout(timer.current);
    setRemoving(true);
    const failure = await onRemove(source.id);
    // On success the card disappears; only a failure leaves something to say.
    if (failure) {
      setError(failure);
      setConfirming(false);
      setRemoving(false);
    }
  };

  return (
    <article className="ajs-card" aria-label={source.name}>
      <div className="top">
        <span className="ic" aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h3>{source.name}</h3>
          <div className="kind">{kind.detail}</div>
        </div>
      </div>

      <div className={`state ${state.tone}`}>
        <span>{state.label}</span>
      </div>
      {state.progress && (
        <div
          className="ajs-bar"
          role="progressbar"
          aria-label={`Lectura de ${source.name}`}
          aria-valuemin={0}
          aria-valuemax={state.progress.total}
          aria-valuenow={state.progress.done}
        >
          <i style={{ width: `${(state.progress.done / state.progress.total) * 100}%` }} />
        </div>
      )}

      {counts ? (
        <dl className="nums">
          <div>
            <dd>{counts.total.toLocaleString('es-ES')}</dd>
            <dt>fotos</dt>
          </div>
          <div>
            <dd>{counts.toDate.toLocaleString('es-ES')}</dd>
            <dt>por fechar</dt>
          </div>
          <div>
            <dd>{counts.hidden.toLocaleString('es-ES')}</dd>
            <dt>ocultas</dt>
          </div>
        </dl>
      ) : (
        <p className="ajs-muted">Contando fotos…</p>
      )}

      {confirming && (
        <p className="ajs-muted" role="status">
          Se quitan de Línea de vida las fotos de esta fuente y las fechas que les pusiste. Tu Drive
          no cambia: puedes volver a añadirla cuando quieras.
        </p>
      )}
      {error && (
        <p className="sp-alert" role="alert">
          {error}
        </p>
      )}

      <div className="row">
        {counts && counts.toDate > 0 && (
          <Link
            className="sp-btn primary"
            href={`/ordenar?source=${encodeURIComponent(source.id)}`}
          >
            Ordenar {counts.toDate.toLocaleString('es-ES')}
          </Link>
        )}
        <button
          type="button"
          className="sp-btn"
          disabled={busy || source.status !== 'ACTIVE'}
          onClick={() => onSync(source.id)}
        >
          {state.failed ? 'Reintentar' : 'Buscar fotos nuevas'}
        </button>
        <button
          type="button"
          className={`sp-btn ${confirming ? 'danger' : 'ghost'}`}
          disabled={removing || state.tone === 'busy'}
          onClick={() => void remove()}
        >
          {confirming ? '¿Seguro? Pulsa otra vez' : 'Quitar'}
        </button>
      </div>
    </article>
  );
}
