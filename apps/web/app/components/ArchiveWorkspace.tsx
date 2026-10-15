'use client';

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  api,
  ApiError,
  apiJson,
  settingsEndpoint,
  type Connection,
  type Source,
} from '../../lib/api';
import { mediaUrl } from '../../lib/media';
import { driveFolderIdFromInput } from '../../lib/drive-folder';
import { timelineHref } from './timeline-model';
import {
  parseOrganizeLocation,
  writeOrganizeLocation,
  type OrganizeLocation,
} from '../../lib/organize-navigation';
import { removePhotosFromArchive } from '../../lib/photo-removal';
import { visibleFolderTree } from '../settings/folder-tree';
import { archiveStyles as styles } from './archive-workspace.styles';

type RuleScope = 'DIRECT_ONLY' | 'FALLBACK_DESCENDANTS' | 'ALL_DESCENDANTS';
type DriveFolder = { id: string; name: string; parents: string[] };
type IndexedFolder = {
  id: string;
  driveFolderId?: string;
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
  folderPath?: string[];
};
type PhotoExclusion = {
  id: string;
  sourceId: string | null;
  sourceName: string | null;
  folderPath: string[];
  fileName: string | null;
  mimeType: string | null;
  createdAt: string;
  restoredAt: string | null;
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
type SyncIssue = {
  id: string;
  details?: string;
  code?: string;
  driveFileId?: string | null;
  driveFolderId?: string | null;
  indexedPhotoId?: string | null;
  indexedFolderId?: string | null;
  fileName?: string | null;
  createdAt?: string;
};
type SourceOverview = {
  summary: ClassificationSummary | null;
  latestRun: SyncRun | null;
  error: boolean;
  pollError?: boolean;
};
type Notice = { message: string; tone: 'info' | 'success' | 'warning' | 'error' };
type ManualDatePreview = {
  selectedCount: number;
  willChangeCount: number;
  alreadySameCount: number;
  alreadyDatedCount: number;
};
type FolderDatePreview = {
  scopePhotoCount: number;
  willChangeCount: number;
  unchangedCount: number;
  preservesManualCount: number;
  replacesAutomaticCount: number;
  replacesFolderNameDateCount: number;
};
type DateChangeResult = {
  count: number;
  year: number;
  month: number | null;
  scopeLabel: string;
};
type BusyAction =
  | 'browse'
  | 'connect-drive'
  | 'create-source'
  | 'remove-source'
  | 'sync'
  | 'remove-photos'
  | 'refresh-photos'
  | 'folder-date'
  | 'folder-date-preview'
  | 'manual-date'
  | 'manual-date-preview'
  | 'remove-rule'
  | 'restore-exclusion'
  | 'disconnect';

const TERMINAL_SYNC_STATUSES = ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'];
const MANUAL_DATE_BULK_LIMIT = 50;
const ORGANIZE_RETURN_KEY = 'linea-de-vida:organize-return';
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
  if (error.code === 'FOLDER_SOURCE_OVERLAP')
    return `Esa carpeta se solapa con otra fuente ya configurada. Elige una carpeta independiente.${reference}`;
  if (error.code === 'FOLDER_OVERLAP_UNVERIFIED')
    return `No se pudo comprobar si la carpeta se solapa con otra fuente. Revisa el acceso a tus carpetas e inténtalo de nuevo.${reference}`;
  if (error.code === 'SOURCE_SYNC_ACTIVE')
    return `La carpeta se está revisando ahora. Espera a que termine y vuelve a quitarla.${reference}`;
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

const syncResultSummary = (run: SyncRun) => {
  const totals = `${pluralize(run.foundCount ?? 0, 'foto encontrada', 'fotos encontradas')}; ${pluralize(run.indexedCount ?? 0, 'incluida', 'incluidas')}; ${pluralize(run.issueCount ?? 0, 'incidencia', 'incidencias')}.`;
  if (run.status === 'SUCCEEDED')
    return `Revisión completa. ${totals} Los originales de Drive no se modificaron.`;
  if (run.status === 'PARTIAL')
    return `Revisión parcial. ${totals} No se confirmaron las ausencias que quedaron sin revisar.`;
  if (run.status === 'FAILED')
    return `Revisión fallida. ${totals} No se confirmó ninguna ausencia en el archivo.`;
  if (run.status === 'CANCELLED')
    return 'Revisión cancelada. No se confirmó la ausencia de archivos.';
  return null;
};

const sourceStatusLabel = (status: string) =>
  ({ ACTIVE: 'Disponible', DISCONNECTED: 'Drive desconectado', PAUSED: 'Pausada' })[status] ??
  'Estado no disponible';

const issueCopy = (issue: SyncIssue) =>
  ({
    ACCESS_DENIED:
      'No se pudo acceder a la carpeta configurada. Comprueba que siga disponible en Drive y vuelve a intentarlo.',
    DRIVE_UNAVAILABLE:
      'Drive no respondió a la revisión. Tus archivos no se han modificado; inténtalo de nuevo más tarde.',
    RATE_LIMITED:
      'Drive limitó temporalmente las solicitudes. La revisión no pudo confirmar el estado de este elemento.',
    AMBIGUOUS_TAKEOUT_MATCH:
      'No se pudo relacionar con seguridad una foto con sus datos de Google Fotos. La foto se conservó para revisión.',
    INVALID_TAKEOUT_JSON:
      'Uno de los archivos de datos de Google Fotos no se pudo leer. Puedes volver a exportarlo y repetir la revisión.',
    UNREADABLE_METADATA:
      'No se pudo leer la información de una fotografía. La revisión continuó con el resto del archivo.',
    UNSUPPORTED_MEDIA:
      'Este archivo no tiene un formato de foto compatible. Sigue intacto en Drive y no se añadió al archivo.',
    LIMIT_REACHED:
      'La revisión alcanzó un límite de seguridad y quedó incompleta. No se confirmaron ausencias en Drive.',
    UNKNOWN:
      'La revisión alcanzó un límite de seguridad. Reduce el tamaño de la carpeta o vuelve a intentarlo.',
  })[issue.code ?? ''] ??
  'Una fotografía no se pudo procesar. Vuelve a revisar el archivo para intentarlo de nuevo.';

const issueActionCopy = (issue: SyncIssue) =>
  ({
    ACCESS_DENIED:
      'Comprueba que la carpeta siga disponible en Drive y que tu cuenta tenga acceso; después vuelve a revisarla.',
    DRIVE_UNAVAILABLE: 'Espera a que Drive se recupere y vuelve a iniciar una revisión completa.',
    RATE_LIMITED:
      'Espera un poco antes de volver a revisar; no se ha confirmado que falten archivos.',
    AMBIGUOUS_TAKEOUT_MATCH:
      'Comprueba que la exportación de Google Fotos esté completa y vuelve a revisar la carpeta.',
    INVALID_TAKEOUT_JSON:
      'Vuelve a exportar los datos de Google Fotos, guárdalos en Drive y después revisa la carpeta.',
    UNREADABLE_METADATA:
      'La foto se conservó. Vuelve a revisar la carpeta para intentar leer su información otra vez.',
    UNSUPPORTED_MEDIA:
      'Si se trata de una foto, cambia su formato en Drive y vuelve a revisar. Este archivo no se ha alterado.',
    LIMIT_REACHED:
      'Reduce el alcance de la revisión o divide el archivo antes de volver a intentarlo.',
    UNKNOWN: 'Prueba con una carpeta más pequeña o revisa sus subcarpetas por separado.',
  })[issue.code ?? ''] ?? 'Vuelve a revisar la carpeta para intentarlo otra vez.';

const formatRunDate = (value?: string) => {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export function ArchiveWorkspace({
  sessionConnection,
  userName,
  userEmail,
  area,
}: {
  sessionConnection: Connection | null;
  userName?: string | null;
  userEmail?: string | null;
  area: 'organize' | 'settings';
}) {
  const [connection, setConnection] = useState(sessionConnection);
  const [sources, setSources] = useState<Source[]>([]);
  const [organizeTab, setOrganizeTab] = useState<'folders' | 'pending' | 'dates'>('folders');
  const [sourceOverviews, setSourceOverviews] = useState<Record<string, SourceOverview>>({});
  const sourceOverviewsRef = useRef(sourceOverviews);
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
  const [searchMode, setSearchMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [searchFolderId, setSearchFolderId] = useState('ALL');
  const [exclusions, setExclusions] = useState<PhotoExclusion[]>([]);
  const [exclusionCursor, setExclusionCursor] = useState<string | null>(null);
  const [loadingExclusions, setLoadingExclusions] = useState(false);
  const [restoringExclusionId, setRestoringExclusionId] = useState<string | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [history, setHistory] = useState<SyncRun[]>([]);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [issueCursor, setIssueCursor] = useState<string | null>(null);
  const [issueTotalCount, setIssueTotalCount] = useState(0);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [loadingMoreIssues, setLoadingMoreIssues] = useState(false);
  const [issuesError, setIssuesError] = useState(false);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [loadingOverviews, setLoadingOverviews] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmRemoveSourceId, setConfirmRemoveSourceId] = useState<string | null>(null);
  const [confirmRemovePhotos, setConfirmRemovePhotos] = useState(false);
  const [confirmRemoveRule, setConfirmRemoveRule] = useState(false);
  const [dateYear, setDateYear] = useState('');
  const [dateMonth, setDateMonth] = useState('');
  const [dateError, setDateError] = useState('');
  const [folderDatePreview, setFolderDatePreview] = useState<FolderDatePreview | null>(null);
  const [ruleScope, setRuleScope] = useState<RuleScope>('DIRECT_ONLY');
  const [confirmDate, setConfirmDate] = useState(false);
  const [manualYear, setManualYear] = useState('');
  const [manualMonth, setManualMonth] = useState('');
  const [manualError, setManualError] = useState('');
  const [manualDatePreview, setManualDatePreview] = useState<ManualDatePreview | null>(null);
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const [dateChangeResult, setDateChangeResult] = useState<DateChangeResult | null>(null);
  const navigationReadyRef = useRef(false);
  const navigationWriteRef = useRef(false);
  const restoredLocationRef = useRef<OrganizeLocation | null>(null);
  const organizeReturnRestoreRef = useRef<{ href: string; scrollY: number } | null>(null);
  const activeSourceIdRef = useRef<string | null>(null);
  const selectedFolderIdRef = useRef<string | null>(null);
  const photoFilterRef = useRef(photoFilter);
  const pendingViewRef = useRef(pendingView);
  const archiveRequestRef = useRef<AbortController | null>(null);
  const photoRequestRef = useRef<AbortController | null>(null);
  const removing = useRef(false);
  const searchKeyRef = useRef('');
  const busy = busyAction !== null;
  const activeSources = sources.filter((source) => source.status === 'ACTIVE');
  const activeSource =
    activeSources.find((source) => source.id === selectedSourceId) ?? activeSources[0] ?? null;
  const sourcePendingRemoval =
    sources.find((source) => source.id === confirmRemoveSourceId) ?? null;
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const issueAreas = useMemo(() => {
    const areas = {
      folders: [] as SyncIssue[],
      photos: [] as SyncIssue[],
      review: [] as SyncIssue[],
    };
    for (const issue of issues) {
      if (issue.indexedPhotoId) areas.photos.push(issue);
      else if (issue.driveFolderId) areas.folders.push(issue);
      else areas.review.push(issue);
    }
    return areas;
  }, [issues]);

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
    return visibleFolderTree(folders, collapsedFolders);
  }, [collapsedFolders, folders]);

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

  useEffect(() => {
    sourceOverviewsRef.current = sourceOverviews;
  }, [sourceOverviews]);

  const restoreOrganizeReturn = () => {
    const context = organizeReturnRestoreRef.current;
    if (!context) return;
    requestAnimationFrame(() => {
      if (organizeReturnRestoreRef.current !== context) return;
      window.scrollTo({ top: context.scrollY, behavior: 'instant' });
      const folderRow = [...document.querySelectorAll<HTMLElement>('[data-folder-id]')].find(
        (element) => element.dataset.folderId === selectedFolderIdRef.current,
      );
      (folderRow ?? document.getElementById('photos-workspace'))?.focus({ preventScroll: true });
      organizeReturnRestoreRef.current = null;
      sessionStorage.removeItem(ORGANIZE_RETURN_KEY);
    });
  };

  const openTimelineResult = (event: MouseEvent<HTMLAnchorElement>, result: DateChangeResult) => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const returnContext = { href: returnTo, scrollY: window.scrollY };
    try {
      sessionStorage.setItem(ORGANIZE_RETURN_KEY, JSON.stringify(returnContext));
    } catch {
      // The return link still works if browser storage is unavailable.
    }
    const destination = new URL(
      timelineHref({ year: result.year, month: result.month }),
      window.location.origin,
    );
    destination.searchParams.set('returnTo', returnTo);
    destination.searchParams.set('returnLabel', result.scopeLabel);
    event.currentTarget.href = destination.toString();
  };

  const reviewPendingPhotos = () => {
    if (!activeSource || busy) return;
    setOrganizeTab('pending');
    void loadPending(activeSource.id)
      .then(() => document.getElementById('pending-queue')?.scrollIntoView?.({ block: 'start' }))
      .catch((error) =>
        announce(
          errorCopy(error, 'No se pudieron cargar las fotos pendientes. Reintenta.'),
          'error',
        ),
      );
  };

  const openIssueFolder = (issue: SyncIssue) => {
    const folder =
      folders.find((candidate) => candidate.id === issue.indexedFolderId) ??
      folders.find((candidate) => candidate.driveFolderId === issue.driveFolderId);
    if (!folder || !activeSource) {
      announce(
        'Esta carpeta aún no está disponible en el índice. Comprueba el acceso en Drive y vuelve a revisar la fuente.',
        'warning',
      );
      return;
    }
    setOrganizeTab('folders');
    pendingViewRef.current = false;
    setPendingView(false);
    setSearchMode(false);
    setAppliedSearch('');
    setSearchText('');
    setSelectedFolderId(folder.id);
    selectedFolderIdRef.current = folder.id;
    setSelectedPhotos(new Set());
    void loadPhotos(activeSource.id, folder.id, 'ALL').catch((error) =>
      announce(errorCopy(error, 'No se pudieron abrir las fotos de esta carpeta.'), 'error'),
    );
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-folder-id]')].find(
        (element) => element.dataset.folderId === folder.id,
      );
      row?.scrollIntoView?.({ block: 'center' });
      row?.focus({ preventScroll: true });
    });
  };

  const loadMoreIssues = async () => {
    if (!activeSource || !issueCursor || loadingMoreIssues) return;
    setLoadingMoreIssues(true);
    try {
      const page = await apiJson<{
        items: SyncIssue[];
        nextCursor: string | null;
        totalCount: number;
        countsByCode: Record<string, number>;
      }>(settingsEndpoint.sourceIssues(activeSource.id, issueCursor));
      setIssues((current) => [
        ...new Map([...current, ...page.items].map((issue) => [issue.id, issue])).values(),
      ]);
      setIssueCursor(page.nextCursor);
      setIssueTotalCount(page.totalCount);
      setIssuesError(false);
    } catch (error) {
      setIssuesError(true);
      announce(errorCopy(error, 'No se pudieron cargar más problemas. Reintenta.'), 'error');
    } finally {
      setLoadingMoreIssues(false);
    }
  };

  const openOrganizeTab = (tab: 'folders' | 'pending' | 'dates') => {
    setOrganizeTab(tab);
    if (tab === 'pending') {
      reviewPendingPhotos();
      return;
    }
    if (tab === 'dates') {
      if (selectedPhotos.size) setManualEditorOpen(true);
      else announce('Abre una carpeta y selecciona las fotos que quieras fechar.', 'info');
      requestAnimationFrame(() =>
        document.getElementById('photos-workspace')?.scrollIntoView?.({ block: 'start' }),
      );
      return;
    }
    requestAnimationFrame(() =>
      document.getElementById('sources-title')?.scrollIntoView?.({ block: 'start' }),
    );
  };

  const reconnectDrive = async () => {
    setBusyAction('connect-drive');
    try {
      const result = await apiJson<{
        available: boolean;
        authorizationUrl?: string;
        message?: string;
      }>(settingsEndpoint.driveAuthorize, { method: 'POST' });
      if (!result.available || !result.authorizationUrl) {
        announce(result.message ?? 'La conexión con Google Drive no está disponible.', 'warning');
        return;
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      announce(errorCopy(error, 'No se pudo iniciar la reconexión con Drive.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const loadSources = useCallback(async () => {
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
  }, []);

  const loadSourceOverviews = useCallback(async (nextSources: Source[], signal: AbortSignal) => {
    const entries: Array<readonly [string, SourceOverview] | null> = Array(nextSources.length).fill(
      null,
    );
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, nextSources.length) }, async () => {
        while (!signal.aborted) {
          const index = nextIndex++;
          const source = nextSources[index];
          if (!source) return;
          const [summaryResult, historyResult] = await Promise.allSettled([
            apiJson<ClassificationSummary>(settingsEndpoint.classificationSummary(source.id), {
              signal,
            }),
            apiJson<{ items: SyncRun[] }>(settingsEndpoint.history(source.id), { signal }),
          ]);
          if (signal.aborted) return;
          entries[index] = [
            source.id,
            {
              summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
              latestRun:
                historyResult.status === 'fulfilled'
                  ? (historyResult.value.items[0] ?? null)
                  : null,
              error: summaryResult.status === 'rejected' || historyResult.status === 'rejected',
            },
          ];
        }
      }),
    );
    if (!signal.aborted) {
      setSourceOverviews(
        Object.fromEntries(
          entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
        ),
      );
      setLoadingOverviews(false);
    }
  }, []);

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
        const restoredFolderId =
          restoredLocationRef.current?.sourceId === sourceId
            ? restoredLocationRef.current.folderId
            : null;
        const next = all.some((folder) => folder.id === current)
          ? current
          : all.some((folder) => folder.id === restoredFolderId)
            ? restoredFolderId
            : (all[0]?.id ?? null);
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
    retained: IndexedPhoto[] = [],
  ) => {
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    setLoadingPhotos(true);
    let loaded = false;
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
      setPhotos((current) => [
        ...new Map(
          [...(append ? current : retained), ...page.items].map((photo) => [photo.id, photo]),
        ).values(),
      ]);
      setPhotoCursor(page.nextCursor);
      if (!append) setSelectedPhotos(new Set(retained.map((photo) => photo.id)));
      loaded = true;
    } finally {
      if (photoRequestRef.current === controller) {
        photoRequestRef.current = null;
        setLoadingPhotos(false);
        if (loaded) restoreOrganizeReturn();
      }
    }
  };
  const loadPending = async (
    sourceId: string,
    cursor?: string,
    append = false,
    retained: IndexedPhoto[] = [],
  ) => {
    setOrganizeTab('pending');
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    pendingViewRef.current = true;
    photoFilterRef.current = 'UNCLASSIFIED';
    searchKeyRef.current = '';
    setSearchMode(false);
    setPendingView(true);
    setPhotoFilter('UNCLASSIFIED');
    if (!append) {
      setPhotos(retained);
      setPhotoCursor(null);
      setSelectedPhotos(new Set(retained.map((photo) => photo.id)));
    }
    setLoadingPhotos(true);
    let loaded = false;
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
      setPhotos((current) => [
        ...new Map(
          [...(append ? current : retained), ...page.items].map((photo) => [photo.id, photo]),
        ).values(),
      ]);
      setPhotoCursor(page.nextCursor);
      loaded = true;
    } finally {
      if (photoRequestRef.current === controller) {
        photoRequestRef.current = null;
        setLoadingPhotos(false);
        if (loaded) restoreOrganizeReturn();
      }
    }
  };

  const loadSourcePhotos = async (
    sourceId: string,
    query: string,
    folderIdValue: string,
    classification: string,
    cursor?: string,
    append = false,
    retained: IndexedPhoto[] = [],
  ) => {
    const key = JSON.stringify([sourceId, query, folderIdValue, classification]);
    searchKeyRef.current = key;
    photoRequestRef.current?.abort();
    const controller = new AbortController();
    photoRequestRef.current = controller;
    pendingViewRef.current = false;
    setPendingView(false);
    setLoadingPhotos(true);
    let loaded = false;
    try {
      const page = await apiJson<{ items: IndexedPhoto[]; nextCursor: string | null }>(
        settingsEndpoint.sourcePhotos(sourceId, {
          query,
          folderId: folderIdValue === 'ALL' ? undefined : folderIdValue,
          classification,
          cursor,
        }),
        { signal: controller.signal },
      );
      if (
        controller.signal.aborted ||
        photoRequestRef.current !== controller ||
        activeSourceIdRef.current !== sourceId ||
        !searchMode ||
        searchKeyRef.current !== key
      )
        return;
      setPhotos((current) => [
        ...new Map(
          [...(append ? current : retained), ...page.items].map((photo) => [photo.id, photo]),
        ).values(),
      ]);
      setPhotoCursor(page.nextCursor);
      loaded = true;
      if (!append) setSelectedPhotos(new Set(retained.map((photo) => photo.id)));
    } finally {
      if (photoRequestRef.current === controller) {
        photoRequestRef.current = null;
        setLoadingPhotos(false);
        if (loaded) restoreOrganizeReturn();
      }
    }
  };

  const loadPhotoExclusions = async (cursor?: string, append = false) => {
    setLoadingExclusions(true);
    try {
      const page = await apiJson<{ items: PhotoExclusion[]; nextCursor: string | null }>(
        settingsEndpoint.photoExclusions(cursor),
      );
      setExclusions((current) =>
        append
          ? [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()]
          : page.items,
      );
      setExclusionCursor(page.nextCursor);
    } finally {
      setLoadingExclusions(false);
    }
  };

  useEffect(() => {
    if (area !== 'settings') {
      void loadSources().catch((error) =>
        announce(
          errorCopy(error, 'No se pudieron cargar las fuentes configuradas. Reintenta.'),
          'error',
        ),
      );
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const driveResult = params.get('oauth');
    if (driveResult === 'drive-connected') {
      announce(
        'Drive se ha conectado. Las fuentes de la misma cuenta vuelven a estar disponibles.',
        'success',
      );
      window.history.replaceState(null, '', window.location.pathname);
    } else if (driveResult === 'drive-denied') {
      announce(
        'No se concedió acceso a Drive. Tus fuentes siguen guardadas; puedes intentarlo de nuevo.',
        'warning',
      );
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [area, loadSources]);

  useEffect(() => {
    if (area !== 'organize') return;
    if (!sources.length) {
      setSourceOverviews({});
      setLoadingOverviews(false);
      return;
    }
    const controller = new AbortController();
    setLoadingOverviews(true);
    void loadSourceOverviews(sources, controller.signal).catch(() => {
      if (!controller.signal.aborted) setLoadingOverviews(false);
    });
    return () => controller.abort();
  }, [area, loadSourceOverviews, sources]);

  useEffect(() => {
    if (area !== 'organize') return;
    void loadPhotoExclusions().catch((error) =>
      announce(errorCopy(error, 'No se pudo cargar la papelera de fotos excluidas.'), 'error'),
    );
  }, [area]);

  useEffect(() => {
    if (area !== 'organize' || navigationReadyRef.current) return;
    const restored = parseOrganizeLocation(window.location.href);
    restoredLocationRef.current = restored;
    try {
      const saved = sessionStorage.getItem(ORGANIZE_RETURN_KEY);
      if (saved) {
        const context = JSON.parse(saved) as { href?: unknown; scrollY?: unknown };
        const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (
          context.href === currentHref &&
          typeof context.scrollY === 'number' &&
          Number.isFinite(context.scrollY) &&
          context.scrollY >= 0
        )
          organizeReturnRestoreRef.current = { href: currentHref, scrollY: context.scrollY };
        else sessionStorage.removeItem(ORGANIZE_RETURN_KEY);
      }
    } catch {
      sessionStorage.removeItem(ORGANIZE_RETURN_KEY);
    }
    setSelectedSourceId(restored.sourceId);
    setOrganizeTab(restored.task);
    setPhotoFilter(restored.classification);
    photoFilterRef.current = restored.classification;
    setSearchText(restored.query);
    setAppliedSearch(restored.query);
    setSearchFolderId(restored.searchFolderId);
    if (restored.task === 'pending') {
      pendingViewRef.current = true;
      setPendingView(true);
      setPhotoFilter('UNCLASSIFIED');
      photoFilterRef.current = 'UNCLASSIFIED';
    }
    navigationReadyRef.current = true;
  }, [area]);

  useEffect(() => {
    if (area !== 'organize' || !navigationReadyRef.current) return;
    const pop = () => {
      const restored = parseOrganizeLocation(window.location.href);
      navigationWriteRef.current = true;
      restoredLocationRef.current = restored;
      setSelectedSourceId(restored.sourceId);
      setSelectedFolderId(restored.folderId);
      selectedFolderIdRef.current = restored.folderId;
      setOrganizeTab(restored.task);
      const nextFilter = restored.task === 'pending' ? 'UNCLASSIFIED' : restored.classification;
      setPhotoFilter(nextFilter);
      photoFilterRef.current = nextFilter;
      setPendingView(restored.task === 'pending');
      pendingViewRef.current = restored.task === 'pending';
      setSearchMode(Boolean(restored.query));
      setSearchText(restored.query);
      setAppliedSearch(restored.query);
      setSearchFolderId(restored.searchFolderId);
      setSelectedPhotos(new Set());
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [area]);

  useEffect(() => {
    if (area !== 'organize' || !navigationReadyRef.current || !activeSource || loadingArchive)
      return;
    if (navigationWriteRef.current) {
      navigationWriteRef.current = false;
      return;
    }
    const task = organizeTab;
    const state: OrganizeLocation = {
      sourceId: activeSource.id,
      folderId: selectedFolderId,
      task,
      classification: task === 'pending' ? 'UNCLASSIFIED' : photoFilter,
      query: searchMode ? appliedSearch : '',
      searchFolderId: searchMode ? searchFolderId : 'ALL',
    };
    const nextUrl = writeOrganizeLocation(window.location.href, state);
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.pushState(null, '', nextUrl);
  }, [
    activeSource?.id,
    area,
    appliedSearch,
    organizeTab,
    photoFilter,
    searchFolderId,
    searchMode,
    selectedFolderId,
  ]);

  useEffect(() => {
    const sourceId = activeSource?.id ?? null;
    activeSourceIdRef.current = sourceId;
    selectedFolderIdRef.current = null;
    photoFilterRef.current = 'ALL';
    pendingViewRef.current = false;
    searchKeyRef.current = '';
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
    setSearchMode(false);
    setSearchText('');
    setAppliedSearch('');
    setSearchFolderId('ALL');
    setConfirmRemovePhotos(false);
    setConfirmRemoveRule(false);
    setConfirmRemoveSourceId(null);
    setConfirmDate(false);
    setManualEditorOpen(false);
    setDateError('');
    setManualError('');
    setLoadingPhotos(false);
    setLoadingArchive(Boolean(sourceId));
    if (!sourceId) return;
    void loadArchive(sourceId)
      .then(async () => {
        if (activeSourceIdRef.current !== sourceId) return;
        const restored = restoredLocationRef.current;
        if (restored?.sourceId === sourceId && restored.task === 'pending') {
          await loadPending(sourceId);
          if (activeSourceIdRef.current === sourceId)
            document.getElementById('photos-workspace')?.scrollIntoView({ block: 'start' });
        } else if (restored?.sourceId === sourceId && restored.query) {
          setSearchMode(true);
          await loadSourcePhotos(
            sourceId,
            restored.query,
            restored.searchFolderId,
            restored.classification,
          );
        }
      })
      .catch((error) => {
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
    if (searchMode) {
      void loadSourcePhotos(sourceId, appliedSearch, searchFolderId, photoFilter).catch((error) => {
        if (!isAbortError(error) && activeSourceIdRef.current === sourceId)
          announce(errorCopy(error, 'No se pudieron buscar las fotos. Reintenta.'), 'error');
      });
      return;
    }
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
  }, [
    activeSource?.id,
    selectedFolderId,
    photoFilter,
    pendingView,
    searchMode,
    appliedSearch,
    searchFolderId,
  ]);

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
    setFolderDatePreview(null);
  }, [selectedFolderId]);

  useEffect(() => {
    setManualDatePreview(null);
  }, [manualYear, manualMonth, selectedPhotos]);

  useEffect(() => {
    if (area !== 'organize') return;
    const controller = new AbortController();
    let timer: number | null = null;
    let polling = false;
    const pollActiveRuns = async () => {
      if (controller.signal.aborted || polling) return;
      const activeRuns = Object.entries(sourceOverviewsRef.current).flatMap(
        ([sourceId, overview]) =>
          overview.latestRun && isSyncActive(overview.latestRun)
            ? [{ sourceId, run: overview.latestRun }]
            : [],
      );
      if (!activeRuns.length) {
        if (!controller.signal.aborted) timer = window.setTimeout(pollActiveRuns, 2500);
        return;
      }
      polling = true;
      await Promise.allSettled(
        activeRuns.map(async ({ sourceId, run: currentRun }) => {
          try {
            const nextRun = await apiJson<SyncRun>(settingsEndpoint.run(currentRun.id), {
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            setSourceOverviews((current) => {
              if (current[sourceId]?.latestRun?.id !== currentRun.id) return current;
              return {
                ...current,
                [sourceId]: {
                  ...current[sourceId]!,
                  latestRun: nextRun,
                  error: false,
                  pollError: false,
                },
              };
            });
            if (activeSourceIdRef.current === sourceId)
              setRun((current) => (current?.id === currentRun.id ? nextRun : current));
          } catch (error) {
            if (!isAbortError(error) && !controller.signal.aborted)
              setSourceOverviews((current) => {
                if (current[sourceId]?.latestRun?.id !== currentRun.id) return current;
                return {
                  ...current,
                  [sourceId]: { ...current[sourceId]!, pollError: true },
                };
              });
          }
        }),
      );
      polling = false;
      if (!controller.signal.aborted) timer = window.setTimeout(pollActiveRuns, 2500);
    };
    void pollActiveRuns();
    return () => {
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [area]);

  useEffect(() => {
    const sourceId = activeSource?.id;
    if (!sourceId) {
      setIssues([]);
      setIssueCursor(null);
      setIssueTotalCount(0);
      setLoadingIssues(false);
      setIssuesError(false);
      return;
    }
    const controller = new AbortController();
    setIssues([]);
    setIssueCursor(null);
    setIssueTotalCount(0);
    setLoadingIssues(true);
    setIssuesError(false);
    void apiJson<{
      items: SyncIssue[];
      nextCursor: string | null;
      totalCount: number;
      countsByCode: Record<string, number>;
    }>(settingsEndpoint.sourceIssues(sourceId), {
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted && activeSourceIdRef.current === sourceId) {
          setIssues(page.items);
          setIssueCursor(page.nextCursor);
          setIssueTotalCount(page.totalCount);
          setLoadingIssues(false);
          setIssuesError(false);
        }
      })
      .catch((error) => {
        if (!isAbortError(error) && activeSourceIdRef.current === sourceId) {
          setIssues([]);
          setLoadingIssues(false);
          setIssuesError(true);
        }
      });
    if (run?.status === 'SUCCEEDED') {
      announce(
        `Revisión completa: ${pluralize(run.indexedCount ?? 0, 'foto indexada', 'fotos indexadas')}. Las fotos que ya no están en Drive se retiraron solo del índice local.`,
        'success',
      );
      if (activeSourceIdRef.current === sourceId) {
        void loadArchive(sourceId);
        if (selectedFolderIdRef.current)
          void loadPhotos(sourceId, selectedFolderIdRef.current, photoFilterRef.current);
      }
      void loadSources();
    } else if (run?.status === 'PARTIAL') {
      announce(
        'La revisión quedó incompleta. No retiramos del índice fotos cuya ausencia no pudimos confirmar.',
        'warning',
      );
      if (activeSourceIdRef.current === sourceId) {
        void loadArchive(sourceId);
        if (selectedFolderIdRef.current)
          void loadPhotos(sourceId, selectedFolderIdRef.current, photoFilterRef.current);
      }
      void loadSources();
    } else if (run?.status === 'FAILED') {
      announce(
        'No se pudo completar la revisión. No se confirmaron ausencias en el archivo; revisa la incidencia. Drive no se modificó.',
        'error',
      );
      if (activeSourceIdRef.current === sourceId) {
        void loadArchive(sourceId);
        if (selectedFolderIdRef.current)
          void loadPhotos(sourceId, selectedFolderIdRef.current, photoFilterRef.current);
      }
      void loadSources();
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
    const driveFolderId = driveFolderIdFromInput(folderId);
    if (!connection || !driveFolderId || driveFolderId === 'root') {
      announce('Indica una carpeta concreta. Nunca exploramos todo tu Drive.', 'warning');
      return;
    }
    setBusyAction('browse');
    try {
      const page = await apiJson<{ items: DriveFolder[] }>(
        settingsEndpoint.folderChildren(connection.id, driveFolderId),
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
    const driveFolderId = driveFolderIdFromInput(folderId);
    if (!connection || !driveFolderId || driveFolderId === 'root') return;
    setBusyAction('create-source');
    try {
      await apiJson<Source>(settingsEndpoint.createSource, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oauthConnectionId: connection.id,
          driveFolderId,
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

  const removeSource = async (source: Source) => {
    if (source.id === activeSource?.id && isSyncActive(run)) return;
    setBusyAction('remove-source');
    try {
      await apiJson<void>(settingsEndpoint.removeSource(source.id), { method: 'DELETE' });
      setConfirmRemoveSourceId(null);
      setSources((current) => current.filter((item) => item.id !== source.id));
      setSelectedSourceId(null);
      announce(
        `“${source.name}” y su índice local se han quitado. Drive no se ha modificado; puedes añadir la carpeta de nuevo más adelante.`,
        'success',
      );
      void loadSources().catch(() =>
        announce(
          'La carpeta y su índice se quitaron correctamente. No se pudo actualizar la lista de fuentes; recarga Ajustes para verla al día.',
          'warning',
        ),
      );
    } catch (error) {
      announce(errorCopy(error, 'No se pudo quitar la carpeta del archivo. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const sync = async (source: Source = activeSource!) => {
    const sourceRun =
      source?.id === activeSource?.id
        ? run
        : (sourceOverviews[source?.id ?? '']?.latestRun ?? null);
    if (!source || busy || isSyncActive(sourceRun)) return;
    setSelectedSourceId(source.id);
    setBusyAction('sync');
    try {
      const nextRun = await apiJson<SyncRun>(settingsEndpoint.sync(source.id), { method: 'POST' });
      setRun(nextRun);
      setSourceOverviews((current) => ({
        ...current,
        [source.id]: {
          summary: current[source.id]?.summary ?? null,
          latestRun: nextRun,
          error: current[source.id]?.error ?? false,
        },
      }));
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
    if (removing.current || busy || !selectedPhotos.size) return;
    removing.current = true;
    photoRequestRef.current?.abort();
    photoRequestRef.current = null;
    setLoadingPhotos(false);
    setBusyAction('remove-photos');
    setConfirmRemovePhotos(false);
    try {
      const result = await removePhotosFromArchive([...selectedPhotos]);
      const retained = photos.filter((photo) => result.pending.has(photo.id));
      setPhotos((current) => current.filter((photo) => !result.completed.has(photo.id)));
      setSelectedPhotos(result.pending);
      // Offset cursors from before removal no longer describe the current collection.
      setPhotoCursor(null);
      const summary = `${result.removed} fotos retiradas; ${result.pending.size} pendientes. Drive no se modificó.`;
      announce(
        result.error
          ? errorCopy(result.error, summary)
          : `${summary}${result.pending.size ? ' Reintenta las pendientes.' : ''}`,
      );
      try {
        await refreshPhotoView(retained);
        if (activeSource) await loadArchive(activeSource.id);
      } catch {
        announce(
          `${summary} No se pudo actualizar la vista. Usa «Actualizar fotos»; las pendientes siguen seleccionadas.`,
        );
      }
    } finally {
      removing.current = false;
      setBusyAction(null);
    }
  };

  const refreshPhotoView = async (retained: IndexedPhoto[]) => {
    if (!activeSource) return;
    if (pendingView) await loadPending(activeSource.id, undefined, false, retained);
    else if (searchMode)
      await loadSourcePhotos(
        activeSource.id,
        appliedSearch,
        searchFolderId,
        photoFilter,
        undefined,
        false,
        retained,
      );
    else if (selectedFolderId)
      await loadPhotos(activeSource.id, selectedFolderId, photoFilter, undefined, false, retained);
  };

  const refreshPhotos = async () => {
    if (busy || !activeSource || (!pendingView && !searchMode && !selectedFolderId)) return;
    setBusyAction('refresh-photos');
    try {
      await refreshPhotoView(photos.filter((photo) => selectedPhotos.has(photo.id)));
    } catch (error) {
      announce(errorCopy(error, 'No se pudieron actualizar las fotos.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const applyFolderDate = async () => {
    if (!selectedFolder || !folderDatePreview) return;
    setConfirmDate(false);
    setBusyAction('folder-date');
    try {
      const result = await apiJson<{ affectedCount: number }>(
        settingsEndpoint.folderDate(selectedFolder.id),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            year: Number(dateYear),
            ...(dateMonth ? { month: Number(dateMonth) } : {}),
            precision: dateMonth ? 'MONTH' : 'YEAR',
            scope: ruleScope,
            reason: 'Fecha configurada desde la organización del archivo',
          }),
        },
      );
      setFolderDatePreview(null);
      if (activeSource) await loadArchive(activeSource.id);
      if (activeSource)
        await loadPhotos(activeSource.id, selectedFolder.id, photoFilterRef.current);
      if (result.affectedCount > 0)
        setDateChangeResult({
          count: result.affectedCount,
          year: Number(dateYear),
          month: dateMonth ? Number(dateMonth) : null,
          scopeLabel: selectedFolder.name,
        });
      announce(
        `Fecha de carpeta actualizada en ${pluralize(result.affectedCount, 'foto', 'fotos')}. Las fotos originales no se modificaron.`,
        'success',
      );
    } catch (error) {
      announce(
        errorCopy(error, 'No se pudo guardar la fecha. Revisa los campos y reintenta.'),
        'error',
      );
      setConfirmDate(true);
    } finally {
      setBusyAction(null);
    }
  };

  const previewFolderDate = async () => {
    if (!selectedFolder) return;
    const year = Number(dateYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      setDateError('Selecciona un año entre 1900 y 2100.');
      return;
    }
    setDateError('');
    setBusyAction('folder-date-preview');
    try {
      const preview = await apiJson<FolderDatePreview>(
        settingsEndpoint.folderDatePreview(selectedFolder.id),
        {
          method: 'POST',
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
      setFolderDatePreview(preview);
      setConfirmDate(true);
    } catch (error) {
      announce(errorCopy(error, 'No se pudo calcular qué fotos cambiarían. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const previewManualDate = async () => {
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
    setManualError('');
    setBusyAction('manual-date-preview');
    try {
      const preview = await apiJson<ManualDatePreview>(settingsEndpoint.manualDatePreview, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoIds: [...selectedPhotos],
          year,
          ...(manualMonth ? { month: Number(manualMonth) } : {}),
          precision: manualMonth ? 'MONTH' : 'YEAR',
          reason: 'Corrección manual desde la organización del archivo',
        }),
      });
      setManualDatePreview(preview);
    } catch (error) {
      announce(errorCopy(error, 'No se pudo calcular qué fotos cambiarían. Reintenta.'), 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const applyManualDate = async () => {
    if (!selectedPhotos.size || !manualDatePreview) return;
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
    const changedCount = manualDatePreview.willChangeCount;
    const changedScopeLabel = selectedFolder?.name ?? 'las fotos seleccionadas';
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
      setManualDatePreview(null);
      setSelectedPhotos(new Set());
      if (activeSource && pendingView) await loadPending(activeSource.id);
      else if (activeSource && searchMode)
        await loadSourcePhotos(activeSource.id, appliedSearch, searchFolderId, photoFilter);
      else if (activeSource && selectedFolderId)
        await loadPhotos(activeSource.id, selectedFolderId, photoFilter);
      if (activeSource) await loadArchive(activeSource.id);
      if (changedCount > 0)
        setDateChangeResult({
          count: changedCount,
          year,
          month: manualMonth ? Number(manualMonth) : null,
          scopeLabel: changedScopeLabel,
        });
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
    if (busy) return;
    if (selectedFolderIdRef.current === folderIdValue && !pendingViewRef.current) return;
    photoRequestRef.current?.abort();
    photoRequestRef.current = null;
    selectedFolderIdRef.current = folderIdValue;
    pendingViewRef.current = false;
    searchKeyRef.current = '';
    setSearchMode(false);
    setPendingView(false);
    setPhotos([]);
    setPhotoCursor(null);
    setSelectedPhotos(new Set());
    setLoadingPhotos(true);
    setSelectedFolderId(folderIdValue);
    setOrganizeTab('folders');
  };

  const beginArchiveSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!activeSource || busy) return;
    const query = searchText.trim();
    if (query.length > 120) {
      announce('La búsqueda admite hasta 120 caracteres.', 'warning');
      return;
    }
    photoRequestRef.current?.abort();
    photoRequestRef.current = null;
    searchKeyRef.current = '';
    pendingViewRef.current = false;
    setPendingView(false);
    setSearchMode(true);
    setAppliedSearch(query);
    setPhotos([]);
    setPhotoCursor(null);
    setSelectedPhotos(new Set());
    setLoadingPhotos(true);
  };

  const restoreExclusion = async (exclusion: PhotoExclusion) => {
    if (busy || restoringExclusionId) return;
    setRestoringExclusionId(exclusion.id);
    setBusyAction('restore-exclusion');
    try {
      await apiJson<void>(settingsEndpoint.restorePhotoExclusion(exclusion.id), {
        method: 'DELETE',
      });
      const restoredAt = new Date().toISOString();
      setExclusions((current) =>
        current.map((item) => (item.id === exclusion.id ? { ...item, restoredAt } : item)),
      );
      announce(
        `${exclusion.fileName ?? 'La foto'} se incluirá en la próxima revisión de Drive. Su corrección manual de fecha se conservará. Drive no se ha modificado.`,
        'success',
      );
    } catch (error) {
      announce(errorCopy(error, 'No se pudo restaurar esta foto. Reintenta.'), 'error');
    } finally {
      setRestoringExclusionId(null);
      setBusyAction(null);
    }
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLElement>, folder: IndexedFolder) => {
    if (busy) return;
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
        {area === 'organize' ? (
          <>
            <h1>Organizar recuerdos</h1>
            <p>
              Añade tus carpetas, revisa las fotos que necesitan atención y ponles fecha para
              encontrarlas en la cronología. Google Drive solo se consulta; tus archivos originales
              no se modifican.
            </p>
          </>
        ) : (
          <>
            <h1>Ajustes</h1>
            <p>Gestiona la conexión con Google y consulta cómo se protege tu archivo privado.</p>
          </>
        )}
      </header>

      {area === 'organize' && (
        <nav className={styles.organizeNav} aria-label="Tareas de organización">
          {(
            [
              ['folders', 'Mis carpetas'],
              [
                'pending',
                `Fotos por revisar${summary?.unclassified ? ` · ${summary.unclassified.toLocaleString('es-ES')}` : ''}`,
              ],
              ['dates', 'Corregir fechas'],
            ] as const
          ).map(([tab, label]) => (
            <button
              type="button"
              key={tab}
              className={`${styles.organizeTab} ${organizeTab === tab ? styles.organizeTabActive : ''}`}
              aria-pressed={organizeTab === tab}
              onClick={() => openOrganizeTab(tab)}
              disabled={busy || (tab !== 'folders' && !activeSource)}
            >
              {label}
            </button>
          ))}
          {connection && (
            <a
              className={styles.taskLink}
              href="#source-setup"
              onClick={() => {
                setOrganizeTab('folders');
                const setup = document.getElementById('source-setup');
                if (setup instanceof HTMLDetailsElement) setup.open = true;
              }}
            >
              Añadir una carpeta
            </a>
          )}
        </nav>
      )}

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

      {area === 'organize' && dateChangeResult && (
        <section className={styles.dateResult} aria-labelledby="date-result-title" role="status">
          <div>
            <p className={styles.dateResultEyebrow}>Corrección guardada</p>
            <h2 id="date-result-title">
              Fecha actualizada en {pluralize(dateChangeResult.count, 'foto', 'fotos')}
            </h2>
            <p>
              Ya puedes consultar {dateChangeResult.month ? 'ese mes' : 'ese año'} en la cronología.
              Allí también aparecen fotos del mismo periodo de otras carpetas.
            </p>
          </div>
          <div className={styles.dateResultActions}>
            <a
              className={styles.primaryButton}
              href={timelineHref({ year: dateChangeResult.year, month: dateChangeResult.month })}
              onClick={(event) => openTimelineResult(event, dateChangeResult)}
            >
              Ver en la cronología
            </a>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                setDateChangeResult(null);
                setOrganizeTab('pending');
                if (activeSource) void loadPending(activeSource.id);
              }}
            >
              Seguir revisando
            </button>
            {selectedFolderId && (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => {
                  setDateChangeResult(null);
                  setOrganizeTab('folders');
                  pendingViewRef.current = false;
                  setPendingView(false);
                  requestAnimationFrame(() => {
                    document.getElementById('photos-workspace')?.scrollIntoView({ block: 'start' });
                    [...document.querySelectorAll<HTMLElement>('[data-folder-id]')]
                      .find((element) => element.dataset.folderId === selectedFolderId)
                      ?.focus({ preventScroll: true });
                  });
                }}
              >
                Volver a la carpeta
              </button>
            )}
          </div>
        </section>
      )}

      {area === 'settings' && (
        <>
          <section className={styles.connectionSection} aria-labelledby="drive-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="drive-title">Conexión con Google Drive</h2>
                <p>
                  Se usa únicamente para leer las carpetas que añadas como fuentes de fotografías.
                </p>
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
            {!connection && (
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void reconnectDrive()}
                  disabled={busy}
                >
                  {busyAction === 'connect-drive' && (
                    <span className={styles.spinner} aria-hidden="true" />
                  )}
                  Conectar o reconectar Drive
                </button>
                <p>Se solicitará acceso de solo lectura. Tus fuentes existentes se conservarán.</p>
              </div>
            )}
            {confirmDisconnect && (
              <div
                className={styles.confirmationPanel}
                role="group"
                aria-labelledby="disconnect-title"
              >
                <div>
                  <h3 id="disconnect-title">Desconectar el acceso de lectura</h3>
                  <p>
                    El índice permanecerá, pero no podrás abrir originales ni buscar cambios hasta
                    que vuelvas a conectar Drive.
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
          <section className={styles.privacySection} aria-labelledby="privacy-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="privacy-title">Cuenta y privacidad</h2>
                <p>{userName || 'Tu cuenta'}</p>
              </div>
              {userEmail && <span className={styles.accountEmail}>{userEmail}</span>}
            </div>
            <ul className={styles.privacyList}>
              <li>Solo se exploran las carpetas de Drive que eliges expresamente.</li>
              <li>La conexión de Drive se usa con permiso de solo lectura.</li>
              <li>
                Quitar fotos o fuentes elimina su índice local; los archivos originales permanecen
                intactos en Drive.
              </li>
            </ul>
            <a className={styles.secondaryButton} href="/organizar">
              Volver a Organizar
            </a>
          </section>
        </>
      )}

      {area === 'organize' && !connection && (
        <section className={styles.reconnectNotice} aria-labelledby="reconnect-title">
          <div>
            <h2 id="reconnect-title">Drive necesita reconectarse</h2>
            <p>
              Tus fuentes y correcciones siguen guardadas. Reconecta la misma cuenta desde Ajustes;
              no iniciaremos una revisión automáticamente.
            </p>
          </div>
          <a className={styles.primaryButton} href="/settings#drive-title">
            Ir a reconectar Drive
          </a>
        </section>
      )}

      {area === 'organize' && connection && (
        <details
          className={styles.sourceSetup}
          id="source-setup"
          open={!loadingSources && !activeSource}
        >
          <summary className={styles.sourceSetupSummary}>
            Añadir una carpeta de fotos
            <span>La carpeta siempre la eliges tú</span>
          </summary>
          <section className={styles.sourceSetupContent} aria-labelledby="source-picker-title">
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="source-picker-title">Elige una carpeta de Drive</h2>
                <p>
                  Elige una carpeta concreta. Buscaremos sus fotos y las de sus subcarpetas; Drive
                  no se modifica.
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
                  <strong>Fotos y vídeos de una carpeta</strong>
                  <small>
                    Para fotos que has organizado tú. También buscaremos fechas en la información de
                    las fotos y en los nombres de sus carpetas.
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
                    Elige esta opción si guardaste en Drive la descarga completa de Google Fotos.
                    Puede incluir archivos de datos que ayudan a recuperar cuándo se hicieron las
                    fotos.
                  </small>
                </span>
              </label>
            </fieldset>

            <form className={styles.sourceForm} onSubmit={(event) => void browse(event)}>
              <label htmlFor="source-name">
                Nombre para reconocer la carpeta
                <input
                  id="source-name"
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  placeholder="Fotos familiares antiguas"
                  maxLength={200}
                />
              </label>
              <label htmlFor="folder-id">
                Enlace de la carpeta de Google Drive
                <span className={styles.fieldHint}>
                  Copia y pega el enlace de la carpeta. También puedes pegar solo el identificador.
                  Nunca exploramos todo tu Drive.
                </span>
                <div className={styles.inputAction}>
                  <input
                    id="folder-id"
                    value={folderId}
                    onChange={(event) => {
                      setFolderId(event.target.value);
                      setDriveFolders([]);
                    }}
                    placeholder="https://drive.google.com/drive/folders/…"
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
                Añadir carpeta
              </button>
              <p>Después podrás ver sus fotos, revisar pendientes y corregir sus fechas.</p>
            </div>
          </section>
        </details>
      )}

      {area === 'organize' && (
        <section className={styles.sourcesOverview} aria-labelledby="sources-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="sources-title">
                {area === 'organize' ? 'Mis carpetas' : 'Fuentes de fotografías'}
              </h2>
              <p>
                {area === 'organize'
                  ? 'Carpetas que has añadido, su última revisión y las fotos que necesitan atención.'
                  : 'Estado de conexión, última revisión y fotos que todavía necesitan atención.'}
              </p>
            </div>
            {connection && (
              <a
                className={styles.taskLink}
                href="#source-setup"
                onClick={() => {
                  const setup = document.getElementById('source-setup');
                  if (setup instanceof HTMLDetailsElement) setup.open = true;
                }}
              >
                Añadir carpeta
              </a>
            )}
          </div>
          {loadingSources ? (
            <p className={styles.loadingLine} role="status">
              Cargando fuentes…
            </p>
          ) : sources.length ? (
            <ul className={styles.sourceOverviewList}>
              {sources.map((source) => {
                const overview = sourceOverviews[source.id];
                const latestRun = overview?.latestRun ?? null;
                const displayedStatus =
                  source.status === 'ACTIVE' && !connection ? 'DISCONNECTED' : source.status;
                const sourceIsActive = displayedStatus === 'ACTIVE';
                const sourceSyncing = isSyncActive(latestRun);
                const statusClass = `sourceStatus_${displayedStatus.toLowerCase()}`;
                return (
                  <li className={styles.sourceOverview} key={source.id}>
                    <div className={styles.sourceOverviewMain}>
                      <div className={styles.sourceOverviewTitle}>
                        <div>
                          <h3>{source.name}</h3>
                          <p>
                            {source.type === 'GOOGLE_TAKEOUT'
                              ? 'Google Drive · Exportación de Google Fotos'
                              : 'Google Drive · Carpeta de fotos'}
                          </p>
                        </div>
                        <span
                          className={`${styles.sourceStatus} ${styles[statusClass] ?? ''}`}
                          role="status"
                        >
                          {sourceStatusLabel(displayedStatus)}
                        </span>
                      </div>
                      <details className={styles.sourceLocation}>
                        <summary>Ver identificador de Drive</summary>
                        <code>{source.driveFolderId}</code>
                      </details>
                      {overview?.summary ? (
                        <dl className={styles.sourceOverviewStats}>
                          <div>
                            <dt>Fotos incluidas</dt>
                            <dd>{overview.summary.total.toLocaleString('es-ES')}</dd>
                          </div>
                          <div>
                            <dt>Fotos por revisar</dt>
                            <dd>{overview.summary.unclassified.toLocaleString('es-ES')}</dd>
                          </div>
                          <div>
                            <dt>Incidencias recientes</dt>
                            <dd>{(latestRun?.issueCount ?? 0).toLocaleString('es-ES')}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p
                          className={styles.sourceOverviewHint}
                          role={overview?.error ? 'alert' : undefined}
                        >
                          {overview?.error
                            ? 'No se pudo cargar el estado. Vuelve a intentarlo.'
                            : loadingOverviews
                              ? 'Cargando el estado de esta fuente…'
                              : 'Estado de la fuente no disponible.'}
                        </p>
                      )}
                      <p className={styles.sourceOverviewRun}>
                        {latestRun
                          ? `${syncStatusLabel(latestRun.status)} · ${formatRunDate(latestRun.createdAt)}`
                          : overview?.summary
                            ? 'Todavía no se ha iniciado una revisión.'
                            : null}
                      </p>
                      {sourceSyncing && latestRun ? (
                        <div className={styles.sourceProgress} aria-live="polite">
                          <p className={styles.sourceProgressLine}>
                            {syncPhaseLabel(latestRun.phase)}
                            {latestRun.foundCount
                              ? ` · ${pluralize(latestRun.processedCount ?? 0, 'foto revisada', 'fotos revisadas')} de ${latestRun.foundCount.toLocaleString('es-ES')}`
                              : ' · Aún buscando fotografías'}
                          </p>
                          {latestRun.foundCount ? (
                            <progress
                              max={latestRun.foundCount}
                              value={Math.min(latestRun.processedCount ?? 0, latestRun.foundCount)}
                              aria-label={`Avance de revisión de ${source.name}`}
                            />
                          ) : (
                            <progress
                              className={styles.indeterminateProgress}
                              aria-label={`Preparando revisión de ${source.name}`}
                            />
                          )}
                        </div>
                      ) : latestRun && syncResultSummary(latestRun) ? (
                        <p className={styles.sourceOverviewHint}>{syncResultSummary(latestRun)}</p>
                      ) : null}
                      {sourceSyncing && overview?.pollError && (
                        <p className={styles.sourceOverviewHint} role="status">
                          No se pudo consultar el avance; la revisión puede seguir activa.{' '}
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => void loadSources()}
                            disabled={loadingSources}
                          >
                            Actualizar estado
                          </button>
                        </p>
                      )}
                    </div>
                    <div className={styles.sourceOverviewActions}>
                      {overview?.error && (
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => void loadSources()}
                          disabled={loadingSources}
                        >
                          Reintentar estado
                        </button>
                      )}
                      {sourceIsActive ? (
                        <>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setSelectedSourceId(source.id);
                              document.getElementById('archive-title')?.scrollIntoView({
                                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                                  .matches
                                  ? 'auto'
                                  : 'smooth',
                              });
                            }}
                            disabled={busy || loadingSources}
                          >
                            {latestRun?.status === 'FAILED' || latestRun?.status === 'PARTIAL'
                              ? 'Ver resultado'
                              : 'Ver fotos'}
                          </button>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => void sync(source)}
                            disabled={busy || sourceSyncing || loadingArchive}
                          >
                            {sourceSyncing && (
                              <span className={styles.spinner} aria-hidden="true" />
                            )}
                            {sourceSyncing ? 'Revisión en curso' : 'Buscar cambios'}
                          </button>
                        </>
                      ) : displayedStatus === 'DISCONNECTED' ? (
                        <>
                          <a className={styles.primaryButton} href="/settings#drive-title">
                            Reconectar Drive
                          </a>
                          <button
                            type="button"
                            className={styles.textButton}
                            onClick={() => setConfirmRemoveSourceId(source.id)}
                            disabled={busy}
                          >
                            Quitar fuente
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => setConfirmRemoveSourceId(source.id)}
                          disabled={busy}
                        >
                          Quitar fuente
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              <h3>Aún no hay carpetas en el archivo</h3>
              <p>
                {connection
                  ? 'Añade una carpeta concreta de Drive para crear la primera fuente.'
                  : 'Conecta Drive desde Ajustes para volver a acceder a las carpetas elegidas.'}
              </p>
              {connection ? (
                <a
                  className={styles.primaryButton}
                  href="#source-setup"
                  onClick={() => {
                    const setup = document.getElementById('source-setup');
                    if (setup instanceof HTMLDetailsElement) setup.open = true;
                  }}
                >
                  Añadir una carpeta
                </a>
              ) : (
                <a className={styles.primaryButton} href="/settings#drive-title">
                  Ir a Ajustes
                </a>
              )}
            </div>
          )}
        </section>
      )}

      {area === 'organize' &&
        (organizeTab === 'pending' && activeSource ? (
          <section
            className={styles.reviewQueue}
            id="pending-queue"
            aria-labelledby="pending-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="pending-title">Fotos por revisar</h2>
                <p>
                  {activeSource.name}. Aquí se reúnen las fotos sin fecha y los problemas detectados
                  en la última revisión de esta carpeta.
                </p>
              </div>
              {activeSource && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void sync(activeSource)}
                  disabled={busy || isSyncActive(run)}
                >
                  {isSyncActive(run) && <span className={styles.spinner} aria-hidden="true" />}
                  {isSyncActive(run) ? 'Revisión en curso' : 'Volver a revisar carpeta'}
                </button>
              )}
            </div>

            {loadingArchive || loadingIssues || !summary ? (
              <p className={styles.loadingLine} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                Cargando fotos y resultado de la última revisión…
              </p>
            ) : null}

            {issuesError && (
              <div className={styles.reviewQueueError} role="alert">
                <p>
                  No pudimos cargar los problemas de la última revisión; todavía no podemos
                  confirmar que esté todo revisado.
                </p>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => activeSource && void loadArchive(activeSource.id)}
                  disabled={busy || loadingArchive}
                >
                  Volver a cargar
                </button>
              </div>
            )}

            {!loadingArchive && summary?.unclassified ? (
              <div className={styles.reviewQueueRow}>
                <div>
                  <h3>Falta una fecha</h3>
                  <p>
                    {pluralize(summary.unclassified, 'foto no tiene', 'fotos no tienen')} un año o
                    mes para aparecer en la cronología.
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void loadPending(activeSource.id)}
                  disabled={busy || loadingArchive || loadingPhotos}
                >
                  Ver fotos sin fecha
                </button>
              </div>
            ) : null}

            {!loadingIssues && issueTotalCount > 0 ? (
              <div className={styles.reviewIssues}>
                <h3>Problemas que siguen pendientes</h3>
                <p className={styles.reviewQueueHint}>
                  Abrir una carpeta solo te lleva al contexto; no cierra el problema. Solo una
                  revisión completa y exitosa puede confirmar ausencias en el archivo y retirar
                  incidencias. Drive no se modifica.
                </p>
                {issueTotalCount > issues.length ? (
                  <p className={styles.reviewQueueHint}>
                    {pluralize(
                      issueTotalCount,
                      'problema pendiente detectado',
                      'problemas pendientes detectados',
                    )}
                    . Se muestra la primera página; las incidencias que una revisión completa ya
                    resolvió no aparecen aquí.
                  </p>
                ) : null}
                {[
                  { key: 'folders', title: 'Problemas de carpeta', items: issueAreas.folders },
                  { key: 'photos', title: 'Problemas de foto', items: issueAreas.photos },
                  { key: 'review', title: 'Otros problemas de revisión', items: issueAreas.review },
                ]
                  .filter((section) => section.items.length > 0)
                  .map((section) => (
                    <section className={styles.reviewIssueSection} key={section.key}>
                      <h4>{section.title}</h4>
                      <ul className={styles.reviewIssueList}>
                        {section.items.map((issue) => {
                          const folder =
                            folders.find((candidate) => candidate.id === issue.indexedFolderId) ??
                            folders.find(
                              (candidate) => candidate.driveFolderId === issue.driveFolderId,
                            );
                          const hasFolderAction = Boolean(folder && issue.driveFolderId);
                          return (
                            <li key={issue.id}>
                              <div>
                                <strong>{issueCopy(issue)}</strong>
                                <span>{issueActionCopy(issue)}</span>
                                {issue.fileName && (
                                  <span>
                                    Foto: {issue.fileName}
                                    {folder ? ` · ${folder.path.join(' / ')}` : ''}
                                  </span>
                                )}
                                {!issue.fileName && folder && (
                                  <span>Carpeta: {folder.path.join(' / ')}</span>
                                )}
                              </div>
                              {hasFolderAction ? (
                                <button
                                  type="button"
                                  className={styles.textButton}
                                  onClick={() => openIssueFolder(issue)}
                                  disabled={busy || loadingPhotos}
                                >
                                  {issue.indexedPhotoId
                                    ? 'Abrir carpeta de la foto'
                                    : 'Abrir carpeta'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={styles.textButton}
                                  onClick={() => activeSource && void sync(activeSource)}
                                  disabled={busy || isSyncActive(run)}
                                >
                                  Volver a revisar
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                {issueCursor && (
                  <button
                    type="button"
                    className={styles.loadMoreButton}
                    onClick={() => void loadMoreIssues()}
                    disabled={loadingMoreIssues || busy}
                  >
                    {loadingMoreIssues && <span className={styles.spinner} aria-hidden="true" />}
                    {loadingMoreIssues ? 'Cargando problemas…' : 'Ver más problemas'}
                  </button>
                )}
              </div>
            ) : !loadingIssues && !issuesError ? (
              <p className={styles.reviewQueueHint}>
                No hay problemas de revisión que sigan pendientes. Las incidencias antiguas se
                conservan en el historial de cada revisión.
              </p>
            ) : null}

            {!loadingArchive &&
              !loadingIssues &&
              !issuesError &&
              summary &&
              !summary.unclassified &&
              issueTotalCount === 0 && (
                <div className={styles.reviewComplete}>
                  <h3>Todo revisado en esta carpeta</h3>
                  <p>No hay fotos sin fecha ni problemas registrados en la última revisión.</p>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => {
                      setOrganizeTab('folders');
                      document
                        .getElementById('archive-title')
                        ?.scrollIntoView?.({ block: 'start' });
                    }}
                  >
                    Ver fotos de la carpeta
                  </button>
                </div>
              )}
          </section>
        ) : null)}

      {area === 'organize' && (
        <section className={styles.sourcesOverview} aria-labelledby="excluded-title">
          <div className={styles.sectionHeading}>
            <div>
              <h2 id="excluded-title">Papelera de fotos excluidas</h2>
              <p>
                Las fotos retiradas solo se excluyen de tu archivo local. Restaurarlas permite que
                vuelvan a aparecer en la próxima revisión de Drive.
              </p>
            </div>
            <span>{exclusions.length.toLocaleString('es-ES')} visibles</span>
          </div>
          {loadingExclusions && !exclusions.length ? (
            <p role="status" className={styles.loadingLine}>
              Cargando papelera…
            </p>
          ) : exclusions.length ? (
            <>
              <ul
                className={styles.exclusionList}
                aria-label="Fotos excluidas y en proceso de restauración"
              >
                {exclusions.map((exclusion) => (
                  <li key={exclusion.id}>
                    <div>
                      <strong>{exclusion.fileName ?? 'Foto sin nombre disponible'}</strong>
                      <span>
                        {exclusion.restoredAt
                          ? 'Restaurada · pendiente de revisión en Drive'
                          : (exclusion.sourceName ?? 'Fuente retirada')}
                      </span>
                      {!!exclusion.folderPath.length && (
                        <small>{exclusion.folderPath.join(' / ')}</small>
                      )}
                    </div>
                    {!exclusion.restoredAt && (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void restoreExclusion(exclusion)}
                        disabled={busy || restoringExclusionId === exclusion.id}
                      >
                        {restoringExclusionId === exclusion.id && (
                          <span className={styles.spinner} aria-hidden="true" />
                        )}
                        Restaurar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {exclusionCursor && (
                <button
                  type="button"
                  className={styles.loadMoreButton}
                  onClick={() =>
                    void loadPhotoExclusions(exclusionCursor, true).catch((error) =>
                      announce(errorCopy(error, 'No se pudieron cargar más exclusiones.'), 'error'),
                    )
                  }
                  disabled={loadingExclusions || busy}
                >
                  Cargar más fotos excluidas
                </button>
              )}
            </>
          ) : (
            <p className={styles.emptyState}>No hay fotos en la papelera.</p>
          )}
        </section>
      )}

      {area === 'organize' && (
        <section
          aria-labelledby="archive-title"
          className={styles.archiveSection}
          aria-busy={loadingArchive}
        >
          <div className={styles.archiveHeader}>
            <div>
              <h2 id="archive-title">Fotos de la carpeta</h2>
              <p>
                Aquí puedes ver las fotos guardadas en Drive, seleccionar algunas y corregir sus
                fechas. Los archivos originales no se modifican.
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
                  Añade fotos nuevas, actualiza la información disponible y detecta archivos que ya
                  no están. Drive no se modifica.
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
              <h3>
                {sources.length
                  ? 'No hay una carpeta disponible para organizar'
                  : 'Aún no hay carpetas de fotos'}
              </h3>
              <p>
                {sources.length
                  ? 'Tus carpetas aparecen arriba. Reconecta Drive o revisa su estado para volver a organizar las fotos.'
                  : 'Añade una carpeta de Drive para empezar a organizar sus fotos.'}
              </p>
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
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setConfirmRemoveSourceId(activeSource.id)}
                disabled={busy || isSyncActive(run)}
              >
                Quitar esta carpeta del archivo
              </button>
            </div>
          ) : null}

          {sourcePendingRemoval && (
            <div
              className={styles.confirmationPanel}
              role="group"
              aria-labelledby="remove-source-title"
            >
              <div>
                <h3 id="remove-source-title">
                  Quitar “{sourcePendingRemoval.name}” de Línea de vida
                </h3>
                <p>
                  Sus fotos dejarán de aparecer aquí y se quitarán las correcciones manuales, las
                  reglas de fecha de carpeta y el historial de revisión. Los archivos originales
                  seguirán intactos en Drive. Si la añades de nuevo, se revisará como una carpeta
                  nueva; las fotos que hayas excluido previamente seguirán fuera hasta que las
                  restaures.
                </p>
              </div>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void removeSource(sourcePendingRemoval)}
                  disabled={
                    busy || (sourcePendingRemoval.id === activeSource?.id && isSyncActive(run))
                  }
                >
                  {busyAction === 'remove-source' && (
                    <span className={styles.spinner} aria-hidden="true" />
                  )}
                  {area === 'organize' ? 'Quitar carpeta' : 'Quitar carpeta e índice'}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setConfirmRemoveSourceId(null)}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

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
              {!!issues.length && organizeTab !== 'pending' && (
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
                    disabled={busy || loadingArchive || loadingPhotos}
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
              <p>
                Usa “Buscar cambios en Drive” para encontrar sus carpetas y construir el índice.
              </p>
            </div>
          )}

          {!!folders.length && (
            <div className={styles.archiveWorkspace} id="photos-workspace" tabIndex={-1}>
              <aside className={styles.treePanel}>
                <div className={styles.treeHeading}>
                  <div>
                    <h3>Carpetas</h3>
                    <span>{pluralize(folders.length, 'carpeta', 'carpetas')}</span>
                  </div>
                  <span id="folder-tree-keyboard-help">
                    ↑/↓ moverse · ← plegar o subir · → desplegar o entrar · Inicio/Fin ir al
                    primero/último
                  </span>
                </div>
                {summary && summary.unclassified > 0 && (
                  <button
                    type="button"
                    className={`${styles.pendingTreeRow} ${pendingView ? styles.currentFolder : ''}`}
                    onClick={() => void loadPending(activeSource.id)}
                    disabled={busy || loadingArchive || loadingPhotos}
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
                <nav
                  className={styles.tree}
                  aria-label="Carpetas indexadas"
                  aria-describedby="folder-tree-keyboard-help"
                  role="tree"
                >
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
                        aria-disabled={busy}
                        aria-expanded={hasChildren ? !collapsed : undefined}
                        data-tree-row="true"
                        data-folder-id={folder.id}
                        onClick={(event) => {
                          if (busy) return;
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
                        disabled={busy}
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
                            {selectedFolder.classifiedPhotoCount.toLocaleString('es-ES')} con fecha
                            · {selectedFolder.unclassifiedPhotoCount.toLocaleString('es-ES')} por
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

                    <div className={styles.folderReview}>
                      <div>
                        <strong>Comprobar si hay cambios en Drive</strong>
                        <p>
                          Revisaremos toda esta fuente para confirmar qué archivos siguen
                          disponibles. Solo se actualizará el índice local; nunca se borrarán fotos
                          de Drive.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => void sync()}
                        disabled={busy || loadingArchive || isSyncActive(run)}
                      >
                        {isSyncActive(run) && (
                          <span className={styles.spinner} aria-hidden="true" />
                        )}
                        {isSyncActive(run) ? 'Revisión en curso' : 'Revisar cambios en Drive'}
                      </button>
                    </div>

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

                <form className={styles.archiveSearch} onSubmit={beginArchiveSearch}>
                  <label>
                    Buscar por nombre
                    <input
                      type="search"
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      maxLength={120}
                      placeholder="Ej.: vacaciones, IMG_2048…"
                      disabled={busy || loadingArchive}
                    />
                  </label>
                  <label>
                    Carpeta
                    <select
                      value={searchFolderId}
                      onChange={(event) => {
                        setSearchFolderId(event.target.value);
                        if (searchMode) {
                          setPhotos([]);
                          setPhotoCursor(null);
                          setSelectedPhotos(new Set());
                          setLoadingPhotos(true);
                        }
                      }}
                      disabled={busy || loadingArchive}
                    >
                      <option value="ALL">Toda la fuente</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.path.join(' / ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={busy || loadingArchive || loadingPhotos}
                  >
                    Buscar en el archivo
                  </button>
                  {searchMode && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        photoRequestRef.current?.abort();
                        photoRequestRef.current = null;
                        searchKeyRef.current = '';
                        setSearchMode(false);
                        setSearchText('');
                        setAppliedSearch('');
                        setSearchFolderId('ALL');
                        setPhotos([]);
                        setPhotoCursor(null);
                        setSelectedPhotos(new Set());
                      }}
                      disabled={busy}
                    >
                      Cerrar búsqueda
                    </button>
                  )}
                </form>

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
                      disabled={busy || loadingArchive || loadingPhotos}
                    >
                      <option value="ALL">Todas las fotografías</option>
                      <option value="UNCLASSIFIED">Sin fecha suficiente</option>
                      <option value="AUTOMATIC">Con fecha encontrada automáticamente</option>
                      <option value="FOLDER">Con fecha configurada por carpeta</option>
                      <option value="MANUAL">Con fecha corregida manualmente</option>
                    </select>
                  </label>
                  <span aria-live="polite">
                    {searchMode
                      ? `Resultados en ${searchFolderId === 'ALL' ? 'toda la fuente' : (folders.find((folder) => folder.id === searchFolderId)?.name ?? 'la carpeta seleccionada')}`
                      : selectedPhotos.size
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
                      {pendingView
                        ? 'No quedan fotos por revisar'
                        : searchMode
                          ? 'No hay resultados para esta búsqueda'
                          : 'No hay fotos en esta vista'}
                    </h3>
                    <p>
                      {pendingView
                        ? 'Todas las fotografías de esta fuente tienen una fecha suficiente.'
                        : searchMode
                          ? 'Prueba otro nombre o cambia la carpeta y el filtro de fecha.'
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
                                busy ||
                                loadingArchive ||
                                loadingPhotos ||
                                (!selected && selectedPhotos.size >= MANUAL_DATE_BULK_LIMIT)
                              }
                              aria-describedby="selection-limit-hint"
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
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
                              {searchMode && photo.folderPath?.length ? (
                                <small>{photo.folderPath.join(' / ')}</small>
                              ) : null}
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
                              disabled={busy}
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
                        onClick={() => {
                          setOrganizeTab('dates');
                          setManualDatePreview(null);
                          setManualEditorOpen(true);
                        }}
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
                <div className={styles.buttonRow}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={busy || loadingArchive || (!pendingView && !selectedFolderId)}
                    onClick={() => void refreshPhotos()}
                  >
                    Actualizar fotos
                  </button>
                </div>

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
                        Drive y no se modificarán. Puedes recuperarlas desde la papelera; se
                        incluirán otra vez en la próxima revisión.
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
                            setManualDatePreview(null);
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
                          onChange={(event) => {
                            setManualMonth(event.target.value);
                            setManualDatePreview(null);
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
                    {manualError && (
                      <p className={styles.fieldError} id="manual-date-error" role="alert">
                        {manualError}
                      </p>
                    )}
                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void previewManualDate()}
                        disabled={busy || !manualYear}
                      >
                        {busyAction === 'manual-date-preview' && (
                          <span className={styles.spinner} aria-hidden="true" />
                        )}
                        {busyAction === 'manual-date-preview'
                          ? 'Calculando cambios…'
                          : 'Ver qué cambiará'}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          setManualEditorOpen(false);
                          setManualError('');
                          setManualDatePreview(null);
                        }}
                        disabled={busy}
                      >
                        Cancelar
                      </button>
                    </div>
                    {manualDatePreview && (
                      <div
                        className={styles.changeReview}
                        role="group"
                        aria-labelledby="manual-preview-title"
                      >
                        <div>
                          <span>Revisión del cambio</span>
                          <h3 id="manual-preview-title">
                            {manualMonth
                              ? `${MONTH_OPTIONS.find((month) => month.value === manualMonth)?.label} de ${manualYear}`
                              : manualYear}
                          </h3>
                          <p>
                            {manualDatePreview.willChangeCount
                              ? `La fecha cambiará en ${pluralize(manualDatePreview.willChangeCount, 'foto', 'fotos')}.`
                              : 'Las fotos seleccionadas ya tienen esta fecha corregida.'}{' '}
                            {manualDatePreview.alreadySameCount > 0 &&
                              `${pluralize(manualDatePreview.alreadySameCount, 'foto ya tiene', 'fotos ya tienen')} esta fecha.`}
                          </p>
                          {manualDatePreview.alreadyDatedCount >
                            manualDatePreview.alreadySameCount && (
                            <p>
                              En{' '}
                              {pluralize(
                                manualDatePreview.alreadyDatedCount -
                                  manualDatePreview.alreadySameCount,
                                'foto sustituirás',
                                'fotos sustituirás',
                              )}{' '}
                              la fecha visible actual. La información original seguirá conservada.
                            </p>
                          )}
                        </div>
                        <div className={styles.buttonRow}>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => void applyManualDate()}
                            disabled={busy || !manualDatePreview.willChangeCount}
                          >
                            {busyAction === 'manual-date' && (
                              <span className={styles.spinner} aria-hidden="true" />
                            )}
                            {manualDatePreview.willChangeCount
                              ? `Aplicar a ${pluralize(manualDatePreview.willChangeCount, 'foto', 'fotos')}`
                              : 'No hay cambios que aplicar'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => setManualDatePreview(null)}
                            disabled={busy}
                          >
                            Volver a editar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {photoCursor && (
                  <button
                    type="button"
                    className={styles.loadMoreButton}
                    onClick={() =>
                      void (
                        pendingView
                          ? loadPending(activeSource.id, photoCursor, true)
                          : searchMode
                            ? loadSourcePhotos(
                                activeSource.id,
                                appliedSearch,
                                searchFolderId,
                                photoFilter,
                                photoCursor,
                                true,
                              )
                            : selectedFolderId
                              ? loadPhotos(
                                  activeSource.id,
                                  selectedFolderId,
                                  photoFilter,
                                  photoCursor,
                                  true,
                                )
                              : Promise.resolve()
                      ).catch((error) => {
                        if (!isAbortError(error))
                          announce(
                            errorCopy(error, 'No se pudieron cargar más fotos. Reintenta.'),
                            'error',
                          );
                      })
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
                            setFolderDatePreview(null);
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
                            setFolderDatePreview(null);
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
                            setFolderDatePreview(null);
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
                            setFolderDatePreview(null);
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
                      <label
                        className={ruleScope === 'ALL_DESCENDANTS' ? styles.scopeSelected : ''}
                      >
                        <input
                          type="radio"
                          name="rule-scope"
                          value="ALL_DESCENDANTS"
                          checked={ruleScope === 'ALL_DESCENDANTS'}
                          onChange={() => {
                            setRuleScope('ALL_DESCENDANTS');
                            setConfirmDate(false);
                            setFolderDatePreview(null);
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
                      onClick={() => void previewFolderDate()}
                      disabled={busy || !dateYear}
                    >
                      {busyAction === 'folder-date-preview' && (
                        <span className={styles.spinner} aria-hidden="true" />
                      )}
                      {busyAction === 'folder-date-preview'
                        ? 'Calculando cambios…'
                        : 'Ver qué fotos cambiarán'}
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
                            {folderDatePreview?.willChangeCount
                              ? `La fecha cambiará en ${pluralize(folderDatePreview.willChangeCount, 'foto', 'fotos')}.`
                              : 'No cambiará la fecha de ninguna foto existente.'}{' '}
                            {folderDatePreview &&
                              `${pluralize(folderDatePreview.unchangedCount, 'otra foto conservará', 'otras fotos conservarán')} su fecha actual.`}
                          </p>
                          <p>
                            {scopeLabel(ruleScope)}. Se revisarán{' '}
                            {pluralize(folderDatePreview?.scopePhotoCount ?? 0, 'foto', 'fotos')}.
                            {folderDatePreview?.replacesAutomaticCount
                              ? ` Puede sustituir ${pluralize(folderDatePreview.replacesAutomaticCount, 'fecha automática', 'fechas automáticas')}.`
                              : ''}{' '}
                            {folderDatePreview?.replacesFolderNameDateCount
                              ? `Incluye ${pluralize(folderDatePreview.replacesFolderNameDateCount, 'fecha deducida del nombre de carpeta', 'fechas deducidas de nombres de carpeta')}.`
                              : ''}{' '}
                            {folderDatePreview?.preservesManualCount
                              ? `${pluralize(folderDatePreview.preservesManualCount, 'corrección manual se conserva', 'correcciones manuales se conservan')}.`
                              : 'Las correcciones manuales siempre se conservan.'}
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
                            {folderDatePreview?.willChangeCount
                              ? `Aplicar fecha a ${pluralize(folderDatePreview.willChangeCount, 'foto', 'fotos')}`
                              : 'Guardar para futuras fotos'}
                          </button>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => {
                              setConfirmDate(false);
                              setFolderDatePreview(null);
                            }}
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
            <details className={styles.history} id="review-history">
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
      )}
    </main>
  );
}
