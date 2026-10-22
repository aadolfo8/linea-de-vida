'use client';

import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { activeDriveConnection, type Connection, type Session } from '../../lib/api';
import { sourcesApi } from '../../lib/sources/client';
import { startDriveConnection } from '../../lib/sources/connect';
import { apiErrorCopy } from '../../lib/sources/errors';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { AddPhotosWizard } from './AddPhotosWizard';
import { SourceCard } from './SourceCard';
import { useSources } from './use-sources';
import './ajustes.css';

const PROMISES = [
  ['Solo tú ves tu archivo', 'Cada cuenta tiene sus propias fotos.'],
  ['Solo las carpetas que eliges', 'Nunca recorremos el resto de tu Drive.'],
  ['Drive no se toca', 'Ocultar o poner fecha solo cambia Línea de vida.'],
] as const;

const oauthNotice = (value: string | null) =>
  value === 'drive-connected'
    ? ({ tone: 'ok', text: 'Drive conectado. Ya puedes añadir fotos.' } as const)
    : value === 'drive-denied'
      ? ({
          tone: 'error',
          text: 'No se concedió el acceso de solo lectura a Drive. Puedes intentarlo de nuevo cuando quieras.',
        } as const)
      : null;

/** Ajustes: where the photos come from, the account, and what we promise about privacy. */
export function AjustesScreen({
  session,
  pollMs,
}: {
  session: Session;
  /** How often a reading under way is checked; tests make it short. */
  pollMs?: number;
}) {
  const sources = useSources({ pollMs });
  const [connection, setConnection] = useState<Connection | null>(() =>
    activeDriveConnection(session),
  );
  const [wizard, setWizard] = useState(false);
  const [syncing, setSyncing] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);

  // Coming back from Google: say how it went, then tidy the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const found = oauthNotice(params.get('oauth'));
    if (!found) return;
    setNotice(found);
    params.delete('oauth');
    const rest = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  }, []);

  const sync = async (sourceId: string) => {
    setSyncing((current) => new Set(current).add(sourceId));
    const failure = await sources.startSync(sourceId);
    setSyncing((current) => {
      const next = new Set(current);
      next.delete(sourceId);
      return next;
    });
    setNotice(failure ? { tone: 'error', text: failure } : null);
  };

  const remove = async (sourceId: string) => {
    try {
      await sourcesApi.remove(sourceId);
      sources.remove(sourceId);
      notifyArchiveIndexUpdated();
      setNotice({ tone: 'ok', text: 'Fuente quitada. Tu Drive no ha cambiado.' });
      return null;
    } catch (error) {
      return apiErrorCopy(error, 'No se pudo quitar. Inténtalo de nuevo.');
    }
  };

  const connect = async () => {
    setAccountBusy(true);
    try {
      const result = await startDriveConnection();
      if (!result.ok) setNotice({ tone: 'error', text: result.message });
    } catch (error) {
      setNotice({
        tone: 'error',
        text: apiErrorCopy(error, 'No pudimos iniciar la conexión con Drive. Inténtalo de nuevo.'),
      });
    } finally {
      setAccountBusy(false);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    setAccountBusy(true);
    try {
      await sourcesApi.disconnect(connection.id);
      setConnection(null);
      setConfirmDisconnect(false);
      setNotice({
        tone: 'ok',
        text: 'Drive desconectado. Tus fotos ya ordenadas se conservan; no se buscarán fotos nuevas hasta que lo vuelvas a conectar.',
      });
      void sources.load();
    } catch (error) {
      setNotice({
        tone: 'error',
        text: apiErrorCopy(error, 'No se pudo desconectar Drive. Inténtalo de nuevo.'),
      });
    } finally {
      setAccountBusy(false);
    }
  };

  const signOut = async () => {
    setAccountBusy(true);
    try {
      await sourcesApi.signOut();
      window.location.replace('/');
    } catch {
      setNotice({
        tone: 'error',
        text: 'No se pudo cerrar la sesión. Comprueba tu conexión e inténtalo de nuevo.',
      });
      setAccountBusy(false);
    }
  };

  return (
    <SkyPage name={session.user.displayName} mainId="ajustes-main">
      <div className="sp-head">
        <div>
          <h1>Ajustes</h1>
          <p>
            De dónde vienen tus fotos y tu cuenta. Línea de vida solo lee las carpetas que eliges;
            nunca cambia nada en Drive.
          </p>
        </div>
      </div>
      <DriveBanner connected={connection !== null} />
      {notice && (
        <p
          className={notice.tone === 'error' ? 'sp-alert' : 'ajs-note'}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}

      <section className="ajs-section" aria-labelledby="ajs-sources">
        <h2 id="ajs-sources" className="sp-label">
          Tus fotos vienen de
        </h2>
        {sources.state === 'error' ? (
          <div role="alert" className="sp-alert">
            No se pudieron cargar tus fuentes de fotos.{' '}
            <button type="button" className="sp-btn" onClick={() => void sources.load()}>
              Reintentar
            </button>
          </div>
        ) : sources.state === 'loading' ? (
          <p className="ajs-muted">Cargando tus fuentes…</p>
        ) : (
          <div className="ajs-sources">
            {sources.views.map((view) => (
              <SourceCard
                key={view.source.id}
                view={view}
                syncing={syncing.has(view.source.id)}
                onSync={(id) => void sync(id)}
                onRemove={remove}
              />
            ))}
            <button
              type="button"
              className="ajs-card ajs-add"
              disabled={connection === null}
              onClick={() => setWizard(true)}
            >
              <span className="plus" aria-hidden="true">
                <Plus />
              </span>
              <b>Añadir fotos</b>
              <span className="ajs-muted">
                {connection === null
                  ? 'Conecta Drive primero para poder añadir fotos.'
                  : 'Una exportación de Google Fotos o una carpeta de Drive'}
              </span>
            </button>
          </div>
        )}
      </section>

      <section className="ajs-section" aria-labelledby="ajs-account">
        <h2 id="ajs-account" className="sp-label">
          Cuenta
        </h2>
        <div className="ajs-account">
          <div>
            <b>{session.user.displayName ?? 'Tu cuenta'}</b>
            <div className="ajs-muted">
              {session.user.email ? `${session.user.email} · ` : ''}
              {connection ? 'Google Drive conectado (solo lectura)' : 'Google Drive sin conectar'}
            </div>
          </div>
          <div className="row">
            {connection ? (
              !confirmDisconnect && (
                <button
                  type="button"
                  className="sp-btn"
                  disabled={accountBusy}
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Desconectar Drive
                </button>
              )
            ) : (
              <button
                type="button"
                className="sp-btn primary"
                disabled={accountBusy}
                onClick={() => void connect()}
              >
                Conectar Drive
              </button>
            )}
            <button
              type="button"
              className="sp-btn ghost"
              disabled={accountBusy}
              onClick={() => void signOut()}
            >
              Cerrar sesión
            </button>
          </div>
          {connection && confirmDisconnect && (
            <div className="ajs-confirm" role="alertdialog" aria-label="Desconectar Drive">
              <p>
                ¿Desconectar Drive? Dejaremos de poder leer tus carpetas y de buscar fotos nuevas.
                Lo que ya está en Línea de vida se conserva, y tu Drive no cambia.
              </p>
              <div className="row">
                <button
                  type="button"
                  className="sp-btn danger"
                  disabled={accountBusy}
                  onClick={() => void disconnect()}
                >
                  Sí, desconectar
                </button>
                <button
                  type="button"
                  className="sp-btn ghost"
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="ajs-section" aria-labelledby="ajs-privacy">
        <h2 id="ajs-privacy" className="sp-label">
          Tu privacidad
        </h2>
        <div className="ajs-promises">
          {PROMISES.map(([title, text]) => (
            <div key={title}>
              <b>{title}</b>
              {text}
            </div>
          ))}
        </div>
      </section>

      {wizard && connection && (
        <AddPhotosWizard
          connectionId={connection.id}
          views={sources.views}
          onAdded={sources.add}
          onClose={() => setWizard(false)}
        />
      )}
    </SkyPage>
  );
}
