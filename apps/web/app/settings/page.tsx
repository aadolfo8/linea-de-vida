'use client';

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

type RuleScope = 'DIRECT_ONLY' | 'FALLBACK_DESCENDANTS' | 'ALL_DESCENDANTS';
type DriveFolder = { id: string; name: string; parents: string[] };
type IndexedFolder = {
  id: string;
  parentId: string | null;
  name: string;
  path: string[];
  status: 'ACTIVE' | 'MISSING';
  photoCount: number;
  classifiedPhotoCount: number;
  unclassifiedPhotoCount: number;
  dateRule: {
    dateValue: string;
    precision: 'YEAR' | 'MONTH';
    scope: RuleScope;
  } | null;
};
type IndexedPhoto = {
  id: string;
  folderId: string | null;
  fileName: string;
  thumbnailUrl: string;
  effectiveDate: {
    value: string | null;
    precision: string;
    origin: string;
  };
};
type ClassificationSummary = {
  total: number;
  automatic: number;
  folder: number;
  manual: number;
  unclassified: number;
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
type Notice = { message: string; tone: 'info' | 'success' | 'warning' | 'error' };
type BusyAction =
  | 'browse'
  | 'create-source'
  | 'sync'
  | 'remove-photos'
  | 'folder-date'
  | 'manual-date'
  | 'remove-rule'
  | 'disconnect';

const TERMINAL_SYNC_STATUSES = ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'];
const MANUAL_DATE_BULK_LIMIT = 50;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, index, 1)),
  ),
}));
const YEAR_OPTIONS = Array.from({ length: 201 }, (_, index) => String(2100 - index));

const isSyncActive = (run: SyncRun | null) =>
  Boolean(run && !TERMINAL_SYNC_STATUSES.includes(run.status));
const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const pluralize = (count: number, singular: string, plural: string) =>
  `${count.toLocaleString('es-ES')} ${count === 1 ? singular : plural}`;

const errorCopy = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiError)) return fallback;
  const reference = error.requestId ? ` Referencia: ${error.requestId}.` : '';
  if (error.status === 429)
    return `Se alcanzó el límite temporal. Reintenta en ${error.retryAfterSeconds ?? 'unos'} segundos.${reference}`;
  return `${fallback}${reference}`;
};

const originLabel = (origin: string) =>
  ({
    EXIF: 'Fecha guardada por la cámara',
    DRIVE_IMAGE_METADATA: 'Información de la foto en Drive',
    TAKEOUT: 'Datos exportados de Google Fotos',
    FOLDER: 'Fecha deducida del nombre de la carpeta',
    FOLDER_RULE: 'Fecha configurada para la carpeta',
    MANUAL: 'Corrección manual',
    NONE: 'Sin información de fecha',
  })[origin] ?? 'Origen de fecha desconocido';

const formatClassifiedDate = (effectiveDate: IndexedPhoto['effectiveDate']) => {
  if (!effectiveDate.value) return 'Sin fecha asignada';
  const date = new Date(effectiveDate.value);
  if (Number.isNaN(date.valueOf())) return 'Fecha no disponible';
  if (effectiveDate.precision === 'YEAR') return String(date.getUTCFullYear());
  const value = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const formatRuleDate = (rule: NonNullable<IndexedFolder['dateRule']>) =>
  formatClassifiedDate({ value: rule.dateValue, precision: rule.precision, origin: 'FOLDER_RULE' });

const scopeLabel = (scope: RuleScope) =>
  ({
    DIRECT_ONLY: 'Solo esta carpeta',
    FALLBACK_DESCENDANTS: 'Esta carpeta y sus subcarpetas, sin sustituir fechas fiables',
    ALL_DESCENDANTS: 'Esta carpeta y sus subcarpetas, incluso si ya tienen fecha automática',
  })[scope];

const scopeDescription = (scope: RuleScope) => {
  if (scope === 'ALL_DESCENDANTS')
    return 'Puede sustituir fechas encontradas en la foto, Drive o Google Fotos. Las correcciones manuales siempre se conservan.';
  if (scope === 'FALLBACK_DESCENDANTS')
    return 'Completa fotos sin fecha y sustituye fechas deducidas del nombre de carpeta. Conserva las fechas encontradas en la foto, Drive o Google Fotos y todas las correcciones manuales.';
  return 'Afecta únicamente a las fotos guardadas directamente en esta carpeta. Conserva las fechas fiables y todas las correcciones manuales.';
};

const syncStatusLabel = (status: string) =>
  ({
    QUEUED: 'Esperando para comenzar',
    RUNNING: 'Buscando cambios en Drive',
    SUCCEEDED: 'Archivo actualizado',
    PARTIAL: 'Actualización completada con incidencias',
    FAILED: 'No se pudo actualizar el archivo',
    CANCELLED: 'Actualización cancelada',
  })[status] ?? 'Estado de actualización no disponible';

const syncPhaseLabel = (phase?: string) =>
  phase === 'SCANNING' ? 'Revisando carpetas y fotografías' : 'Preparando la revisión';

const issueCopy = (issue: SyncIssue) =>
  ({
    ACCESS_DENIED:
      'No se pudo acceder a la carpeta configurada. Comprueba que siga disponible en Drive y vuelve a intentarlo.',
    AMBIGUOUS_TAKEOUT_MATCH:
      'No se pudo relacionar con seguridad una foto con sus datos de Google Fotos. La foto se conservó para revisión.',
    INVALID_TAKEOUT_JSON:
      'Uno de los archivos de datos de Google Fotos no se pudo leer. Puedes volver a exportarlo y repetir la revisión.',
    UNREADABLE_METADATA:
      'No se pudo leer la información de una fotografía. La revisión continuó con el resto del archivo.',
    UNKNOWN:
      'La revisión alcanzó un límite de seguridad. Reduce el tamaño de la carpeta o vuelve a intentarlo.',
  })[issue.code ?? ''] ??
  'Una fotografía no se pudo procesar. Vuelve a revisar el archivo para intentarlo de nuevo.';

const formatRunDate = (value?: string) => {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
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
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceType, setSourceType] = useState<Source['type']>('GENERIC');
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [folders, setFolders] = useState<IndexedFolder[]>([]);
  const [summary, setSummary] = useState<ClassificationSummary | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<IndexedPhoto[]>([]);
  const [photoCursor, setPhotoCursor] = useState<string | null>(null);
  const [photoFilter, setPhotoFilter] = useState('ALL');
  const [pendingView, setPendingView] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmRemovePhotos, setConfirmRemovePhotos] = useState(false);
  const [confirmRemoveRule, setConfirmRemoveRule] = useState(false);
  const [dateYear, setDateYear] = useState('');
  const [dateMonth, setDateMonth] = useState('');
  const [dateError, setDateError] = useState('');
  const [ruleScope, setRuleScope] = useState<RuleScope>('DIRECT_ONLY');
  const [confirmDate, setConfirmDate] = useState(false);
  const [manualYear, setManualYear] = useState('');
  const [manualMonth, setManualMonth] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const activeSourceIdRef = useRef<string | null>(null);
  const selectedFolderIdRef = useRef<string | null>(null);
  const photoFilterRef = useRef(photoFilter);
  const pendingViewRef = useRef(pendingView);
  const archiveRequestRef = useRef<AbortController | null>(null);
  const photoRequestRef = useRef<AbortController | null>(null);

  const busy = busyAction !== null;
  const activeSources = sources.filter((source) => source.status === 'ACTIVE');
  const activeSource =
    activeSources.find((source) => source.id === selectedSourceId) ?? activeSources[0] ?? null;
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;

  const folderRelations = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const parentById = new Map<string, IndexedFolder>();
    const childrenById = new Map<string, IndexedFolder[]>();
    for (const folder of folders) {
      const parent = folder.parentId ? byId.get(folder.parentId) : null;
      if (!parent) continue;
      parentById.set(folder.id, parent);
      childrenById.set(parent.id, [...(childrenById.get(parent.id) ?? []), folder]);
    }
    const depthById = new Map<string, number>();
    for (const folder of folders) {
      const visited = new Set([folder.id]);
      let depth = 1;
      let parent = parentById.get(folder.id);
      while (parent && !visited.has(parent.id)) {
        visited.add(parent.id);
        depth += 1;
        parent = parentById.get(parent.id);
      }
      depthById.set(folder.id, depth);
    }
    const roots = folders.filter((folder) => !parentById.has(folder.id));
    return { byId, parentById, childrenById, depthById, roots };
  }, [folders]);

  const visibleFolders = useMemo(() => {
    const visible: IndexedFolder[] = [];
    const visited = new Set<string>();
    const append = (folder: IndexedFolder) => {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      visible.push(folder);
      if (collapsedFolders.has(folder.id)) return;
      for (const child of folderRelations.childrenById.get(folder.id) ?? []) append(child);
    };
    for (const root of folderRelations.roots) append(root);
    for (const folder of folders) append(folder);
    return visible;
  }, [collapsedFolders, folderRelations, folders]);

  const scopeFolders = useMemo(() => {
    if (!selectedFolder) return [];
    const scoped: IndexedFolder[] = [];
    const visited = new Set<string>();
    const pending = [selectedFolder];
    while (pending.length) {
      const folder = pending.pop()!;
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      scoped.push(folder);
      pending.push(...(folderRelations.childrenById.get(folder.id) ?? []));
    }
    return scoped;
  }, [folderRelations, selectedFolder]);
  const recursiveScope = ruleScope !== 'DIRECT_ONLY';
  const affectedFolders = recursiveScope ? scopeFolders : selectedFolder ? [selectedFolder] : [];
  const affectedPhotoCount = affectedFolders.reduce(
    (total, folder) => total + folder.photoCount,
    0,
  );
  const affectedUnclassifiedCount = affectedFolders.reduce(
    (total, folder) => total + folder.unclassifiedPhotoCount,
    0,
  );

  const announce = (message: string, tone: Notice['tone'] = 'info') => setNotice({ message, tone });

  const loadSources = async () => {
    setLoadingSources(true);
    try {
      const next = (await apiJson<{ items: Source[] }>('/photo-sources')).items;
      setSources(next);
      setSelectedSourceId((current) =>
        next.some((source) => source.id === current && source.status === 'ACTIVE')
          ? current
          : (next.find((source) => source.status === 'ACTIVE')?.id ?? null),
      );
    } finally {
      setLoadingSources(false);
    }
  };

  const loadArchive = async (sourceId: string) => {
    archiveRequestRef.current?.abort();
    const controller = new AbortController();
    archiveRequestRef.current = controller;
    setLoadingArchive(true);
    try {
      const all: IndexedFolder[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: IndexedFolder[]; nextCursor: string | null } = await apiJson(
          settingsEndpoint.indexedFolders(sourceId, cursor ?? undefined),
          { signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          archiveRequestRef.current !== controller ||
          activeSourceIdRef.current !== sourceId
        )
          return;
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      const [nextSummary, nextHistory] = await Promise.all([
        apiJson<ClassificationSummary>(settingsEndpoint.classificationSummary(sourceId), {
          signal: controller.signal,
        }),
        apiJson<{ items: SyncRun[] }>(settingsEndpoint.history(sourceId), {
          signal: controller.signal,
        }),
      ]);
      if (
        controller.signal.aborted ||
        archiveRequestRef.current !== controller ||
        activeSourceIdRef.current !== sourceId
      )
        return;
      setFolders(all);
      setSummary(nextSummary);
      setHistory(nextHistory.items);
      setRun(nextHistory.items[0] ?? null);
      setSelectedFolderId((current) => {
        const next = all.some((folder) => folder.id === current) ? current : (all[0]?.id ?? null);
        selectedFolderIdRef.current = next;
        return next;
      });
    } finally {
      if (archiveRequestRef.current === controller) {
        archiveRequestRef.current = null;
        setLoadingArchive(false);
      }
    }
  };

  const loadPhotos = async (
    sourceId: string,
    folderIdValue: string,
    filter: string,
    cursor?: string,
    append = false,
  ) => {
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    setLoadingPhotos(true);
    try {
      const page = await apiJson<{ items: IndexedPhoto[]; nextCursor: string | null }>(
        settingsEndpoint.folderPhotos(folderIdValue, cursor, filter === 'ALL' ? undefined : filter),
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        photoRequestRef.current !== controller ||
        activeSourceIdRef.current !== sourceId ||
        selectedFolderIdRef.current !== folderIdValue ||
        pendingViewRef.current ||
        photoFilterRef.current !== filter
      )
        return;
      setPhotos((current) => (append ? [...current, ...page.items] : page.items));
      setPhotoCursor(page.nextCursor);
      if (!append) setSelectedPhotos(new Set());
    } finally {
      if (photoRequestRef.current === controller) {
        photoRequestRef.current = null;
        setLoadingPhotos(false);
      }
    }
  };

  const loadPending = async (sourceId: string, cursor?: string, append = false) => {
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    pendingViewRef.current = true;
    photoFilterRef.current = 'UNCLASSIFIED';
    setPendingView(true);
    setPhotoFilter('UNCLASSIFIED');
    if (!append) {
      setPhotos([]);
      setPhotoCursor(null);
      setSelectedPhotos(new Set());
    }
    setLoadingPhotos(true);
    try {
      const page = await apiJson<{ items: IndexedPhoto[]; nextCursor: string | null }>(
        settingsEndpoint.pendingPhotos(sourceId, cursor),
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        photoRequestRef.current !== controller ||
        activeSourceIdRef.current !== sourceId ||
        !pendingViewRef.current
      )
        return;
      setPhotos((current) => (append ? [...current, ...page.items] : page.items));
      setPhotoCursor(page.nextCursor);
    } finally {
      if (photoRequestRef.current === controller) {
        photoRequestRef.current = null;
        setLoadingPhotos(false);
      }
    }
  };

  useEffect(() => {
    void loadSources().catch((error) =>
      announce(
        errorCopy(error, 'No se pudieron cargar las fuentes configuradas. Reintenta.'),
        'error',
      ),
    );
  }, []);

  useEffect(() => {
    const sourceId = activeSource?.id ?? null;
    activeSourceIdRef.current = sourceId;
    selectedFolderIdRef.current = null;
    photoFilterRef.current = 'ALL';
    pendingViewRef.current = false;
    archiveRequestRef.current?.abort();
    archiveRequestRef.current = null;
    photoRequestRef.current?.abort();
    photoRequestRef.current = null;
    setFolders([]);
    setSummary(null);
    setHistory([]);
    setRun(null);
    setIssues([]);
    setSelectedFolderId(null);
    setCollapsedFolders(new Set());
    setPhotos([]);
    setPhotoCursor(null);
    setSelectedPhotos(new Set());
    setPhotoFilter('ALL');
    setPendingView(false);
    setConfirmRemovePhotos(false);
    setConfirmRemoveRule(false);
    setConfirmDate(false);
    setManualEditorOpen(false);
    setDateError('');
    setManualError('');
    setLoadingPhotos(false);
    setLoadingArchive(Boolean(sourceId));
    if (!sourceId) return;
    void loadArchive(sourceId).catch((error) => {
      if (!isAbortError(error) && activeSourceIdRef.current === sourceId)
        announce(errorCopy(error, 'No se pudo cargar el archivo indexado. Reintenta.'), 'error');
    });
  }, [activeSource?.id]);

  useEffect(() => {
    const sourceId = activeSource?.id;
    if (!sourceId || !selectedFolderId) {
      setPhotos([]);
      return;
    }
    if (pendingView) return;
    const folderIdValue = selectedFolderId;
    const filter = photoFilter;
    selectedFolderIdRef.current = folderIdValue;
    photoFilterRef.current = filter;
    void loadPhotos(sourceId, folderIdValue, filter).catch((error) => {
      if (
        !isAbortError(error) &&
        activeSourceIdRef.current === sourceId &&
        selectedFolderIdRef.current === folderIdValue
      )
        announce(
          errorCopy(error, 'No se pudieron cargar las fotos de esta carpeta. Reintenta.'),
          'error',
        );
    });
  }, [activeSource?.id, selectedFolderId, photoFilter, pendingView]);

  useEffect(() => {
    if (!selectedFolder) return;
    const rule = selectedFolder.dateRule;
    if (rule) {
      const date = new Date(rule.dateValue);
      setDateYear(String(date.getUTCFullYear()));
      setDateMonth(rule.precision === 'MONTH' ? String(date.getUTCMonth() + 1) : '');
      setRuleScope(rule.scope);
    } else {
      setDateYear('');
      setDateMonth('');
      setRuleScope('DIRECT_ONLY');
    }
    setDateError('');
    setConfirmDate(false);
    setConfirmRemoveRule(false);
  }, [selectedFolderId]);

  useEffect(() => {
    const sourceId = activeSource?.id;
    if (!sourceId || !run || TERMINAL_SYNC_STATUSES.includes(run.status)) return;
    const runId = run.id;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void apiJson<SyncRun>(settingsEndpoint.run(runId), { signal: controller.signal })
        .then((nextRun) => {
          if (!controller.signal.aborted && activeSourceIdRef.current === sourceId) setRun(nextRun);
        })
        .catch((error) => {
          if (!isAbortError(error) && activeSourceIdRef.current === sourceId)
            announce(
              errorCopy(error, 'No se pudo consultar el avance. La revisión puede seguir activa.'),
              'error',
            );
        });
    }, 2500);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [activeSource?.id, run?.id, run?.status]);

  useEffect(() => {
    const sourceId = activeSource?.id;
    if (!run) {
      setIssues([]);
      return;
    }
    if (!sourceId) return;
    const controller = new AbortController();
    void apiJson<{ items: SyncIssue[] }>(settingsEndpoint.issues(run.id), {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted && activeSourceIdRef.current === sourceId)
          setIssues(page.items);
      })
      .catch((error) => {
        if (!isAbortError(error) && activeSourceIdRef.current === sourceId) setIssues([]);
      });
    if (run.status === 'SUCCEEDED') {
      announce(
        `Archivo actualizado: ${pluralize(run.indexedCount ?? 0, 'foto indexada', 'fotos indexadas')}.`,
        'success',
      );
      if (activeSourceIdRef.current === sourceId) void loadArchive(sourceId);
    } else if (run.status === 'PARTIAL') {
      announce('La revisión terminó, pero algunas fotos necesitan atención.', 'warning');
      if (activeSourceIdRef.current === sourceId) void loadArchive(sourceId);
    } else if (run.status === 'FAILED') {
      announce(
        'No se pudo actualizar el archivo. Revisa la incidencia y vuelve a intentarlo.',
        'error',
      );
    }
    return () => controller.abort();
  }, [activeSource?.id, run?.id, run?.status]);

  useEffect(
    () => () => {
      archiveRequestRef.current?.abort();
      photoRequestRef.current?.abort();
    },
    [],
  );

  const browse = async (event: FormEvent) => {
    event.preventDefault();
    if (!connection || !folderId.trim() || folderId === 'root') {
      announce('Indica una carpeta concreta. Nunca exploramos todo tu Drive.', 'warning');
      return;
    }
    setBusyAction('browse');
    try {
      const page = await apiJson<{ items: DriveFolder[] }>(
        settingsEndpoint.folderChildren(connection.id, folderId.trim()),
      );
      setDriveFolders(page.items);
      announce(
        page.items.length
          ? 'Carpeta encontrada. Puedes elegir una subcarpeta o guardar esta ubicación.'
          : 'Carpeta encontrada. No contiene subcarpetas; puedes guardarla como fuente.',
        'success',
      );
    } catch (error) {
      announce(
        errorCopy(error, 'No se pudo abrir esa carpeta de Drive. Comprueba el ID.'),
        'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const createSource = async () => {
    if (!connection || !folderId.trim() || folderId === 'root') return;
    setBusyAction('create-source');
    try {
      await apiJson<Source>(settingsEndpoint.createSource, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oauthConnectionId: connection.id,
          driveFolderId: folderId.trim(),
          name: sourceName.trim() || 'Carpeta seleccionada',
          type: sourceType,
        }),
      });
      await loadSources();
      announce(
        'Fuente guardada. Ahora busca las fotos de esa carpeta para crear el índice.',
        'success',
      );
    } catch (error) {
      announce(errorCopy(error, 'No fue posible guardar esa carpeta. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const sync = async (source: Source) => {
    if (isSyncActive(run)) return;
    setBusyAction('sync');
    try {
      const nextRun = await apiJson<SyncRun>(settingsEndpoint.sync(source.id), { method: 'POST' });
      setRun(nextRun);
      announce('Revisión solicitada. Verás el avance y el resultado en esta página.', 'info');
    } catch (error) {
      announce(
        errorCopy(error, 'No se pudo iniciar la revisión. Comprueba la conexión y reintenta.'),
        'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const removeSelected = async () => {
    if (!selectedPhotos.size) return;
    const count = selectedPhotos.size;
    setBusyAction('remove-photos');
    try {
      for (const photoId of selectedPhotos)
        await apiJson<void>(settingsEndpoint.photo(photoId), { method: 'DELETE' });
      if (activeSource && pendingView) await loadPending(activeSource.id);
      else if (activeSource && selectedFolderId)
        await loadPhotos(activeSource.id, selectedFolderId, photoFilter);
      if (activeSource) await loadArchive(activeSource.id);
      setSelectedPhotos(new Set());
      setConfirmRemovePhotos(false);
      announce(
        `${pluralize(count, 'foto retirada', 'fotos retiradas')} del archivo. Drive no se modificó.`,
        'success',
      );
    } catch (error) {
      announce(
        errorCopy(
          error,
          'No se pudieron retirar todas las fotos. Revisa la selección y reintenta.',
        ),
        'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const applyFolderDate = async () => {
    if (!selectedFolder) return;
    const year = Number(dateYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      setDateError('Selecciona un año entre 1900 y 2100.');
      return;
    }
    setDateError('');
    setBusyAction('folder-date');
    try {
      const result = await apiJson<{ affectedCount: number }>(
        settingsEndpoint.folderDate(selectedFolder.id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year,
            ...(dateMonth ? { month: Number(dateMonth) } : {}),
            precision: dateMonth ? 'MONTH' : 'YEAR',
            scope: ruleScope,
            reason: 'Fecha configurada desde la organización del archivo',
          }),
        },
      );
      setConfirmDate(false);
      if (activeSource) await loadArchive(activeSource.id);
      if (activeSource)
        await loadPhotos(activeSource.id, selectedFolder.id, photoFilterRef.current);
      announce(
        `Fecha de carpeta guardada. Se revisaron ${pluralize(result.affectedCount, 'foto', 'fotos')} sin borrar la información original.`,
        'success',
      );
    } catch (error) {
      announce(
        errorCopy(error, 'No se pudo guardar la fecha. Revisa los campos y reintenta.'),
        'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const applyManualDate = async () => {
    if (!selectedPhotos.size) return;
    if (selectedPhotos.size > MANUAL_DATE_BULK_LIMIT) {
      setManualError(
        `Puedes corregir un máximo de ${MANUAL_DATE_BULK_LIMIT} fotos a la vez. Reduce la selección y vuelve a intentarlo.`,
      );
      return;
    }
    const year = Number(manualYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      setManualError('Selecciona un año entre 1900 y 2100.');
      return;
    }
    const count = selectedPhotos.size;
    setManualError('');
    setBusyAction('manual-date');
    try {
      await apiJson<{ items: IndexedPhoto[] }>(settingsEndpoint.manualDates, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: [...selectedPhotos],
          year,
          ...(manualMonth ? { month: Number(manualMonth) } : {}),
          precision: manualMonth ? 'MONTH' : 'YEAR',
          reason: 'Corrección manual desde la organización del archivo',
        }),
      });
      setManualEditorOpen(false);
      setSelectedPhotos(new Set());
      if (activeSource && pendingView) await loadPending(activeSource.id);
      else if (activeSource && selectedFolderId)
        await loadPhotos(activeSource.id, selectedFolderId, photoFilter);
      if (activeSource) await loadArchive(activeSource.id);
      announce(
        `Fecha corregida en ${pluralize(count, 'foto', 'fotos')}. La información detectada original se conserva.`,
        'success',
      );
    } catch (error) {
      announce(errorCopy(error, 'No se pudo guardar la corrección. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const removeFolderDate = async () => {
    if (!selectedFolder) return;
    setBusyAction('remove-rule');
    try {
      const result = await apiJson<{ affectedCount: number }>(
        settingsEndpoint.folderDate(selectedFolder.id),
        { method: 'DELETE' },
      );
      setConfirmRemoveRule(false);
      if (activeSource) await loadArchive(activeSource.id);
      if (activeSource)
        await loadPhotos(activeSource.id, selectedFolder.id, photoFilterRef.current);
      announce(
        `Fecha de carpeta retirada. Se volvieron a evaluar ${pluralize(result.affectedCount, 'foto', 'fotos')} con su información original y otras reglas aplicables.`,
        'success',
      );
    } catch (error) {
      announce(
        errorCopy(error, 'No se pudo retirar la fecha de esta carpeta. Reintenta.'),
        'error',
      );
    } finally {
      setBusyAction(null);
    }
  };

  const disconnect = async () => {
    if (!connection) return;
    setBusyAction('disconnect');
    try {
      await apiJson<void>(settingsEndpoint.disconnect(connection.id), { method: 'DELETE' });
      setConnection(null);
      setSources([]);
      setConfirmDisconnect(false);
      announce(
        'Drive se desconectó. El índice permanece, pero las fotos originales no estarán disponibles hasta volver a conectar.',
        'success',
      );
    } catch (error) {
      announce(errorCopy(error, 'No se pudo desconectar Drive. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const toggleFolder = (folderIdValue: string) =>
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderIdValue)) next.delete(folderIdValue);
      else next.add(folderIdValue);
      return next;
    });

  const openFolder = (folderIdValue: string) => {
    if (selectedFolderIdRef.current === folderIdValue && !pendingViewRef.current) return;
    photoRequestRef.current?.abort();
    photoRequestRef.current = null;
    selectedFolderIdRef.current = folderIdValue;
    pendingViewRef.current = false;
    setPendingView(false);
    setPhotos([]);
    setPhotoCursor(null);
    setSelectedPhotos(new Set());
    setLoadingPhotos(true);
    setSelectedFolderId(folderIdValue);
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLElement>, folder: IndexedFolder) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    if (!tree) return;
    const rows = Array.from(tree.querySelectorAll<HTMLElement>('[data-tree-row="true"]'));
    const currentIndex = rows.indexOf(event.currentTarget);
    const focusAt = (index: number) => rows[Math.max(0, Math.min(rows.length - 1, index))]?.focus();
    const children = folderRelations.childrenById.get(folder.id) ?? [];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(currentIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(currentIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(rows.length - 1);
    } else if (event.key === 'ArrowRight' && children.length) {
      event.preventDefault();
      if (collapsedFolders.has(folder.id)) toggleFolder(folder.id);
      else rows.find((row) => row.dataset.folderId === children[0]?.id)?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (children.length && !collapsedFolders.has(folder.id)) toggleFolder(folder.id);
      else {
        const parent = folderRelations.parentById.get(folder.id);
        rows.find((row) => row.dataset.folderId === parent?.id)?.focus();
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openFolder(folder.id);
    }
  };

  const togglePhoto = (photoId: string) =>
    setSelectedPhotos((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else if (next.size < MANUAL_DATE_BULK_LIMIT) next.add(photoId);
      return next;
    });

  const selectVisiblePhotos = () => {
    const allVisibleSelected = photos.every((photo) => selectedPhotos.has(photo.id));
    if (allVisibleSelected || selectedPhotos.size >= MANUAL_DATE_BULK_LIMIT) {
      setSelectedPhotos(new Set());
      return;
    }
    const limited = photos.slice(0, MANUAL_DATE_BULK_LIMIT);
    setSelectedPhotos(new Set(limited.map((photo) => photo.id)));
    if (photos.length > MANUAL_DATE_BULK_LIMIT)
      announce(
        `Puedes corregir hasta ${MANUAL_DATE_BULK_LIMIT} fotos a la vez. Se seleccionaron las primeras ${MANUAL_DATE_BULK_LIMIT} de esta vista.`,
        'info',
      );
  };

  const selectedRuleScopeText = selectedFolder?.dateRule
    ? scopeDescription(selectedFolder.dateRule.scope)
    : '';
  const treeTabStopId =
    !pendingView && visibleFolders.some((folder) => folder.id === selectedFolderId)
      ? selectedFolderId
      : (visibleFolders[0]?.id ?? null);
  const allVisiblePhotosSelected =
    photos.length > 0 && photos.every((photo) => selectedPhotos.has(photo.id));

  return (
    <main className={styles.settings}>
      <header className={styles.intro}>
        <h1>Organiza las fechas de tu archivo</h1>
        <p>
          Comprueba qué fotos tienen fecha, corrige las que lo necesiten y revisa los cambios de
          Drive. Línea de vida solo lee la carpeta que eliges: nunca modifica ni elimina archivos en
          Drive.
        </p>
      </header>

      {notice && (
        <div
          className={`${styles.notice} ${styles[`notice_${notice.tone}`]}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
          aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span aria-hidden="true" className={styles.noticeMark} />
          <p>{notice.message}</p>
        </div>
      )}

      <section className={styles.connectionSection} aria-labelledby="drive-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="drive-title">Conexión con Google Drive</h2>
            <p>Se usa únicamente para leer las carpetas que añadas como fuentes de fotografías.</p>
          </div>
          <span className={connection ? styles.connected : styles.disconnected}>
            <span aria-hidden="true" />
            {connection ? 'Drive conectado' : 'Drive sin conectar'}
          </span>
        </div>
        {connection && (
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy}
          >
            Desconectar Drive
          </button>
        )}
        {confirmDisconnect && (
          <div className={styles.confirmationPanel} role="group" aria-labelledby="disconnect-title">
            <div>
              <h3 id="disconnect-title">Desconectar el acceso de lectura</h3>
              <p>
                El índice permanecerá, pero no podrás abrir originales ni buscar cambios hasta que
                vuelvas a conectar Drive.
              </p>
            </div>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void disconnect()}
                disabled={busy}
              >
                {busyAction === 'disconnect' && (
                  <span className={styles.spinner} aria-hidden="true" />
                )}
                Desconectar Drive
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setConfirmDisconnect(false)}
                disabled={busy}
              >
                Mantener conexión
              </button>
            </div>
          </div>
        )}
      </section>

      {connection && (
        <section className={styles.sourceSetup} aria-labelledby="source-picker-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="source-picker-title">Añade una carpeta de fotos</h2>
              <p>
                Elige el tipo correcto para que podamos interpretar las fechas sin alterar los
                archivos originales.
              </p>
            </div>
          </div>

          <fieldset className={styles.sourceChoices}>
            <legend>¿Qué contiene la carpeta?</legend>
            <label className={sourceType === 'GENERIC' ? styles.sourceChoiceSelected : ''}>
              <input
                type="radio"
                name="source-type"
                value="GENERIC"
                checked={sourceType === 'GENERIC'}
                onChange={() => setSourceType('GENERIC')}
              />
              <span>
                <strong>Una carpeta normal de fotografías</strong>
                <small>
                  Elige esta opción para imágenes organizadas por ti. La fecha se obtiene de la
                  información disponible en Drive y, si hace falta, del nombre de las carpetas.
                </small>
              </span>
            </label>
            <label className={sourceType === 'GOOGLE_TAKEOUT' ? styles.sourceChoiceSelected : ''}>
              <input
                type="radio"
                name="source-type"
                value="GOOGLE_TAKEOUT"
                checked={sourceType === 'GOOGLE_TAKEOUT'}
                onChange={() => setSourceType('GOOGLE_TAKEOUT')}
              />
              <span>
                <strong>Una exportación de Google Fotos</strong>
                <small>
                  Google Takeout es la descarga que crea Google Fotos con imágenes y archivos de
                  datos. Elige esta opción si copiaste esa exportación completa a Drive; usaremos
                  esos datos para recuperar mejor la fecha de captura.
                </small>
              </span>
            </label>
          </fieldset>

          <form className={styles.sourceForm} onSubmit={(event) => void browse(event)}>
            <label htmlFor="source-name">
              Nombre para reconocer esta fuente
              <input
                id="source-name"
                value={sourceName}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="Fotos familiares antiguas"
                maxLength={200}
              />
            </label>
            <label htmlFor="folder-id">
              ID de la carpeta de Google Drive
              <span className={styles.fieldHint}>
                Es la parte de la dirección de Drive que aparece después de <code>/folders/</code>.
                Nunca usamos la raíz completa de tu Drive.
              </span>
              <div className={styles.inputAction}>
                <input
                  id="folder-id"
                  value={folderId}
                  onChange={(event) => {
                    setFolderId(event.target.value);
                    setDriveFolders([]);
                  }}
                  placeholder="Pega aquí el ID de la carpeta"
                  required
                />
                <button
                  type="submit"
                  className={styles.secondaryButton}
                  disabled={busy || !folderId.trim()}
                >
                  {busyAction === 'browse' && (
                    <span className={styles.spinner} aria-hidden="true" />
                  )}
                  Comprobar carpeta
                </button>
              </div>
            </label>
          </form>

          {!!driveFolders.length && (
            <div className={styles.driveFolderList} aria-label="Subcarpetas disponibles">
              <p>Subcarpetas encontradas</p>
              {driveFolders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className={styles.folderCandidate}
                  onClick={() => {
                    setFolderId(folder.id);
                    setDriveFolders([]);
                    announce(`Subcarpeta “${folder.name}” seleccionada.`, 'info');
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M2.75 5.75h5l1.5 1.75h8v7.75h-14.5z" />
                  </svg>
                  <span>{folder.name}</span>
                  <small>Usar esta carpeta</small>
                </button>
              ))}
            </div>
          )}

          <div className={styles.sourceSaveRow}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void createSource()}
              disabled={busy || !folderId.trim()}
            >
              {busyAction === 'create-source' && (
                <span className={styles.spinner} aria-hidden="true" />
              )}
              Guardar esta carpeta como fuente
            </button>
            <p>Después podrás revisar su contenido y clasificar las fechas.</p>
          </div>
        </section>
      )}

      <section
        aria-labelledby="archive-title"
        className={styles.archiveSection}
        aria-busy={loadingArchive}
      >
        <div className={styles.archiveHeader}>
          <div>
            <h2 id="archive-title">Estado de la clasificación</h2>
            <p>
              Este índice refleja la última revisión completada. Las fotos siguen en Drive y solo se
              muestran aquí para organizar su fecha.
            </p>
          </div>
          {activeSource && (
            <div className={styles.syncAction}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void sync(activeSource)}
                disabled={busy || loadingArchive || isSyncActive(run)}
              >
                {(busyAction === 'sync' || isSyncActive(run)) && (
                  <span className={styles.spinner} aria-hidden="true" />
                )}
                {isSyncActive(run) ? 'Buscando cambios…' : 'Buscar cambios en Drive'}
              </button>
              <small>
                Añade fotos nuevas, actualiza la información disponible y detecta archivos que ya no
                están. Drive no se modifica.
              </small>
            </div>
          )}
        </div>

        {loadingSources ? (
          <div className={styles.loadingLine} aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            Cargando fuentes de fotografías…
          </div>
        ) : activeSources.length > 1 ? (
          <label className={styles.sourceSelect}>
            Fuente que estás organizando
            <select
              value={activeSource?.id ?? ''}
              onChange={(event) => {
                const nextSourceId = event.target.value;
                activeSourceIdRef.current = nextSourceId;
                selectedFolderIdRef.current = null;
                photoFilterRef.current = 'ALL';
                pendingViewRef.current = false;
                archiveRequestRef.current?.abort();
                archiveRequestRef.current = null;
                photoRequestRef.current?.abort();
                photoRequestRef.current = null;
                setFolders([]);
                setSummary(null);
                setHistory([]);
                setRun(null);
                setIssues([]);
                setSelectedFolderId(null);
                setCollapsedFolders(new Set());
                setPhotos([]);
                setPhotoCursor(null);
                setSelectedPhotos(new Set());
                setPhotoFilter('ALL');
                setPendingView(false);
                setConfirmRemovePhotos(false);
                setConfirmRemoveRule(false);
                setConfirmDate(false);
                setManualEditorOpen(false);
                setLoadingPhotos(false);
                setLoadingArchive(true);
                setSelectedSourceId(nextSourceId);
              }}
              disabled={busy}
            >
              {activeSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name} ·{' '}
                  {source.type === 'GOOGLE_TAKEOUT'
                    ? 'Exportación de Google Fotos'
                    : 'Carpeta de fotos'}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {!loadingSources && !activeSource ? (
          <div className={styles.emptyState}>
            <h3>Aún no hay una fuente de fotografías</h3>
            <p>Añade una carpeta de Drive para crear el índice y empezar a organizar las fechas.</p>
          </div>
        ) : activeSource ? (
          <div className={styles.sourceIdentity}>
            <div>
              <strong>{activeSource.name}</strong>
              <span>
                {activeSource.type === 'GOOGLE_TAKEOUT'
                  ? 'Exportación de Google Fotos'
                  : 'Carpeta normal de fotografías'}
              </span>
            </div>
            <details>
              <summary>Ver identificación de la carpeta</summary>
              <code>{activeSource.driveFolderId}</code>
            </details>
          </div>
        ) : null}

        {run && (
          <div
            className={`${styles.syncPanel} ${styles[`sync_${run.status.toLowerCase()}`] ?? ''}`}
            aria-live="polite"
          >
            <div className={styles.syncPanelHeading}>
              <div className={styles.syncTitleLine}>
                {isSyncActive(run) && <span className={styles.spinner} aria-hidden="true" />}
                <div>
                  <strong>{syncStatusLabel(run.status)}</strong>
                  <span>
                    {isSyncActive(run) ? syncPhaseLabel(run.phase) : formatRunDate(run.createdAt)}
                  </span>
                </div>
              </div>
              {(run.status === 'FAILED' || run.status === 'PARTIAL') && activeSource && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void sync(activeSource)}
                  disabled={busy || isSyncActive(run)}
                >
                  Volver a intentarlo
                </button>
              )}
            </div>
            {isSyncActive(run) && (run.foundCount ?? 0) > 0 ? (
              <div className={styles.progressBlock}>
                <progress
                  max={Math.max(1, run.foundCount ?? 1)}
                  value={Math.min(run.processedCount ?? 0, run.foundCount ?? 1)}
                  aria-label="Avance de la revisión"
                />
                <span>
                  {pluralize(run.processedCount ?? 0, 'foto revisada', 'fotos revisadas')} de{' '}
                  {(run.foundCount ?? 0).toLocaleString('es-ES')} encontradas
                </span>
              </div>
            ) : isSyncActive(run) ? (
              <progress
                className={styles.indeterminateProgress}
                aria-label="Preparando la revisión"
              />
            ) : null}
            <dl className={styles.syncCounts}>
              <div>
                <dt>Fotos encontradas</dt>
                <dd>{(run.foundCount ?? 0).toLocaleString('es-ES')}</dd>
              </div>
              <div>
                <dt>Fotos revisadas</dt>
                <dd>{(run.processedCount ?? 0).toLocaleString('es-ES')}</dd>
              </div>
              <div>
                <dt>Fotos incluidas</dt>
                <dd>{(run.indexedCount ?? 0).toLocaleString('es-ES')}</dd>
              </div>
              <div>
                <dt>Incidencias</dt>
                <dd>{(run.issueCount ?? 0).toLocaleString('es-ES')}</dd>
              </div>
            </dl>
            {!!issues.length && (
              <ul className={styles.issues}>
                {issues.map((issue) => (
                  <li key={issue.id}>{issueCopy(issue)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loadingArchive && !summary ? (
          <div className={styles.summarySkeleton} aria-label="Cargando resumen de clasificación">
            {Array.from({ length: 4 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
        ) : summary ? (
          <div className={styles.summaryBlock}>
            <div className={styles.summaryHeading}>
              <div>
                <strong>{summary.total.toLocaleString('es-ES')}</strong>
                <span>fotografías en esta fuente</span>
              </div>
              {summary.unclassified > 0 ? (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadPending(activeSource.id)}
                  disabled={loadingArchive || loadingPhotos}
                >
                  Revisar {summary.unclassified.toLocaleString('es-ES')} sin fecha
                </button>
              ) : (
                <span className={styles.completeLabel}>Todas tienen una fecha</span>
              )}
            </div>
            <dl className={styles.classificationSummary}>
              <div>
                <dt>Fecha encontrada automáticamente</dt>
                <dd>{summary.automatic.toLocaleString('es-ES')}</dd>
                <p>Proviene de la foto, Drive, Google Fotos o del nombre de una carpeta.</p>
              </div>
              <div>
                <dt>Fecha configurada por carpeta</dt>
                <dd>{summary.folder.toLocaleString('es-ES')}</dd>
                <p>Usa una fecha que configuraste para organizar una carpeta.</p>
              </div>
              <div>
                <dt>Fecha corregida manualmente</dt>
                <dd>{summary.manual.toLocaleString('es-ES')}</dd>
                <p>Es una corrección directa y tiene prioridad sobre cualquier otra fecha.</p>
              </div>
              <div className={summary.unclassified > 0 ? styles.needsReview : ''}>
                <dt>Sin fecha suficiente</dt>
                <dd>{summary.unclassified.toLocaleString('es-ES')}</dd>
                <p>Necesita que elijas un año o un mes antes de aparecer en la línea de vida.</p>
              </div>
            </dl>
          </div>
        ) : null}

        {activeSource && !loadingArchive && !folders.length && (
          <div className={styles.emptyState}>
            <h3>La fuente todavía no se ha revisado</h3>
            <p>Usa “Buscar cambios en Drive” para encontrar sus carpetas y construir el índice.</p>
          </div>
        )}

        {!!folders.length && (
          <div className={styles.archiveWorkspace}>
            <aside className={styles.treePanel}>
              <div className={styles.treeHeading}>
                <div>
                  <h3>Carpetas</h3>
                  <span>{pluralize(folders.length, 'carpeta', 'carpetas')}</span>
                </div>
                <span>Usa ← y → para plegar</span>
              </div>
              {summary && summary.unclassified > 0 && (
                <button
                  type="button"
                  className={`${styles.pendingTreeRow} ${pendingView ? styles.currentFolder : ''}`}
                  onClick={() => void loadPending(activeSource.id)}
                  disabled={loadingArchive || loadingPhotos}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="10" cy="10" r="7" />
                    <path d="M10 6.5v4.25M10 13.5v.25" />
                  </svg>
                  <span>
                    <strong>Fotos por revisar</strong>
                    <small>
                      {pluralize(summary.unclassified, 'foto sin fecha', 'fotos sin fecha')}
                    </small>
                  </span>
                </button>
              )}
              <nav className={styles.tree} aria-label="Carpetas indexadas" role="tree">
                {visibleFolders.map((folder) => {
                  const children = folderRelations.childrenById.get(folder.id) ?? [];
                  const hasChildren = children.length > 0;
                  const collapsed = collapsedFolders.has(folder.id);
                  const current = folder.id === selectedFolderId && !pendingView;
                  return (
                    <div
                      key={folder.id}
                      className={`${styles.treeItem} ${current ? styles.currentFolder : ''}`}
                      role="treeitem"
                      tabIndex={folder.id === treeTabStopId ? 0 : -1}
                      aria-level={folderRelations.depthById.get(folder.id) ?? 1}
                      aria-selected={current}
                      aria-expanded={hasChildren ? !collapsed : undefined}
                      data-tree-row="true"
                      data-folder-id={folder.id}
                      onClick={(event) => {
                        const target = event.target;
                        if (
                          hasChildren &&
                          target instanceof Element &&
                          target.closest('[data-tree-disclosure="true"]')
                        )
                          toggleFolder(folder.id);
                        else openFolder(folder.id);
                      }}
                      onKeyDown={(event) => handleTreeKeyDown(event, folder)}
                      style={
                        {
                          '--tree-depth': (folderRelations.depthById.get(folder.id) ?? 1) - 1,
                        } as CSSProperties
                      }
                    >
                      {hasChildren ? (
                        <span
                          className={styles.disclosure}
                          data-tree-disclosure="true"
                          aria-hidden="true"
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />
                          </svg>
                        </span>
                      ) : (
                        <span className={styles.disclosureSpacer} aria-hidden="true" />
                      )}
                      <span className={styles.treeRow}>
                        <svg className={styles.folderIcon} viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M2.75 5.75h5l1.5 1.75h8v7.75h-14.5z" />
                        </svg>
                        <span className={styles.treeLabel}>
                          <strong>{folder.name}</strong>
                          <small>
                            {pluralize(folder.photoCount, 'foto', 'fotos')} ·{' '}
                            {folder.classifiedPhotoCount.toLocaleString('es-ES')} con fecha ·{' '}
                            {folder.unclassifiedPhotoCount.toLocaleString('es-ES')} por revisar
                          </small>
                        </span>
                        {folder.status === 'MISSING' && (
                          <span className={styles.missingLabel}>No disponible</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </nav>
            </aside>

            <div className={styles.folderContents}>
              {pendingView && summary ? (
                <header className={styles.contentHeader}>
                  <div>
                    <span className={styles.contextLabel}>Toda la fuente</span>
                    <h3>Fotos sin fecha suficiente</h3>
                    <p>
                      Estas {summary.unclassified.toLocaleString('es-ES')} fotografías no tienen
                      todavía un año o mes fiable. Selecciónalas para corregirlas en grupo.
                    </p>
                  </div>
                  {selectedFolder && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => openFolder(selectedFolder.id)}
                    >
                      Volver a {selectedFolder.name}
                    </button>
                  )}
                </header>
              ) : selectedFolder ? (
                <>
                  <header className={styles.contentHeader}>
                    <nav className={styles.breadcrumb} aria-label="Ruta de la carpeta">
                      {selectedFolder.path.map((segment, index) => (
                        <span key={`${segment}-${index}`}>{segment}</span>
                      ))}
                    </nav>
                    <div className={styles.folderTitleRow}>
                      <div>
                        <h3>{selectedFolder.name}</h3>
                        <p>
                          {pluralize(selectedFolder.photoCount, 'fotografía', 'fotografías')} ·{' '}
                          {selectedFolder.classifiedPhotoCount.toLocaleString('es-ES')} con fecha ·{' '}
                          {selectedFolder.unclassifiedPhotoCount.toLocaleString('es-ES')} por
                          revisar
                        </p>
                      </div>
                      {selectedFolder.status === 'MISSING' && (
                        <span className={styles.missingNotice}>
                          No se encontró en la última revisión de Drive
                        </span>
                      )}
                    </div>
                  </header>

                  {selectedFolder.dateRule && (
                    <div className={styles.ruleStatus}>
                      <div>
                        <span>Fecha configurada para esta carpeta</span>
                        <strong>{formatRuleDate(selectedFolder.dateRule)}</strong>
                        <p>
                          {scopeLabel(selectedFolder.dateRule.scope)}. {selectedRuleScopeText}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={styles.textDangerButton}
                        onClick={() => setConfirmRemoveRule(true)}
                        disabled={busy}
                      >
                        Quitar fecha de carpeta
                      </button>
                    </div>
                  )}

                  {confirmRemoveRule && selectedFolder.dateRule && (
                    <div
                      className={styles.confirmationPanel}
                      role="group"
                      aria-labelledby="remove-rule-title"
                    >
                      <div>
                        <h3 id="remove-rule-title">Quitar la fecha configurada</h3>
                        <p>
                          Las fotos volverán a usar la fecha encontrada en la foto, Google Fotos o
                          el nombre de la carpeta. También se aplicará cualquier fecha configurada
                          en una carpeta superior. Las correcciones manuales no cambiarán.
                        </p>
                      </div>
                      <div className={styles.buttonRow}>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          onClick={() => void removeFolderDate()}
                          disabled={busy}
                        >
                          {busyAction === 'remove-rule' && (
                            <span className={styles.spinner} aria-hidden="true" />
                          )}
                          Quitar fecha de carpeta
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => setConfirmRemoveRule(false)}
                          disabled={busy}
                        >
                          Conservar fecha
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              <div className={styles.galleryToolbar}>
                <label>
                  Mostrar fotografías
                  <select
                    value={photoFilter}
                    onChange={(event) => {
                      setPendingView(false);
                      pendingViewRef.current = false;
                      photoFilterRef.current = event.target.value;
                      photoRequestRef.current?.abort();
                      photoRequestRef.current = null;
                      setPhotos([]);
                      setPhotoCursor(null);
                      setSelectedPhotos(new Set());
                      setLoadingPhotos(true);
                      setPhotoFilter(event.target.value);
                    }}
                    disabled={loadingArchive || loadingPhotos}
                  >
                    <option value="ALL">Todas las fotografías</option>
                    <option value="UNCLASSIFIED">Sin fecha suficiente</option>
                    <option value="AUTOMATIC">Con fecha encontrada automáticamente</option>
                    <option value="FOLDER">Con fecha configurada por carpeta</option>
                    <option value="MANUAL">Con fecha corregida manualmente</option>
                  </select>
                </label>
                <span aria-live="polite">
                  {selectedPhotos.size
                    ? pluralize(selectedPhotos.size, 'foto seleccionada', 'fotos seleccionadas')
                    : 'Selecciona fotos para corregir su fecha'}
                </span>
              </div>

              {loadingPhotos && !photos.length ? (
                <div className={styles.photoSkeletons} aria-label="Cargando fotografías">
                  {Array.from({ length: 6 }, (_, index) => (
                    <span key={index} />
                  ))}
                </div>
              ) : !photos.length ? (
                <div className={styles.emptyState}>
                  <h3>
                    {pendingView ? 'No quedan fotos por revisar' : 'No hay fotos en esta vista'}
                  </h3>
                  <p>
                    {pendingView
                      ? 'Todas las fotografías de esta fuente tienen una fecha suficiente.'
                      : photoFilter === 'ALL'
                        ? 'Esta carpeta no contiene fotografías activas en el índice.'
                        : 'Cambia el filtro para ver fotografías con otro tipo de fecha.'}
                  </p>
                </div>
              ) : (
                <div className={styles.photoGrid}>
                  {photos.map((photo) => {
                    const selected = selectedPhotos.has(photo.id);
                    return (
                      <article key={photo.id} className={selected ? styles.selectedPhoto : ''}>
                        <label className={styles.photoSelection}>
                          <input
                            className={styles.visuallyHidden}
                            type="checkbox"
                            checked={selected}
                            onChange={() => togglePhoto(photo.id)}
                            disabled={
                              loadingArchive ||
                              loadingPhotos ||
                              (!selected && selectedPhotos.size >= MANUAL_DATE_BULK_LIMIT)
                            }
                            aria-describedby="selection-limit-hint"
                          />
                          <img
                            src={mediaUrl(api, photo.thumbnailUrl)}
                            alt={`Vista previa de ${photo.fileName}`}
                            loading="lazy"
                          />
                          <span className={styles.photoMeta}>
                            <strong>{photo.fileName}</strong>
                            <span className={styles.photoDate}>
                              {formatClassifiedDate(photo.effectiveDate)}
                            </span>
                            <small>{originLabel(photo.effectiveDate.origin)}</small>
                          </span>
                          <span className={styles.selectionState}>
                            <span aria-hidden="true">
                              {selected && (
                                <svg viewBox="0 0 16 16">
                                  <path d="m3 8.25 3 3 7-7" />
                                </svg>
                              )}
                            </span>
                            {selected ? 'Seleccionada' : 'Seleccionar fotografía'}
                          </span>
                        </label>
                        {pendingView && photo.folderId && (
                          <button
                            type="button"
                            className={styles.photoFolderLink}
                            onClick={() => openFolder(photo.folderId!)}
                          >
                            Abrir su carpeta
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}

              {!!photos.length && (
                <div className={styles.selectionToolbar}>
                  <div>
                    <strong>
                      {selectedPhotos.size
                        ? pluralize(selectedPhotos.size, 'seleccionada', 'seleccionadas')
                        : 'Ninguna seleccionada'}
                    </strong>
                    <span id="selection-limit-hint">
                      Puedes corregir hasta {MANUAL_DATE_BULK_LIMIT} fotos a la vez.
                    </span>
                  </div>
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={selectVisiblePhotos}
                      disabled={busy || loadingArchive || loadingPhotos}
                    >
                      {allVisiblePhotosSelected || selectedPhotos.size >= MANUAL_DATE_BULK_LIMIT
                        ? 'Cancelar selección'
                        : 'Seleccionar las visibles'}
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => setManualEditorOpen(true)}
                      disabled={busy || loadingArchive || !selectedPhotos.size}
                    >
                      Corregir fecha
                    </button>
                    <button
                      type="button"
                      className={styles.textDangerButton}
                      onClick={() => setConfirmRemovePhotos(true)}
                      disabled={busy || loadingArchive || !selectedPhotos.size}
                    >
                      Quitar del archivo
                    </button>
                  </div>
                </div>
              )}

              {confirmRemovePhotos && selectedPhotos.size > 0 && (
                <div
                  className={styles.confirmationPanel}
                  role="group"
                  aria-labelledby="remove-photos-title"
                >
                  <div>
                    <h3 id="remove-photos-title">
                      Quitar {pluralize(selectedPhotos.size, 'fotografía', 'fotografías')} del
                      índice
                    </h3>
                    <p>
                      Dejarán de aparecer en Línea de vida. Los archivos originales seguirán en
                      Drive y no se modificarán.
                    </p>
                  </div>
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => void removeSelected()}
                      disabled={busy}
                    >
                      {busyAction === 'remove-photos' && (
                        <span className={styles.spinner} aria-hidden="true" />
                      )}
                      Quitar del índice
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setConfirmRemovePhotos(false)}
                      disabled={busy}
                    >
                      Conservar fotografías
                    </button>
                  </div>
                </div>
              )}

              {manualEditorOpen && selectedPhotos.size > 0 && (
                <div className={styles.datePanel}>
                  <div className={styles.datePanelHeading}>
                    <div>
                      <h3>Corregir la fecha de la selección</h3>
                      <p>
                        La corrección manual tendrá prioridad. La fecha detectada se conserva para
                        poder recuperarla si retiras la corrección más adelante. Puedes guardar un
                        máximo de {MANUAL_DATE_BULK_LIMIT} fotos por vez.
                      </p>
                    </div>
                    <span>{pluralize(selectedPhotos.size, 'foto', 'fotos')}</span>
                  </div>
                  <div className={styles.dateFields}>
                    <label>
                      Año
                      <select
                        value={manualYear}
                        onChange={(event) => {
                          setManualYear(event.target.value);
                          setManualError('');
                        }}
                        aria-invalid={Boolean(manualError)}
                        aria-describedby={manualError ? 'manual-date-error' : undefined}
                      >
                        <option value="">Selecciona un año</option>
                        {YEAR_OPTIONS.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Mes
                      <select
                        value={manualMonth}
                        onChange={(event) => setManualMonth(event.target.value)}
                      >
                        <option value="">Solo el año</option>
                        {MONTH_OPTIONS.map((month) => (
                          <option key={month.value} value={month.value}>
                            {month.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {manualError && (
                    <p className={styles.fieldError} id="manual-date-error" role="alert">
                      {manualError}
                    </p>
                  )}
                  <div className={styles.buttonRow}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      onClick={() => void applyManualDate()}
                      disabled={busy || !manualYear}
                    >
                      {busyAction === 'manual-date' && (
                        <span className={styles.spinner} aria-hidden="true" />
                      )}
                      Guardar corrección
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        setManualEditorOpen(false);
                        setManualError('');
                      }}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {photoCursor && (
                <button
                  type="button"
                  className={styles.loadMoreButton}
                  onClick={() =>
                    void (pendingView
                      ? loadPending(activeSource.id, photoCursor, true)
                      : selectedFolderId
                        ? loadPhotos(
                            activeSource.id,
                            selectedFolderId,
                            photoFilter,
                            photoCursor,
                            true,
                          )
                        : Promise.resolve())
                  }
                  disabled={busy || loadingPhotos}
                >
                  {loadingPhotos && <span className={styles.spinner} aria-hidden="true" />}
                  Cargar más fotografías
                </button>
              )}

              {selectedFolder && !pendingView && (
                <div className={styles.folderDateSection}>
                  <div className={styles.folderDateHeading}>
                    <div>
                      <h3>Configura una fecha para esta carpeta</h3>
                      <p>
                        Úsala cuando varias fotos comparten año o mes. Esta configuración no crea
                        correcciones manuales y se aplicará también en futuras revisiones.
                      </p>
                    </div>
                    <span>La opción más segura está seleccionada</span>
                  </div>

                  <div className={styles.dateFields}>
                    <label>
                      Año
                      <select
                        value={dateYear}
                        onChange={(event) => {
                          setDateYear(event.target.value);
                          setDateError('');
                          setConfirmDate(false);
                        }}
                        aria-invalid={Boolean(dateError)}
                        aria-describedby={dateError ? 'folder-date-error' : undefined}
                      >
                        <option value="">Selecciona un año</option>
                        {YEAR_OPTIONS.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Mes
                      <select
                        value={dateMonth}
                        onChange={(event) => {
                          setDateMonth(event.target.value);
                          setConfirmDate(false);
                        }}
                      >
                        <option value="">Solo el año</option>
                        {MONTH_OPTIONS.map((month) => (
                          <option key={month.value} value={month.value}>
                            {month.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {dateError && (
                    <p className={styles.fieldError} id="folder-date-error" role="alert">
                      {dateError}
                    </p>
                  )}

                  <fieldset className={styles.scopeOptions}>
                    <legend>¿Qué fotos pueden usar esta fecha?</legend>
                    <label className={ruleScope === 'DIRECT_ONLY' ? styles.scopeSelected : ''}>
                      <input
                        type="radio"
                        name="rule-scope"
                        value="DIRECT_ONLY"
                        checked={ruleScope === 'DIRECT_ONLY'}
                        onChange={() => {
                          setRuleScope('DIRECT_ONLY');
                          setConfirmDate(false);
                        }}
                      />
                      <span>
                        <strong>Solo las fotos de esta carpeta</strong>
                        <small>
                          La opción más segura. Puede completar hasta{' '}
                          {selectedFolder.photoCount.toLocaleString('es-ES')} fotos y no afecta a
                          ninguna subcarpeta. Conserva fechas fiables y correcciones manuales.
                        </small>
                      </span>
                    </label>
                    <label
                      className={ruleScope === 'FALLBACK_DESCENDANTS' ? styles.scopeSelected : ''}
                    >
                      <input
                        type="radio"
                        name="rule-scope"
                        value="FALLBACK_DESCENDANTS"
                        checked={ruleScope === 'FALLBACK_DESCENDANTS'}
                        onChange={() => {
                          setRuleScope('FALLBACK_DESCENDANTS');
                          setConfirmDate(false);
                        }}
                      />
                      <span>
                        <strong>También completar fotos de las subcarpetas</strong>
                        <small>
                          Alcanza {pluralize(scopeFolders.length, 'carpeta', 'carpetas')} y{' '}
                          {pluralize(
                            affectedUnclassifiedCount,
                            'foto sin fecha',
                            'fotos sin fecha',
                          )}
                          , además de fechas deducidas de nombres de carpeta. Conserva las fechas
                          encontradas en la foto, Drive o Google Fotos y todas las correcciones
                          manuales.
                        </small>
                      </span>
                    </label>
                    <label className={ruleScope === 'ALL_DESCENDANTS' ? styles.scopeSelected : ''}>
                      <input
                        type="radio"
                        name="rule-scope"
                        value="ALL_DESCENDANTS"
                        checked={ruleScope === 'ALL_DESCENDANTS'}
                        onChange={() => {
                          setRuleScope('ALL_DESCENDANTS');
                          setConfirmDate(false);
                        }}
                      />
                      <span>
                        <strong>Reemplazar también fechas automáticas de las subcarpetas</strong>
                        <small>
                          Opción de mayor alcance: puede cambiar hasta{' '}
                          {pluralize(affectedPhotoCount, 'foto', 'fotos')} en{' '}
                          {pluralize(scopeFolders.length, 'carpeta', 'carpetas')}, incluso si ya
                          tienen una fecha de cámara, Drive o Google Fotos. Las correcciones
                          manuales siempre se conservan.
                        </small>
                      </span>
                    </label>
                  </fieldset>

                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => {
                      if (!dateYear) setDateError('Selecciona un año entre 1900 y 2100.');
                      else setConfirmDate(true);
                    }}
                    disabled={busy || !dateYear}
                  >
                    Revisar antes de guardar
                  </button>

                  {confirmDate && (
                    <div
                      className={styles.changeReview}
                      role="group"
                      aria-labelledby="date-confirm-title"
                    >
                      <div>
                        <span>Resumen del cambio</span>
                        <h3 id="date-confirm-title">
                          {dateMonth
                            ? `${MONTH_OPTIONS.find((month) => month.value === dateMonth)?.label} de ${dateYear}`
                            : dateYear}
                        </h3>
                        <p>
                          {scopeLabel(ruleScope)}: la revisión alcanza{' '}
                          {pluralize(affectedFolders.length, 'carpeta', 'carpetas')} y hasta{' '}
                          {pluralize(affectedPhotoCount, 'foto', 'fotos')}.
                        </p>
                        <p>{scopeDescription(ruleScope)}</p>
                      </div>
                      <div className={styles.buttonRow}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          onClick={() => void applyFolderDate()}
                          disabled={busy}
                        >
                          {busyAction === 'folder-date' && (
                            <span className={styles.spinner} aria-hidden="true" />
                          )}
                          Guardar fecha de carpeta
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => setConfirmDate(false)}
                          disabled={busy}
                        >
                          Volver a editar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!!history.length && (
          <details className={styles.history}>
            <summary>Historial de revisiones de Drive</summary>
            <ul>
              {history.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{syncStatusLabel(item.status)}</strong>
                    <small>{formatRunDate(item.createdAt)}</small>
                  </span>
                  <span>
                    {pluralize(item.indexedCount ?? 0, 'foto incluida', 'fotos incluidas')} ·{' '}
                    {pluralize(item.issueCount ?? 0, 'incidencia', 'incidencias')}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </main>
  );
}
