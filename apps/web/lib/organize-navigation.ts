export type OrganizeTask = 'folders' | 'pending' | 'dates';

export type OrganizeLocation = {
  sourceId: string | null;
  folderId: string | null;
  task: OrganizeTask;
  classification: string;
  query: string;
  searchFolderId: string;
};

const TASKS = new Set<OrganizeTask>(['folders', 'pending', 'dates']);
const CLASSIFICATIONS = new Set(['ALL', 'UNCLASSIFIED', 'AUTOMATIC', 'FOLDER', 'MANUAL']);

export function parseOrganizeLocation(value: string): OrganizeLocation {
  const params = new URL(value, 'http://linea-de-vida.local').searchParams;
  const legacyUndated = params.get('filter') === 'undated';
  const requestedTask = params.get('task') as OrganizeTask | null;
  const requestedClassification = params.get('classification');
  return {
    sourceId: params.get('source'),
    folderId: params.get('folder'),
    task: legacyUndated
      ? 'pending'
      : requestedTask && TASKS.has(requestedTask)
        ? requestedTask
        : 'folders',
    classification:
      requestedClassification && CLASSIFICATIONS.has(requestedClassification)
        ? requestedClassification
        : legacyUndated
          ? 'UNCLASSIFIED'
          : 'ALL',
    query: params.get('q')?.trim().slice(0, 120) ?? '',
    searchFolderId: params.get('searchFolder') || 'ALL',
  };
}

export function writeOrganizeLocation(value: string, state: OrganizeLocation) {
  const url = new URL(value, 'http://linea-de-vida.local');
  const params = url.searchParams;
  params.delete('filter');
  const entries: Array<[string, string | null]> = [
    ['source', state.sourceId],
    ['folder', state.folderId],
    ['task', state.task === 'folders' ? null : state.task],
    ['classification', state.classification === 'ALL' ? null : state.classification],
    ['q', state.query.trim() || null],
    ['searchFolder', state.searchFolderId === 'ALL' ? null : state.searchFolderId],
  ];
  for (const [key, entry] of entries) {
    if (entry) params.set(key, entry);
    else params.delete(key);
  }
  return `${url.pathname}${params.size ? `?${params}` : ''}${url.hash}`;
}
