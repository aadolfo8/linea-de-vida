import { useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import type { Source } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { queryClient } from '../../lib/query-client';
import { sourcesApi } from '../../lib/sources/client';
import { apiErrorCopy } from '../../lib/sources/errors';
import {
  countsFromPiles,
  isSyncActive,
  type SourceCounts,
  type SyncRun,
} from '../../lib/sources/sync';

export type SourceView = {
  source: Source;
  run: SyncRun | null;
  counts: SourceCounts | null;
};

const SOURCES_KEY = ['sources'] as const;

async function loadViews(): Promise<SourceView[]> {
  const { items } = await sourcesApi.list();
  return Promise.all(
    items.map(async (source): Promise<SourceView> => {
      const [run, counts] = await Promise.allSettled([
        sourcesApi.latestRun(source.id),
        sourcesApi.counts(source.id),
      ]);
      return {
        source,
        run: run.status === 'fulfilled' ? run.value : null,
        counts: counts.status === 'fulfilled' ? countsFromPiles(counts.value) : null,
      };
    }),
  );
}

/** Edits the cached list in place: every change to a card goes through here. */
const editViews = (change: (views: SourceView[]) => SourceView[]) =>
  queryClient.setQueryData<SourceView[]>(SOURCES_KEY, (current) =>
    current ? change(current) : current,
  );

const patch = (sourceId: string, change: (view: SourceView) => SourceView) =>
  editViews((views) => views.map((view) => (view.source.id === sourceId ? change(view) : view)));

/**
 * The sources of the archive with their latest reading and their numbers. While a reading is
 * under way each one is polled every `pollMs`, and when it ends the numbers are refreshed and the
 * rest of the app is told that the archive changed.
 */
export function useSources({ pollMs = 2500 }: { pollMs?: number } = {}) {
  const query = useQuery(
    { queryKey: SOURCES_KEY, queryFn: loadViews, staleTime: 0, gcTime: 0 },
    queryClient,
  );
  const views = query.data ?? [];
  const state: 'loading' | 'ready' | 'error' = query.isError
    ? 'error'
    : query.data
      ? 'ready'
      : 'loading';

  const refreshCounts = useCallback(async (sourceId: string) => {
    try {
      const counts = countsFromPiles(await sourcesApi.counts(sourceId));
      patch(sourceId, (view) => ({ ...view, counts }));
    } catch {
      // The card keeps its last numbers; the next refresh tries again.
    }
  }, []);

  // One polled query per reading under way; a missed poll is not an error, the next one reports.
  const active = views.filter((view) => isSyncActive(view.run));
  const polls = useQueries(
    {
      queries: active.map((view) => ({
        queryKey: ['sync-run', view.run!.id],
        queryFn: () => sourcesApi.run(view.run!.id),
        refetchInterval: pollMs,
        staleTime: 0,
        gcTime: 0,
      })),
    },
    queryClient,
  );
  const stamp = polls.map((poll) => poll.dataUpdatedAt).join(',');
  useEffect(() => {
    active.forEach((view, index) => {
      const run = polls[index]?.data;
      if (!run || run === view.run) return;
      patch(view.source.id, (current) => ({ ...current, run }));
      if (!isSyncActive(run)) {
        notifyArchiveIndexUpdated();
        void refreshCounts(view.source.id);
      }
    });
    // `stamp` changes exactly when a poll brings new data.
  }, [stamp]);

  /** Starts a reading; resolves to an error message, or `null` when it was queued. */
  const startSync = useCallback(async (sourceId: string): Promise<string | null> => {
    try {
      const run = await sourcesApi.startSync(sourceId);
      patch(sourceId, (view) => ({ ...view, run }));
      return null;
    } catch (error) {
      return apiErrorCopy(
        error,
        'No pudimos empezar a buscar fotos nuevas. Comprueba la conexión e inténtalo de nuevo.',
      );
    }
  }, []);

  const add = useCallback((source: Source, run: SyncRun | null) => {
    editViews((current) => [
      { source, run, counts: null },
      ...current.filter((view) => view.source.id !== source.id),
    ]);
  }, []);

  const remove = useCallback((sourceId: string) => {
    editViews((current) => current.filter((view) => view.source.id !== sourceId));
  }, []);

  const load = useCallback(async () => {
    await query.refetch();
  }, [query]);

  return { state, views, load, startSync, add, remove, refreshCounts };
}
