import { apiJson, json, settingsEndpoint, type Source } from '../api';
import { orderingApi } from '../ordering/client';
import type { SyncRun } from './sync';
import type { SourceType } from './takeout';

export type DriveChild = { id: string; name: string };

export const sourcesApi = {
  list: () => apiJson<{ items: Source[] }>('/photo-sources'),

  latestRun: async (sourceId: string) =>
    (
      await apiJson<{ items: SyncRun[] }>(
        `/photo-sources/${encodeURIComponent(sourceId)}/sync-runs?limit=1`,
      )
    ).items[0] ?? null,

  counts: (sourceId: string) =>
    orderingApi.piles({ sourceId, folderId: null, includeSubfolders: true }),

  startSync: (sourceId: string) =>
    apiJson<SyncRun>(settingsEndpoint.sync(sourceId), { method: 'POST' }),

  run: (runId: string) => apiJson<SyncRun>(settingsEndpoint.run(runId)),

  children: (connectionId: string, folderId: string) =>
    apiJson<{ items: DriveChild[]; nextCursor: string | null }>(
      settingsEndpoint.folderChildren(connectionId, folderId),
    ),

  create: (body: {
    oauthConnectionId: string;
    driveFolderId: string;
    name: string;
    type: SourceType;
  }) => apiJson<Source>(settingsEndpoint.createSource, json('POST', body)),

  remove: (sourceId: string) =>
    apiJson<void>(settingsEndpoint.removeSource(sourceId), { method: 'DELETE' }),

  disconnect: (connectionId: string) =>
    apiJson<void>(settingsEndpoint.disconnect(connectionId), { method: 'DELETE' }),

  signOut: () => apiJson<void>('/auth/logout', { method: 'POST' }),
};
