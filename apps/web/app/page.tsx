'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../lib/media';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const monthName = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' });

type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';
type DateOrigin = 'MANUAL' | 'EXIF' | 'DRIVE_IMAGE_METADATA' | 'FOLDER' | 'NONE';
type Connection = { id: string; provider: string; status: string };
type Source = {
  id: string;
  name: string;
  driveFolderId: string;
  type: 'GENERIC' | 'GOOGLE_TAKEOUT';
};
type Folder = { id: string; name: string; parents: string[] };
type Photo = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  effectiveDate: { value: string | null; precision: Precision; origin: DateOrigin };
  detectedDate: string | null;
  detectedPrecision: Precision;
  detectedSource: Exclude<DateOrigin, 'MANUAL'>;
  manualDateOverride: { dateValue: string; precision: Precision } | null;
  period: { year: number | null; month: number | null; key: string };
};
type FeedPage = { items: Photo[]; nextCursor: string | null };

function periodLabel(photo: Photo) {
  if (photo.period.year === null) return 'Sin fecha conocida';
  if (photo.period.month === null) return `${photo.period.year} · mes sin concretar`;
  return `${monthName.format(new Date(Date.UTC(2024, photo.period.month - 1)))} de ${photo.period.year}`;
}

function precisionLabel(precision: Precision) {
  return { DAY: 'Día conocido', MONTH: 'Mes conocido', YEAR: 'Solo año', UNKNOWN: 'Sin fecha' }[
    precision
  ];
}

function Thumbnail({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const unsupported = /^image\/(heic|heif)$/i.test(photo.mimeType);
  if (unsupported)
    return (
      <div className="photo-card unsupported">
        <span aria-hidden="true">↗</span>
        <strong>Formato no visible aquí</strong>
        <small>La foto sigue indexada. Ábrela para descargar el original.</small>
        <button onClick={onOpen}>Ver detalles</button>
      </div>
    );
  if (state === 'error')
    return (
      <div className="photo-card">
        <span className="photo-frame error">
          <span className="thumbnail-error">
            <span>Miniatura no disponible</span>
            <button
              className="quiet"
              onClick={() => {
                setState('loading');
                setAttempt((value) => value + 1);
              }}
            >
              Reintentar
            </button>
          </span>
        </span>
        <button className="quiet detail-link" onClick={onOpen}>
          Ver detalles de {photo.fileName}
        </button>
      </div>
    );
  return (
    <button className="photo-card" onClick={onOpen} aria-label={`Abrir ${photo.fileName}`}>
      <span className={`photo-frame ${state}`}>
        {state === 'loading' && (
          <span className="thumbnail-loading" aria-label="Cargando miniatura" />
        )}
        <img
          key={attempt}
          src={mediaUrl(api, photo.thumbnailUrl)}
          alt=""
          loading="lazy"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
      </span>
      <span className="photo-caption">
        <strong>{photo.fileName}</strong>
        <small>{precisionLabel(photo.effectiveDate.precision)}</small>
      </span>
    </button>
  );
}

export default function Home() {
  const [notice, setNotice] = useState('Comprobando la sesión y el archivo…');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [configured, setConfigured] = useState(false);
  const [developmentAvailable, setDevelopmentAvailable] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [feed, setFeed] = useState<Photo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [manualYear, setManualYear] = useState('');
  const [manualMonth, setManualMonth] = useState('');
  const [manualDay, setManualDay] = useState('');
  const [failedContent, setFailedContent] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const call = (path: string, init?: RequestInit) =>
    fetch(`${api}${path}`, { credentials: 'include', ...init });
  const fetchJson = async <T,>(path: string) => {
    const response = await call(path);
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    return (await response.json()) as T;
  };
  const loadFeed = async (next: string | null, replace = false) => {
    if (loadingFeed || (!replace && next === null && feed.length)) return;
    setLoadingFeed(true);
    setFeedError(false);
    try {
      const page = await fetchJson<FeedPage>(
        `/timeline/feed?limit=24${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
      );
      setFeed((current) => {
        const known = new Set(replace ? [] : current.map((photo) => photo.id));
        return [...(replace ? [] : current), ...page.items.filter((photo) => !known.has(photo.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setFeedError(true);
      setNotice('No se pudo cargar este tramo de la línea de vida. Puedes reintentarlo.');
    } finally {
      setLoadingFeed(false);
    }
  };
  const refresh = async () => {
    const response = await call('/me');
    if (!response.ok) {
      setNotice('No hay una sesión activa. Continúa con Google.');
      return;
    }
    const data = await response.json();
    setConfigured(data.driveConfigured);
    setConnection(
      data.user.connections?.find((item: Connection) => item.provider === 'google-drive') ?? null,
    );
    const sources = await fetchJson<{ items: Source[] }>('/photo-sources');
    setSource(sources.items[0] ?? null);
    setNotice('Sesión lista. Recorre el archivo por el tiempo que sí conocemos.');
    await loadFeed(null, true);
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!cursor || !sentinel.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadFeed(cursor);
      },
      { rootMargin: '480px 0px' },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, feed.length]);

  const index = useMemo(() => {
    const groups = new Map<string, { label: string; photos: Photo[]; year: number | null }>();
    for (const photo of feed) {
      const existing = groups.get(photo.period.key);
      if (existing) existing.photos.push(photo);
      else
        groups.set(photo.period.key, {
          label: periodLabel(photo),
          photos: [photo],
          year: photo.period.year,
        });
    }
    return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
  }, [feed]);
  const years = useMemo(
    () => [
      ...new Set(index.map((group) => group.year).filter((year): year is number => year !== null)),
    ],
    [index],
  );
  const jumpTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const login = async () => {
    const response = await call('/auth/development-login', { method: 'POST' });
    if (response.ok) await refresh();
    else setNotice('El acceso de desarrollo no está disponible con OAuth configurado.');
  };
  const googleLogin = async () => {
    const response = await call('/auth/google/authorize', { method: 'POST' });
    if (!response.ok)
      return setNotice('No se pudo iniciar el acceso con Google. Inténtalo de nuevo.');
    const data = (await response.json()) as {
      available?: boolean;
      authorizationUrl?: string;
      message?: string;
    };
    if (!data.available || !data.authorizationUrl) {
      setDevelopmentAvailable(true);
      return setNotice(
        `${data.message ?? 'Google OAuth no está configurado.'} La ruta de desarrollo está disponible.`,
      );
    }
    window.location.assign(data.authorizationUrl);
  };
  const browse = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !folderId || folderId === 'root')
      return setNotice('Indica una carpeta concreta; nunca exploramos Drive completo.');
    const response = await call(
      `/oauth-connections/${connection.id}/drive/folders/${encodeURIComponent(folderId)}/children`,
    );
    if (!response.ok) return setNotice('No se pudo abrir esa carpeta autorizada.');
    setFolders((await response.json()).items);
  };
  const createSource = async () => {
    if (!connection || !folderId) return;
    const response = await call('/photo-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oauthConnectionId: connection.id,
        driveFolderId: folderId,
        name: 'Carpeta seleccionada',
        type: 'GENERIC',
      }),
    });
    if (!response.ok) return setNotice('No fue posible confirmar la carpeta.');
    setSource(await response.json());
    setNotice('Carpeta confirmada. Puedes iniciar un escaneo de hasta 100 imágenes.');
  };
  const sync = async () => {
    if (!source) return;
    const response = await call(`/photo-sources/${source.id}/sync-runs`, { method: 'POST' });
    setNotice(
      response.status === 202
        ? 'Escaneo encolado. Cuando termine, actualiza la línea de vida.'
        : 'No se pudo encolar el escaneo.',
    );
  };
  const selectPhoto = (photo: Photo) => {
    setSelectedPhoto(photo);
    setFailedContent(false);
    const value = photo.manualDateOverride?.dateValue ?? photo.effectiveDate.value;
    const date = value ? new Date(value) : null;
    setManualYear(date ? String(date.getUTCFullYear()) : '');
    setManualMonth(
      date && photo.effectiveDate.precision !== 'YEAR' ? String(date.getUTCMonth() + 1) : '',
    );
    setManualDay(date && photo.effectiveDate.precision === 'DAY' ? String(date.getUTCDate()) : '');
  };
  const saveManualDate = async () => {
    const ids = selectedPhotoIds.length
      ? selectedPhotoIds
      : selectedPhoto
        ? [selectedPhoto.id]
        : [];
    if (!ids.length) return;
    const response = await call('/photos/manual-date-overrides', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photoIds: ids,
        year: Number(manualYear),
        ...(manualMonth ? { month: Number(manualMonth) } : {}),
        ...(manualDay ? { day: Number(manualDay) } : {}),
        precision: manualDay ? 'DAY' : manualMonth ? 'MONTH' : 'YEAR',
      }),
    });
    if (!response.ok) return setNotice('La fecha no es válida o la foto ya no está disponible.');
    setNotice('Fecha corregida. Recarga la línea de vida para verla en su lugar cronológico.');
    setSelectedPhotoIds([]);
    await loadFeed(null, true);
  };
  const removeManualDate = async () => {
    if (!selectedPhoto?.manualDateOverride) return;
    const response = await call(`/photos/${selectedPhoto.id}/manual-date`, { method: 'DELETE' });
    if (!response.ok) return setNotice('No se pudo revertir la fecha manual.');
    setSelectedPhoto(null);
    setNotice('La foto volvió a su fecha detectada.');
    await loadFeed(null, true);
  };

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Archivo personal · solo lectura</p>
        <h1>
          Línea de <em>vida.</em>
        </h1>
        <p className="lede">Un recorrido continuo por las fotografías que elegiste conservar.</p>
        {!connection && (
          <nav>
            <button onClick={() => void googleLogin()}>Continuar con Google</button>
            {developmentAvailable && (
              <button className="quiet" onClick={() => void login()}>
                Entrar en desarrollo
              </button>
            )}
          </nav>
        )}
      </header>
      <p className="notice" role="status">
        {notice}
      </p>
      <section className="source" aria-labelledby="source-title">
        <div>
          <p className="eyebrow">Una carpeta, a tu ritmo</p>
          <h2 id="source-title">El archivo empieza donde tú eliges.</h2>
          <p>
            Solo leemos la carpeta autorizada y sus hijas. Nunca escaneamos Drive completo,
            escribimos en Drive ni analizamos el contenido de las fotos.
          </p>
        </div>
        {source ? (
          <button onClick={() => void sync()}>Sincronizar carpeta</button>
        ) : connection ? (
          <div className="picker">
            <form onSubmit={(event) => void browse(event)}>
              <label htmlFor="folder-id">ID de carpeta inicial</label>
              <input
                id="folder-id"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              />
              <button type="submit">Abrir carpeta</button>
            </form>
            {folders.map((folder) => (
              <button className="folder" key={folder.id} onClick={() => setFolderId(folder.id)}>
                {folder.name}
              </button>
            ))}
            {folderId && (
              <button className="quiet" onClick={() => void createSource()}>
                Confirmar esta raíz
              </button>
            )}
          </div>
        ) : (
          <p>
            {configured
              ? 'Continúa con Google para seleccionar una carpeta.'
              : 'Falta la configuración de Google OAuth.'}
          </p>
        )}
      </section>
      <section className="timeline" aria-labelledby="timeline-title">
        <div className="timeline-heading">
          <div>
            <p className="eyebrow">Cronología</p>
            <h2 id="timeline-title">Recorre el tiempo</h2>
            <p>
              Cada imagen conserva la precisión que tiene. Un año sin mes no se convierte en enero;
              una fecha desconocida sigue siendo desconocida.
            </p>
          </div>
          <button
            className="quiet refresh"
            onClick={() => void loadFeed(null, true)}
            disabled={loadingFeed}
          >
            Actualizar
          </button>
        </div>
        {years.length > 0 && (
          <nav className="time-index" aria-label="Índice de períodos cargados">
            <span>Índice rápido</span>
            {years.map((year) => (
              <button key={year} onClick={() => jumpTo(`year-${year}`)}>
                {year}
              </button>
            ))}
            {index
              .filter((group) => group.year !== null)
              .map((group) => (
                <button
                  className="month-jump"
                  key={group.key}
                  onClick={() => jumpTo(`period-${group.key}`)}
                >
                  {group.label}
                </button>
              ))}
            {index.some((group) => group.year === null) && (
              <button onClick={() => jumpTo('period-unknown')}>Sin fecha</button>
            )}
          </nav>
        )}
        <div className="feed" aria-live="polite">
          {index.map((group, groupIndex) => (
            <section className="month-section" id={`period-${group.key}`} key={group.key}>
              {(groupIndex === 0 || index[groupIndex - 1].year !== group.year) &&
                group.year !== null && (
                  <span className="year-marker" id={`year-${group.year}`}>
                    {group.year}
                  </span>
                )}
              <header>
                <h3>{group.label}</h3>
                <span>
                  {group.photos.length} {group.photos.length === 1 ? 'foto' : 'fotos'}
                </span>
              </header>
              <ul className="photo-grid">
                {group.photos.map((photo) => (
                  <li key={photo.id}>
                    <label className="photo-check">
                      <input
                        type="checkbox"
                        checked={selectedPhotoIds.includes(photo.id)}
                        onChange={() =>
                          setSelectedPhotoIds((current) =>
                            current.includes(photo.id)
                              ? current.filter((id) => id !== photo.id)
                              : [...current, photo.id],
                          )
                        }
                      />
                      <span className="sr-only">
                        Seleccionar {photo.fileName} para editar la fecha
                      </span>
                    </label>
                    <Thumbnail photo={photo} onOpen={() => selectPhoto(photo)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!loadingFeed && !feed.length && !feedError && (
            <p className="empty">
              Aún no hay fotografías indexadas. Sincroniza una carpeta para comenzar.
            </p>
          )}
          {loadingFeed && (
            <p className="loading-line" role="status">
              Cargando otro tramo del archivo…
            </p>
          )}
          {feedError && (
            <button onClick={() => void loadFeed(cursor, !feed.length)}>Reintentar carga</button>
          )}
          <div ref={sentinel} aria-hidden="true" />
          {cursor && (
            <button
              className="load-more"
              onClick={() => void loadFeed(cursor)}
              disabled={loadingFeed}
            >
              Cargar más
            </button>
          )}
        </div>
      </section>
      {selectedPhoto && (
        <section className="detail" aria-labelledby="detail-title">
          <div>
            <h2 id="detail-title">{selectedPhoto.fileName}</h2>
            <p>
              {precisionLabel(selectedPhoto.effectiveDate.precision)} · origen{' '}
              {selectedPhoto.effectiveDate.origin}
            </p>
            {/^image\/(heic|heif)$/i.test(selectedPhoto.mimeType) ? (
              <p role="status">
                Este formato sigue indexado, pero el navegador no puede mostrarlo. Descarga el
                original para abrirlo en una aplicación compatible.
              </p>
            ) : failedContent ? (
              <p role="status">
                No pudimos cargar el original. Comprueba la conexión de Drive y vuelve a intentarlo.
              </p>
            ) : (
              <img
                src={mediaUrl(api, `/v1/photos/${selectedPhoto.id}/content`)}
                alt={selectedPhoto.fileName}
                onError={() => setFailedContent(true)}
              />
            )}
          </div>
          <a href={mediaUrl(api, `/v1/photos/${selectedPhoto.id}/content`)} download>
            Descargar original
          </a>
          <div className="date-editor">
            <h3>
              {selectedPhotoIds.length > 1
                ? `Corregir ${selectedPhotoIds.length} fotos`
                : 'Corregir fecha'}
            </h3>
            <div className="date-fields">
              <label>
                Año
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  value={manualYear}
                  onChange={(event) => setManualYear(event.target.value)}
                />
              </label>
              <label>
                Mes
                <select
                  value={manualMonth}
                  onChange={(event) => {
                    setManualMonth(event.target.value);
                    setManualDay('');
                  }}
                >
                  <option value="">Sin mes</option>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {monthName.format(new Date(Date.UTC(2024, index)))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Día
                <input
                  type="number"
                  min="1"
                  max="31"
                  disabled={!manualMonth}
                  value={manualDay}
                  onChange={(event) => setManualDay(event.target.value)}
                />
              </label>
            </div>
            <button onClick={() => void saveManualDate()} disabled={!manualYear}>
              Guardar fecha
            </button>
            {selectedPhoto.manualDateOverride && (
              <button className="quiet" onClick={() => void removeManualDate()}>
                Revertir a detectada
              </button>
            )}
          </div>
        </section>
      )}
      <footer>
        Las fechas incompletas siguen visibles. No inventamos días, meses ni recuerdos.
      </footer>
    </main>
  );
}
