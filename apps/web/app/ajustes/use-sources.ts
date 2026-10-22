'use client';

import { useCallback, useEffect, useState } from 'react';
import { isUnauthenticated, type Source } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
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

/**
 * The sources of the archive with their latest reading and their numbers. While a reading is
 * under way it asks for its progress every `pollMs`, and when it ends it refreshes the numbers
 * and tells the rest of the app that the archive changed.
 */
export function useSources({ pollMs = 2500 }: { pollMs?: number } = {}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [views, setViews] = useState<SourceView[]>([]);
  const [tick, setTick] = useState(0);

  const patch = useCallback(
    (sourceId: string, change: (view: SourceView) => SourceView) =>
      setViews((current) =>
        current.map((view) => (view.source.id === sourceId ? change(view) : view)),
      ),
    [],
  );

  const refreshCounts = useCallback(
    async (sourceId: string) => {
      try {
        const counts = countsFromPiles(await sourcesApi.counts(sourceId));
        patch(sourceId, (view) => ({ ...view, counts }));
      } catch {
        // The card keeps its last numbers; the next refresh tries again.
      }
    },
    [patch],
  );

  const load = useCallback(async () => {
    try {
      const { items } = await sourcesApi.list();
      const loaded = await Promise.all(
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
      setViews(loaded);
      setState('ready');
    } catch (error) {
      if (isUnauthenticated(error)) window.location.replace('/');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll the readings that are under way; the effect restarts whenever the set of them changes.
  const activeKey = views
    .filter((view) => isSyncActive(view.run))
    .map((view) => `${view.source.id}:${view.run!.id}`)
    .join(',');
  useEffect(() => {
    if (!activeKey) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const entry of activeKey.split(',')) {
        const [sourceId, runId] = entry.split(':') as [string, string];
        try {
          const run = await sourcesApi.run(runId);
          if (cancelled) return;
          patch(sourceId, (view) => ({ ...view, run }));
          if (!isSyncActive(run)) {
            notifyArchiveIndexUpdated();
            void refreshCounts(sourceId);
          }
        } catch {
          // A missed poll is not an error: the next one will report.
        }
      }
      if (!cancelled) setTick((value) => value + 1);
    }, pollMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `tick` re-arms the timer after every round, whether or not the poll changed anything.
  }, [activeKey, tick, pollMs, patch, refreshCounts]);

  /** Starts a reading; resolves to an error message, or `null` when it was queued. */
  const startSync = useCallback(
    async (sourceId: string): Promise<string | null> => {
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
    },
    [patch],
  );

  const add = useCallback((source: Source, run: SyncRun | null) => {
    setViews((current) => [
      { source, run, counts: null },
      ...current.filter((view) => view.source.id !== source.id),
    ]);
  }, []);

  const remove = useCallback((sourceId: string) => {
    setViews((current) => current.filter((view) => view.source.id !== sourceId));
  }, []);

  return { state, views, load, startSync, add, remove, refreshCounts };
}
