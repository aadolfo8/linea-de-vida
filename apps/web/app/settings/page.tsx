'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArchiveNav } from '../components/ArchiveNav';
import { ProtectedSurface } from '../components/ProtectedSurface';
import {
  activeDriveConnection,
  api,
  ApiError,
  apiJson,
  settingsEndpoint,
  type Connection,
  type Source,
} from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import styles from './settings.module.css';

type DriveFolder = { id: string; name: string; parents: string[] };
type IndexedFolder = {
  id: string;
  name: string;
  path: string[];
  status: 'ACTIVE' | 'MISSING';
  photoCount: number;
};
type IndexedPhoto = {
  id: string;
  fileName: string;
  thumbnailUrl: string;
  effectiveDate: { precision: string };
};
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
  const [folders, setFolders] = useState<IndexedFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<IndexedPhoto[]>([]);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [dateYear, setDateYear] = useState('');
  const [dateMonth, setDateMonth] = useState('');
  const [confirmDate, setConfirmDate] = useState(false);
  const activeSource = sources.find((source) => source.status === 'ACTIVE') ?? null;
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const descendantCount = useMemo(
    () =>
      selectedFolder
        ? folders.filter(
            (folder) =>
              folder.path.length >= selectedFolder.path.length &&
              selectedFolder.path.every((segment, index) => folder.path[index] === segment),
          ).length
        : 0,
    [folders, selectedFolder],
  );

  const loadSources = async () =>
    setSources((await apiJson<{ items: Source[] }>('/photo-sources')).items);
  const loadArchive = async (sourceId: string) => {
    const all: IndexedFolder[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: IndexedFolder[]; nextCursor: string | null } = await apiJson(
        settingsEndpoint.indexedFolders(sourceId, cursor ?? undefined),
      );
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    setFolders(all);
    setHistory((await apiJson<{ items: SyncRun[] }>(settingsEndpoint.history(sourceId))).items);
    if (!selectedFolderId && all.length) setSelectedFolderId(all[0].id);
  };
  const loadPhotos = async (folderIdValue: string, cursor?: string, append = false) => {
    const page = await apiJson<{ items: IndexedPhoto[]; nextCursor: string | null }>(
      settingsEndpoint.folderPhotos(folderIdValue, cursor),
    );
    setPhotos((current) => (append ? [...current, ...page.items] : page.items));
    setPhotoCursor(page.nextCursor);
    if (!append) setSelectedPhotos(new Set());
  };

  useEffect(() => {
    void loadSources().catch((error) =>
      setNotice(errorCopy(error, 'No se pudieron cargar las fuentes configuradas.')),
    );
  }, []);
  useEffect(() => {
    if (!activeSource) {
      setFolders([]);
      setHistory([]);
      return;
    }
    void loadArchive(activeSource.id).catch((error) =>
      setNotice(errorCopy(error, 'No se pudo cargar el archivo indexado.')),
    );
  }, [activeSource?.id]);
  useEffect(() => {
    if (!selectedFolderId) {
      setPhotos([]);
      return;
    }
    void loadPhotos(selectedFolderId).catch((error) =>
      setNotice(errorCopy(error, 'No se pudieron cargar las fotos de esta carpeta.')),
    );
  }, [selectedFolderId]);
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
      void loadArchive(activeSource.id);
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
  const removeSelected = async () => {
    if (
      !selectedPhotos.size ||
      !window.confirm(
        `¿Quitar ${selectedPhotos.size} fotos de este archivo? No se eliminarán de Drive.`,
      )
    )
      return;
    setBusy(true);
    try {
      for (const photoId of selectedPhotos)
        await apiJson<void>(settingsEndpoint.photo(photoId), { method: 'DELETE' });
      if (selectedFolderId) await loadPhotos(selectedFolderId);
      if (activeSource) await loadArchive(activeSource.id);
      setNotice(`${selectedPhotos.size} fotos se quitaron de este archivo. Drive no se modificó.`);
      setSelectedPhotos(new Set());
    } catch (error) {
      setNotice(errorCopy(error, 'No se pudieron quitar todas las fotos seleccionadas.'));
    } finally {
      setBusy(false);
    }
  };
  const applyFolderDate = async () => {
    if (!selectedFolder) return;
    const precision = dateMonth ? 'MONTH' : 'YEAR';
    setBusy(true);
    try {
      const result = await apiJson<{ affectedCount: number }>(
        settingsEndpoint.folderDate(selectedFolder.id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: Number(dateYear),
            ...(dateMonth ? { month: Number(dateMonth) } : {}),
            precision,
            recursive: true,
            reason: 'Edición recursiva desde la carpeta indexada',
          }),
        },
      );
      setConfirmDate(false);
      setNotice(`Fecha aplicada a ${result.affectedCount} fotos de la carpeta y sus subcarpetas.`);
      await loadPhotos(selectedFolder.id);
    } catch (error) {
      setNotice(errorCopy(error, 'No se pudo aplicar la fecha. Revisa el año y el mes.'));
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
        {activeSource && !folders.length && (
          <p>
            Aún no hay carpetas indexadas. Ejecuta un escaneo correcto para construir la jerarquía.
          </p>
        )}
        {!!folders.length && (
          <div className={styles.archiveLayout}>
            <nav className={styles.tree} aria-label="Jerarquía de carpetas indexadas">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  className={folder.id === selectedFolderId ? styles.currentFolder : ''}
                  onClick={() => setSelectedFolderId(folder.id)}
                  style={{
                    paddingInlineStart: `${12 + Math.max(0, folder.path.length - 1) * 16}px`,
                  }}
                >
                  <span>{folder.name}</span>
                  <small>
                    {folder.status === 'MISSING' ? 'No encontrada' : `${folder.photoCount} fotos`}
                  </small>
                </button>
              ))}
            </nav>
            <div className={styles.folderContents}>
              {selectedFolder && (
                <>
                  <nav className={styles.breadcrumb} aria-label="Ruta de la carpeta">
                    {selectedFolder.path.map((segment, index) => (
                      <span key={`${segment}-${index}`}>{segment}</span>
                    ))}
                  </nav>
                  <div className={styles.folderSummary}>
                    <h3>{selectedFolder.name}</h3>
                    <span>
                      {selectedFolder.status === 'MISSING'
                        ? 'Carpeta no encontrada en el último escaneo correcto'
                        : 'Carpeta activa'}
                    </span>
                  </div>
                </>
              )}
              {!photos.length ? (
                <p>Esta carpeta no contiene fotos activas indexadas.</p>
              ) : (
                <div className={styles.photoGrid}>
                  {photos.map((photo) => (
                    <label
                      key={photo.id}
                      className={selectedPhotos.has(photo.id) ? styles.selectedPhoto : ''}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPhotos.has(photo.id)}
                        onChange={() =>
                          setSelectedPhotos((current) => {
                            const next = new Set(current);
                            if (next.has(photo.id)) next.delete(photo.id);
                            else next.add(photo.id);
                            return next;
                          })
                        }
                      />
                      <img src={mediaUrl(api, photo.thumbnailUrl)} alt="" loading="lazy" />
                      <span>{photo.fileName}</span>
                      <small>{photo.effectiveDate.precision}</small>
                    </label>
                  ))}
                </div>
              )}
              <div className={styles.photoActions}>
                <button
                  className={styles.danger}
                  onClick={() => void removeSelected()}
                  disabled={busy || !selectedPhotos.size}
                >
                  Quitar seleccionadas del archivo
                </button>
                {photoCursor && selectedFolderId && (
                  <button
                    onClick={() => void loadPhotos(selectedFolderId, photoCursor, true)}
                    disabled={busy}
                  >
                    Cargar más fotos
                  </button>
                )}
              </div>
              {selectedFolder && (
                <div className={styles.dateEditor}>
                  <h3>Fecha para carpeta y subcarpetas</h3>
                  <p>
                    La decisión afecta esta carpeta y sus {Math.max(0, descendantCount - 1)}{' '}
                    subcarpetas activas. Los valores se guardan como ajustes manuales y se conservan
                    en futuros escaneos.
                  </p>
                  <div>
                    <label>
                      Año
                      <input
                        inputMode="numeric"
                        value={dateYear}
                        onChange={(event) => setDateYear(event.target.value)}
                        placeholder="2024"
                      />
                    </label>
                    <label>
                      Mes opcional
                      <select
                        value={dateMonth}
                        onChange={(event) => setDateMonth(event.target.value)}
                      >
                        <option value="">Solo año</option>
                        {Array.from({ length: 12 }, (_, index) => (
                          <option key={index + 1} value={index + 1}>
                            {index + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button onClick={() => setConfirmDate(true)} disabled={busy || !dateYear}>
                      Revisar cambio
                    </button>
                  </div>
                </div>
              )}
              {confirmDate && selectedFolder && (
                <div
                  className={styles.inlineConfirm}
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="date-confirm-title"
                >
                  <h3 id="date-confirm-title">Confirmar edición recursiva</h3>
                  <p>
                    Se aplicará {dateMonth ? `el mes ${dateMonth} de ` : 'el año '}
                    {dateYear} a todas las fotos activas de “{selectedFolder.name}” y todas sus
                    subcarpetas.
                  </p>
                  <div>
                    <button onClick={() => void applyFolderDate()} disabled={busy}>
                      Confirmar y aplicar
                    </button>
                    <button onClick={() => setConfirmDate(false)} disabled={busy}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
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
