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

type DriveFolder = { id: string; name: string; parents: string[] };
type SyncRun = {
  id: string;
  status: string;
  phase?: string;
  foundCount?: number;
  processedCount?: number;
  indexedCount?: number;
  issueCount?: number;
  createdAt?: string;
};
type SyncIssue = { id: string; details?: string; code?: string };

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
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const activeSource = sources.find((source) => source.status === 'ACTIVE') ?? null;

  const loadSources = async () =>
    setSources((await apiJson<{ items: Source[] }>('/photo-sources')).items);
  const loadHistory = async (sourceId: string) => {
    setHistory((await apiJson<{ items: SyncRun[] }>(settingsEndpoint.history(sourceId))).items);
  };
  useEffect(() => {
    void loadSources().catch((error) =>
      setNotice(errorCopy(error, 'No se pudieron cargar las fuentes configuradas.')),
    );
  }, []);
  useEffect(() => {
    if (!activeSource) {
      setHistory([]);
      return;
    }
    void loadHistory(activeSource.id).catch((error) =>
      setNotice(errorCopy(error, 'No se pudo cargar el historial del archivo.')),
    );
  }, [activeSource?.id]);
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
    if (['SUCCEEDED', 'PARTIAL'].includes(run.status) && activeSource)
      void loadHistory(activeSource.id);
  }, [run?.id, run?.status]);

  const browse = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !folderId.trim() || folderId === 'root')
      return setNotice('Indica una carpeta concreta. Nunca exploramos Drive completo.');
    setBusy(true);
    try {
      const page = await apiJson<{ items: DriveFolder[] }>(
        settingsEndpoint.folderChildren(connection.id, folderId.trim()),
      );
      setDriveFolders(page.items);
      setNotice('Carpeta validada. Puedes usarla como fuente o abrir una carpeta hija.');
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
      setNotice('Fuente guardada. Inicia el escaneo para construir el archivo indexado.');
    } catch (error) {
      setNotice(errorCopy(error, 'No fue posible guardar esa carpeta.'));
    } finally {
      setBusy(false);
    }
  };
  const sync = async (source: Source) => {
    setBusy(true);
    try {
      const nextRun = await apiJson<SyncRun>(settingsEndpoint.sync(source.id), { method: 'POST' });
      setRun(nextRun);
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
      await apiJson<void>(settingsEndpoint.disconnect(connection.id), { method: 'DELETE' });
      setConnection(null);
      setSources([]);
      setConfirmDisconnect(false);
      setNotice('Drive se ha desconectado. El archivo indexado permanece sin acceso al original.');
    } catch (error) {
      setNotice(errorCopy(error, 'No se pudo desconectar Drive.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.settings}>
      <header className={styles.intro}>
        <h1>Ajustes del archivo</h1>
        <p>
          Drive se usa solo para leer la carpeta que eliges. Quitar una foto aquí nunca la elimina
          de Drive.
        </p>
      </header>
      <p className={styles.notice} role="status" aria-live="polite">
        {notice}
      </p>

      <section className={styles.connection} aria-labelledby="drive-title">
        <div>
          <h2 id="drive-title">Selección en Google Drive</h2>
          <p>
            Conexión en vivo para validar una fuente. Esta zona no representa todavía el archivo
            indexado.
          </p>
        </div>
        <strong className={connection ? styles.connected : styles.disconnected}>
          {connection ? 'Conectada' : 'Sin conectar'}
        </strong>
        {connection && (
          <button className={styles.danger} onClick={() => setConfirmDisconnect(true)}>
            Desconectar Drive
          </button>
        )}
      </section>
      {confirmDisconnect && (
        <section
          className={styles.confirm}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="disconnect-title"
        >
          <h2 id="disconnect-title">¿Desconectar Drive?</h2>
          <p>
            Se revocará el acceso de lectura. El archivo indexado permanecerá, pero no podrá cargar
            originales.
          </p>
          <div>
            <button className={styles.danger} onClick={() => void disconnect()} disabled={busy}>
              Sí, desconectar
            </button>
            <button onClick={() => setConfirmDisconnect(false)} disabled={busy}>
              Cancelar
            </button>
          </div>
        </section>
      )}
      {connection && (
        <section aria-labelledby="source-picker-title">
          <h2 id="source-picker-title">Configurar fuente</h2>
          <p>Introduce el ID de una carpeta concreta. Nunca se lista la raíz completa de Drive.</p>
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
              <button type="submit" disabled={busy}>
                Validar carpeta
              </button>
            </div>
          </form>
          {!!driveFolders.length && (
            <div className={styles.folderList} aria-label="Carpetas hijas disponibles">
              {driveFolders.map((folder) => (
                <button key={folder.id} onClick={() => setFolderId(folder.id)}>
                  {folder.name}
                  <small>Abrir o usar esta carpeta</small>
                </button>
              ))}
            </div>
          )}
          {folderId && (
            <button onClick={() => void createSource()} disabled={busy || Boolean(activeSource)}>
              Guardar como fuente
            </button>
          )}
        </section>
      )}

      <section aria-labelledby="archive-title" className={styles.archiveSection}>
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="archive-title">Archivo indexado</h2>
            <p>
              Jerarquía guardada durante el último escaneo correcto. Las rutas desconocidas no se
              inventan.
            </p>
          </div>
          {activeSource && (
            <button onClick={() => void sync(activeSource)} disabled={busy}>
              Actualizar archivo
            </button>
          )}
        </div>
        {!activeSource ? (
          <p>No hay una fuente activa configurada.</p>
        ) : (
          <p className={styles.sourceIdentity}>
            <strong>{activeSource.name}</strong>
            <span>
              ID de carpeta: {activeSource.driveFolderId} ·{' '}
              {activeSource.status === 'ACTIVE' ? 'Activa' : 'Inactiva'}
            </span>
          </p>
        )}
        {activeSource && (
          <p>
            La navegación de la jerarquía indexada se incorpora en el siguiente PR de la cadena.
          </p>
        )}
      </section>

      {(run || history.length > 0) && (
        <section aria-labelledby="sync-title">
          <h2 id="sync-title">Escaneos</h2>
          {run && (
            <>
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
            </>
          )}
          {!!issues.length && (
            <ul className={styles.issues}>
              {issues.map((issue) => (
                <li key={issue.id}>
                  {issue.code ? `${issue.code}: ` : ''}
                  {issue.details ?? 'Incidencia registrada durante el escaneo.'}
                </li>
              ))}
            </ul>
          )}
          {!!history.length && (
            <ul className={styles.history}>
              {history.map((item) => (
                <li key={item.id}>
                  <strong>{item.status}</strong>
                  <span>
                    {item.createdAt
                      ? new Intl.DateTimeFormat('es').format(new Date(item.createdAt))
                      : item.id}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
