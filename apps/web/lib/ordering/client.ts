import { ApiError, apiJson, isUnauthenticated, json } from '../api';
import { chunk } from './selection';
import type {
  DatePayload,
  FilenameSuggestions,
  FolderDateBody,
  FolderDatePreview,
  FolderDateRule,
  FolderDetail,
  FolderTree,
  OrderScope,
  PerIdResult,
  PhotoPage,
  Pile,
  PileCounts,
  Source,
} from './types';

/** The API takes at most this many ids per request. */
export const BATCH_LIMIT = 2000;
export const PAGE_SIZE = 60;

const scopeParams = (scope: OrderScope) => {
  const params = new URLSearchParams();
  if (scope.sourceId) params.set('sourceId', scope.sourceId);
  if (scope.folderId) {
    params.set('folderId', scope.folderId);
    params.set('includeSubfolders', String(scope.includeSubfolders));
  }
  return params;
};

/**
 * Runs a batch endpoint over chunks of ids and merges the per-id answers. An expired session, or
 * a request that failed before anything was applied, is thrown so the screen can say what
 * happened; only a chunk that fails after earlier ones succeeded becomes FAILED rows.
 */
async function inBatches(
  ids: readonly string[],
  send: (batch: string[]) => Promise<{ results: PerIdResult[] }>,
) {
  const results: PerIdResult[] = [];
  for (const batch of chunk(ids, BATCH_LIMIT)) {
    try {
      results.push(...(await send(batch)).results);
    } catch (error) {
      if (isUnauthenticated(error) || (results.length === 0 && error instanceof ApiError))
        throw error;
      // A failed chunk fails only its own ids; the others keep what they got.
      results.push(...batch.map((id) => ({ id, status: 'FAILED' })));
    }
  }
  return { results };
}

export const orderingApi = {
  sources: () => apiJson<{ items: Source[] }>('/photo-sources'),

  piles: (scope: OrderScope) => apiJson<PileCounts>(`/ordering/piles?${scopeParams(scope)}`),

  photos: (
    scope: OrderScope,
    pile: Pile,
    options: { cursor?: string | null; limit?: number; order?: 'newest' | 'name' } = {},
  ) => {
    const params = scopeParams(scope);
    params.set('pile', pile);
    params.set('limit', String(options.limit ?? PAGE_SIZE));
    if (options.order) params.set('order', options.order);
    if (options.cursor) params.set('cursor', options.cursor);
    return apiJson<PhotoPage>(`/ordering/photos?${params}`);
  },

  folderTree: (sourceId: string) =>
    apiJson<FolderTree>(`/photo-sources/${encodeURIComponent(sourceId)}/folder-tree`),

  folder: (folderId: string) =>
    apiJson<FolderDetail>(`/indexed-folders/${encodeURIComponent(folderId)}`),

  suggestions: (scope: OrderScope) =>
    apiJson<FilenameSuggestions>(`/ordering/filename-suggestions?${scopeParams(scope)}`),

  acceptSuggestions: (scope: OrderScope) =>
    apiJson<{ appliedCount: number }>(
      '/ordering/filename-suggestions/accept',
      json('POST', {
        ...(scope.sourceId ? { sourceId: scope.sourceId } : {}),
        ...(scope.folderId
          ? { folderId: scope.folderId, includeSubfolders: scope.includeSubfolders }
          : {}),
      }),
    ),

  setDates: (photoIds: readonly string[], payload: DatePayload) =>
    inBatches(photoIds, (batch) =>
      apiJson<{ results: PerIdResult[] }>(
        '/photos/dates',
        json('PUT', { photoIds: batch, ...payload }),
      ),
    ),

  clearDates: (photoIds: readonly string[]) =>
    inBatches(photoIds, (batch) =>
      apiJson<{ results: PerIdResult[] }>('/photos/dates/clear', json('POST', { photoIds: batch })),
    ),

  hide: (photoIds: readonly string[]) =>
    inBatches(photoIds, (batch) =>
      apiJson<{ results: PerIdResult[] }>('/photos/hide', json('POST', { photoIds: batch })),
    ),

  unhide: (photoIds: readonly string[]) =>
    inBatches(photoIds, (batch) =>
      apiJson<{ results: PerIdResult[] }>('/photos/unhide', json('POST', { photoIds: batch })),
    ),

  previewFolderDate: (folderId: string, body: FolderDateBody) =>
    apiJson<FolderDatePreview>(
      `/indexed-folders/${encodeURIComponent(folderId)}/date/preview`,
      json('POST', body),
    ),

  setFolderDate: (folderId: string, body: FolderDateBody) =>
    apiJson<{ rule: FolderDateRule; affectedCount: number }>(
      `/indexed-folders/${encodeURIComponent(folderId)}/date`,
      json('PUT', body),
    ),

  removeFolderDate: (folderId: string) =>
    apiJson<{ affectedCount: number }>(
      `/indexed-folders/${encodeURIComponent(folderId)}/date`,
      json('DELETE'),
    ),
};
