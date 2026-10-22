'use client';

import { FolderOpen, Images } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState } from 'react';
import type { Source } from '../../lib/api';
import { driveFolderIdFromInput } from '../../lib/drive-folder';
import { sourcesApi, type DriveChild } from '../../lib/sources/client';
import { apiErrorCopy } from '../../lib/sources/errors';
import { describeSource, type SyncRun } from '../../lib/sources/sync';
import { SOURCE_KIND, looksLikeTakeout, type SourceType } from '../../lib/sources/takeout';
import { useDialog } from '../components/use-dialog';
import type { SourceView } from './use-sources';

type Step = 'kind' | 'link' | 'done';
type Checked = { folderId: string; children: DriveChild[]; more: boolean };

const SHOWN_CHILDREN = 8;

/**
 * "Añadir fotos" in two steps (what is it, which folder) and a third that says what happens
 * next. The folder is pasted as a link and checked on our side before anything is saved.
 */
export function AddPhotosWizard({
  connectionId,
  views,
  onAdded,
  onClose,
}: {
  connectionId: string;
  /** The live state of the sources, so the last step can show the first reading's progress. */
  views: readonly SourceView[];
  onAdded: (source: Source, run: SyncRun | null) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(dialogRef, onClose);
  const [step, setStep] = useState<Step>('kind');
  const [kind, setKind] = useState<SourceType>('GOOGLE_TAKEOUT');
  const [link, setLink] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ source: Source; syncError: string | null } | null>(null);

  const effectiveName = nameTouched ? name : SOURCE_KIND[kind].defaultName;
  const takeoutHint =
    checked !== null &&
    kind === 'GENERIC' &&
    looksLikeTakeout(
      null,
      checked.children.map((child) => child.name),
    );

  const choose = (next: SourceType) => {
    setKind(next);
    setStep('link');
  };

  const check = async () => {
    const folderId = driveFolderIdFromInput(link);
    setError('');
    if (!folderId || folderId === 'root') {
      setError(
        'Pega el enlace de una carpeta concreta de tu Drive. Nunca recorremos todo tu Drive.',
      );
      return;
    }
    setChecking(true);
    try {
      const page = await sourcesApi.children(connectionId, folderId);
      setChecked({ folderId, children: page.items, more: Boolean(page.nextCursor) });
    } catch (failure) {
      setChecked(null);
      setError(
        apiErrorCopy(
          failure,
          'No pudimos abrir esa carpeta. Comprueba el enlace y que tu cuenta tenga acceso.',
        ),
      );
    } finally {
      setChecking(false);
    }
  };

  const add = async () => {
    if (!checked || adding) return;
    setAdding(true);
    setError('');
    try {
      const source = await sourcesApi.create({
        oauthConnectionId: connectionId,
        driveFolderId: checked.folderId,
        name: effectiveName.trim() || SOURCE_KIND[kind].defaultName,
        type: kind,
      });
      let run: SyncRun | null = null;
      let syncError: string | null = null;
      try {
        run = await sourcesApi.startSync(source.id);
      } catch (failure) {
        syncError = apiErrorCopy(failure, '');
      }
      onAdded(source, run);
      setCreated({ source, syncError });
      setStep('done');
    } catch (failure) {
      setError(
        apiErrorCopy(
          failure,
          'No pudimos añadir esa carpeta. Tus fotos siguen intactas; inténtalo de nuevo.',
        ),
      );
    } finally {
      setAdding(false);
    }
  };

  const view = created ? views.find((item) => item.source.id === created.source.id) : undefined;
  const state = view ? describeSource({ status: view.source.status, run: view.run }) : null;
  const stepNumber = step === 'kind' ? 1 : step === 'link' ? 2 : 3;

  return (
    <div
      className="sp-scrim"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="sp-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="ajs-steps" role="img" aria-label={`Paso ${stepNumber} de 3`}>
          <i className={stepNumber >= 1 ? 'on' : ''} />
          <i className={stepNumber >= 2 ? 'on' : ''} />
          <i className={stepNumber >= 3 ? 'on' : ''} />
        </div>

        {step === 'kind' && (
          <>
            <h2 id={titleId}>Añadir fotos</h2>
            <p className="sub">¿De dónde vienen?</p>
            <div className="ajs-choices">
              <button
                type="button"
                className="ajs-choice"
                data-autofocus
                onClick={() => choose('GOOGLE_TAKEOUT')}
              >
                <Images aria-hidden="true" />
                <b>{SOURCE_KIND.GOOGLE_TAKEOUT.label}</b>
                <span>
                  Descargas tus fotos con Google Takeout, las descomprimes en una carpeta de tu
                  Drive y las traemos de allí. Se ordenan solas por su fecha.
                </span>
              </button>
              <button type="button" className="ajs-choice" onClick={() => choose('GENERIC')}>
                <FolderOpen aria-hidden="true" />
                <b>Una carpeta de Drive</b>
                <span>
                  Cualquier carpeta con fotos. Las que no traigan fecha irán al montón «Sin fecha»
                  para que las ordenes.
                </span>
              </button>
            </div>
            <div className="sp-foot">
              <button type="button" className="sp-btn ghost" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </>
        )}

        {step === 'link' && (
          <>
            <h2 id={titleId}>Elige la carpeta</h2>
            {kind === 'GOOGLE_TAKEOUT' ? (
              <ol className="ajs-howto">
                <li>
                  Pide tu exportación en <b>takeout.google.com</b> (solo «Google Fotos»).
                </li>
                <li>Descomprímela en una carpeta de tu Drive.</li>
                <li>Pega aquí el enlace de esa carpeta.</li>
              </ol>
            ) : (
              <p className="sub">
                Abre la carpeta en Drive, copia su enlace y pégalo aquí. Línea de vida solo verá esa
                carpeta y lo que tenga dentro.
              </p>
            )}
            {kind === 'GOOGLE_TAKEOUT' && (
              <p className="sub">
                Si más adelante haces otra exportación y la dejas en la misma carpeta, solo se
                añaden las fotos nuevas: no se duplica nada.
              </p>
            )}
            <label className="sp-label" htmlFor={`${titleId}-link`}>
              Enlace de la carpeta
            </label>
            <div className="ajs-linkrow">
              <input
                id={`${titleId}-link`}
                data-autofocus
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://drive.google.com/drive/folders/…"
                value={link}
                onChange={(event) => {
                  setLink(event.target.value);
                  setChecked(null);
                  setError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void check();
                  }
                }}
              />
              <button
                type="button"
                className="sp-btn"
                disabled={checking || !link.trim()}
                onClick={() => void check()}
              >
                {checking ? 'Comprobando…' : 'Comprobar'}
              </button>
            </div>

            {error && (
              <p role="alert" className="sp-alert">
                {error}
              </p>
            )}

            {checked && (
              <div className="ajs-found" role="status">
                <b>Carpeta encontrada.</b>
                {checked.children.length > 0 ? (
                  <>
                    <span> Dentro hay estas subcarpetas:</span>
                    <ul>
                      {checked.children.slice(0, SHOWN_CHILDREN).map((child) => (
                        <li key={child.id}>{child.name}</li>
                      ))}
                    </ul>
                    {(checked.children.length > SHOWN_CHILDREN || checked.more) && (
                      <span className="ajs-muted">
                        {checked.more
                          ? 'y más…'
                          : `y ${checked.children.length - SHOWN_CHILDREN} más`}
                      </span>
                    )}
                  </>
                ) : (
                  <span> No tiene subcarpetas; las fotos de dentro se leerán igualmente.</span>
                )}
                {takeoutHint && (
                  <div className="sp-banner">
                    <div className="text">
                      <b>Parece una exportación de Google Fotos.</b>
                      <small>
                        Si lo es, se ordena sola por la fecha que Google guardó en cada foto.
                      </small>
                    </div>
                    <button
                      type="button"
                      className="sp-btn"
                      onClick={() => setKind('GOOGLE_TAKEOUT')}
                    >
                      Sí, es de Google Fotos
                    </button>
                  </div>
                )}
                <label className="sp-label" htmlFor={`${titleId}-name`}>
                  Nombre
                </label>
                <input
                  id={`${titleId}-name`}
                  className="ajs-name"
                  maxLength={200}
                  value={effectiveName}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNameTouched(true);
                  }}
                />
                <span className="ajs-muted">Es solo para ti: Drive no lo ve.</span>
              </div>
            )}

            <div className="sp-foot">
              <button
                type="button"
                className="sp-btn ghost"
                onClick={() => {
                  setStep('kind');
                  setError('');
                }}
              >
                Atrás
              </button>
              <button
                type="button"
                className="sp-btn primary"
                disabled={!checked || adding || !effectiveName.trim()}
                onClick={() => void add()}
              >
                {adding ? 'Añadiendo…' : 'Añadir'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && created && (
          <>
            <h2 id={titleId}>«{created.source.name}» añadida</h2>
            <p className="sub">
              {kind === 'GOOGLE_TAKEOUT'
                ? 'Es una exportación de Google Fotos: estamos leyendo sus fotos y las colocaremos en la cronología por su fecha.'
                : 'Estamos leyendo sus fotos. Las que traigan fecha irán solas a la cronología y el resto aparecerán en Ordenar → Sin fecha.'}{' '}
              Puedes cerrar esto: la lectura sigue y verás el avance en su tarjeta.
            </p>
            {created.syncError !== null ? (
              <p role="alert" className="sp-alert">
                La carpeta se añadió, pero no pudimos empezar a leerla. {created.syncError} Pulsa
                «Buscar fotos nuevas» en su tarjeta para intentarlo de nuevo.
              </p>
            ) : (
              state && (
                <div className={`state ajs-progress ${state.tone}`} role="status">
                  <span>{state.label}</span>
                  {state.progress && (
                    <div
                      className="ajs-bar"
                      role="progressbar"
                      aria-label="Progreso de la primera lectura"
                      aria-valuemin={0}
                      aria-valuemax={state.progress.total}
                      aria-valuenow={state.progress.done}
                    >
                      <i
                        style={{ width: `${(state.progress.done / state.progress.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            )}
            <div className="sp-foot">
              {view?.counts && view.counts.toDate > 0 && (
                <Link
                  className="sp-btn"
                  href={`/ordenar?source=${encodeURIComponent(created.source.id)}`}
                >
                  Ordenar {view.counts.toDate.toLocaleString('es-ES')}
                </Link>
              )}
              <button type="button" className="sp-btn primary" data-autofocus onClick={onClose}>
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
