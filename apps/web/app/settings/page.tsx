'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArchiveNav } from '../components/ArchiveNav';
import { ProtectedSurface } from '../components/ProtectedSurface';
import {
  activeDriveConnection,
  ApiError,
  apiJson,
  settingsEndpoint,
  type Connection,
  type Source,
} from '../../lib/api';
import styles from './settings.module.css';

type Folder = { id: string; name: string; parents: string[] };
type SyncRun = {
  id: string;
  status: string;
  phase?: string;
  foundCount?: number;
  processedCount?: number;
  indexedCount?: number;
  issueCount?: number;
};
type SyncIssue = { id: string; message?: string; code?: string };

const errorCopy = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiError)) return fallback;
  const reference = error.requestId ? ` Referencia: ${error.requestId}.` : '';
  if (error.status === 429)
    return `Se alcanzó el límite temporal. Reintenta en ${error.retryAfterSeconds ?? 'unos'} segundos.${reference}`;
  return `${fallback}${reference}`;
};

export default function SettingsPage() {
  return (
    <ProtectedSurface>
      {(session) => (
        <>
          <ArchiveNav name={session.user.displayName} />
          <Settings sessionConnection={activeDriveConnection(session)} />
        </>
      )}
    </ProtectedSurface>
  );
}

function Settings({ sessionConnection }: { sessionConnection: Connection | null }) {
  const [connection, setConnection] = useState(sessionConnection);
  const [sources, setSources] = useState<Source[]>([]);
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const loadSources = async () =>
    setSources((await apiJson<{ items: Source[] }>('/photo-sources')).items);
  useEffect(() => {
    void loadSources().catch((error) =>
      setNotice(errorCopy(error, 'No se pudieron cargar las carpetas configuradas.')),
    );
  }, []);
  useEffect(() => {
    if (!run || ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)) return;
    const timer = window.setInterval(() => {
      void apiJson<SyncRun>(settingsEndpoint.run(run.id))
        .then(setRun)
        .catch((error) =>
          setNotice(errorCopy(error, 'No se pudo actualizar el estado del escaneo.')),
        );
    }, 2500);
    return () => window.clearInterval(timer);
  }, [run]);
  useEffect(() => {
    if (!run) return;
    void apiJson<{ items: SyncIssue[] }>(settingsEndpoint.issues(run.id))
      .then((page) => setIssues(page.items))
      .catch(() => setIssues([]));
  }, [run?.id, run?.status]);
  const browse = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !folderId.trim() || folderId === 'root')
      return setNotice('Indica una carpeta concreta. Nunca exploramos Drive completo.');
    setBusy(true);
    try {
      const page = await apiJson<{ items: Folder[] }>(
        settingsEndpoint.folderChildren(connection.id, folderId.trim()),
      );
      setFolders(page.items);
      setNotice('Carpeta validada. Puedes elegir una hija o usar esta carpeta.');
    } catch (error) {
      setNotice(errorCopy(error, 'No se pudo abrir esa carpeta de Drive.'));
    } finally {
      setBusy(false);
    }
  };
  const createSource = async () => {
    if (!connection || !folderId.trim() || folderId === 'root') return;
    setBusy(true);
    try {
      await apiJson<Source>(settingsEndpoint.createSource, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oauthConnectionId: connection.id,
          driveFolderId: folderId.trim(),
          name: 'Carpeta seleccionada',
          type: 'GENERIC',
        }),
      });
      await loadSources();
      setNotice('Carpeta guardada. Ya puedes solicitar el primer escaneo.');
    } catch (error) {
      setNotice(errorCopy(error, 'No fue posible guardar esa carpeta.'));
    } finally {
      setBusy(false);
    }
  };
  const sync = async (source: Source) => {
    setBusy(true);
    try {
      setRun(await apiJson<SyncRun>(settingsEndpoint.sync(source.id), { method: 'POST' }));
      setNotice('Escaneo encolado. El progreso se actualizará aquí.');
    } catch (error) {
      setNotice(errorCopy(error, 'No se pudo solicitar el escaneo. Inténtalo de nuevo.'));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await apiJson<void>(settingsEndpoint.disconnect(connection.id), {
        method: 'DELETE',
      });
      setConnection(null);
      setSources([]);
      setConfirmDisconnect(false);
      setNotice('La conexión se ha desconectado. Las fuentes han quedado inactivas.');
    } catch (error) {
      setNotice(
        errorCopy(error, 'No se pudo desconectar Drive. La conexión se mantiene sin cambios.'),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.settings}>
      <header className={styles.intro}>
        <p className={styles.routeLabel}>Conexiones y fuentes</p>
        <h1>Ajustes del archivo</h1>
        <p>
          Drive se usa solo para leer las carpetas que eliges. Nunca escribimos ni exploramos tu
          Drive completo.
        </p>
      </header>
      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>
      <section className={styles.connection} aria-labelledby="drive-title">
        <div>
          <h2 id="drive-title">Conexión con Google Drive</h2>
          <p>
            {connection
              ? 'Conectada y disponible para leer tus carpetas seleccionadas.'
              : 'No hay una conexión activa.'}
          </p>
        </div>
        <strong className={connection ? styles.connected : styles.disconnected}>
          {connection ? 'Conectada' : 'Sin conectar'}
        </strong>
        {connection && (
          <button
            data-cursor="action"
            className={styles.danger}
            onClick={() => setConfirmDisconnect(true)}
          >
            Desconectar Drive
          </button>
        )}
      </section>
      {confirmDisconnect && (
        <section
          className={styles.confirm}
          aria-labelledby="confirm-title"
          role="alertdialog"
          aria-modal="true"
        >
          <h2 id="confirm-title">¿Desconectar Drive?</h2>
          <p>
            Se revocará el acceso y las fuentes quedarán inactivas. Tus fotos indexadas no se
            eliminan.
          </p>
          <div>
            <button
              data-cursor="action"
              className={styles.danger}
              onClick={() => void disconnect()}
              disabled={busy}
            >
              Sí, desconectar
            </button>
            <button onClick={() => setConfirmDisconnect(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </section>
      )}
      {connection && (
        <section className={styles.folderSection} aria-labelledby="folder-title">
          <h2 id="folder-title">Carpeta de fotos</h2>
          <p>
            Introduce el ID de una carpeta de Drive para validarla. Después puedes seleccionar una
            de sus carpetas hijas; nunca listamos la raíz de Drive.
          </p>
          <form onSubmit={(event) => void browse(event)}>
            <label htmlFor="folder-id">ID de carpeta</label>
            <div>
              <input
                id="folder-id"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
                placeholder="ID de carpeta de Google Drive"
                required
              />
              <button data-cursor="action" type="submit" disabled={busy}>
                Validar carpeta
              </button>
            </div>
          </form>
          {folders.length > 0 && (
            <div className={styles.folderList} aria-label="Carpetas hijas disponibles">
              {folders.map((folder) => (
                <button data-cursor="action" key={folder.id} onClick={() => setFolderId(folder.id)}>
                  {folder.name}
                  <small>{folder.id === folderId ? 'Seleccionada' : 'Usar esta carpeta'}</small>
                </button>
              ))}
            </div>
          )}
          {folderId && (
            <button
              data-cursor="action"
              onClick={() => void createSource()}
              disabled={busy || sources.some((source) => source.status === 'ACTIVE')}
            >
              Guardar carpeta seleccionada
            </button>
          )}
        </section>
      )}
      <section className={styles.sourceSection} aria-labelledby="sources-title">
        <h2 id="sources-title">Fuentes seleccionadas</h2>
        {!sources.length ? (
          <p>No hay carpetas registradas todavía.</p>
        ) : (
          <ul className={styles.sources}>
            {sources.map((source) => (
              <li key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <span>
                    {source.status === 'ACTIVE' ? 'Activa' : 'Inactiva'} ·{' '}
                    {source.type === 'GOOGLE_TAKEOUT' ? 'Google Takeout' : 'Carpeta de Drive'}
                  </span>
                </div>
                {source.status === 'ACTIVE' && (
                  <button data-cursor="action" onClick={() => void sync(source)} disabled={busy}>
                    Actualizar archivo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {run && (
        <section className={styles.syncSection} aria-labelledby="sync-title">
          <h2 id="sync-title">Estado del escaneo</h2>
          <p className={styles.syncState}>
            {run.status}
            {run.phase ? ` · ${run.phase}` : ''}
          </p>
          <dl>
            <div>
              <dt>Encontradas</dt>
              <dd>{run.foundCount ?? 0}</dd>
            </div>
            <div>
              <dt>Procesadas</dt>
              <dd>{run.processedCount ?? 0}</dd>
            </div>
            <div>
              <dt>Indexadas</dt>
              <dd>{run.indexedCount ?? 0}</dd>
            </div>
            <div>
              <dt>Incidencias</dt>
              <dd>{run.issueCount ?? 0}</dd>
            </div>
          </dl>
          {issues.length > 0 && (
            <ul className={styles.issues}>
              {issues.map((issue) => (
                <li key={issue.id}>
                  {issue.code ? `${issue.code}: ` : ''}
                  {issue.message ?? 'Incidencia registrada durante el escaneo.'}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
