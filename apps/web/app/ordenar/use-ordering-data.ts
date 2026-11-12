'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, isUnauthenticated, signOutIfExpired } from '../../lib/api';
import { orderingApi } from '../../lib/ordering/client';
import { queryClient } from '../../lib/query-client';
import {
  defaultPile,
  orderLocationSearch,
  parseOrderLocation,
  type OrderLocation,
} from '../../lib/ordering/location';
import type {
  FilenameSuggestions,
  FolderDetail,
  FolderTree,
  OrderScope,
  OrderingPhoto,
  Pile,
  PileCounts,
  Source,
} from '../../lib/ordering/types';

export type ListState = {
  status: 'loading' | 'ready' | 'error';
  items: OrderingPhoto[];
  nextCursor: string | null;
  loadingMore: boolean;
  /** A failed "load more", kept apart so the photos already shown stay on screen. */
  moreFailed: boolean;
};

const EMPTY_LIST: ListState = {
  status: 'loading',
  items: [],
  nextCursor: null,
  loadingMore: false,
  moreFailed: false,
};

const LEAVE_MS = 320;

/**
 * Everything Ordenar reads: the sources, the piles, the folder tree, the photos of the current
 * view and the filename suggestions. The view itself (source, folder, pile) lives in the address.
 */
export function useOrderingData({ reduced }: { reduced: boolean }) {
  const [location, setLocation] = useState<OrderLocation | null>(null);
  const [piles, setPiles] = useState<PileCounts | null>(null);
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [folderFailed, setFolderFailed] = useState(false);
  const [pilesFailed, setPilesFailed] = useState(false);
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [countsVersion, setCountsVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [folderVersion, setFolderVersion] = useState(0);
  const catalog = useRef(new Map<string, OrderingPhoto>());
  /** Callers of `refreshCounts` waiting for the one piles request the counts effect makes. */
  const pilesWaiters = useRef<Array<(counts: PileCounts | null) => void>>([]);

  // The address is the source of truth for the view; read it once the page is in the browser.
  useEffect(() => setLocation(parseOrderLocation(window.location.search)), []);
  useEffect(() => {
    if (!location) return;
    const next = `${window.location.pathname}${orderLocationSearch(location)}`;
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [location]);

  const patchLocation = useCallback(
    (patch: Partial<OrderLocation>) =>
      setLocation((current) => (current ? { ...current, ...patch } : current)),
    [],
  );

  const sourcesQuery = useQuery(
    {
      queryKey: ['ordering-sources'],
      queryFn: () => orderingApi.sources(),
      staleTime: 0,
      gcTime: 0,
    },
    queryClient,
  );
  const sources = useMemo<{ status: 'loading' | 'ready' | 'error'; items: Source[] }>(
    () => ({
      status: sourcesQuery.isError ? 'error' : sourcesQuery.data ? 'ready' : 'loading',
      items: sourcesQuery.data?.items ?? [],
    }),
    [sourcesQuery.isError, sourcesQuery.data],
  );

  const source = useMemo(
    () => sources.items.find((item) => item.id === location?.sourceId) ?? sources.items[0] ?? null,
    [sources.items, location?.sourceId],
  );
  const sourceId = source?.id ?? null;
  const folderId = location?.folderId ?? null;
  const includeSubfolders = location?.includeSubfolders ?? true;
  const scope = useMemo<OrderScope>(
    () => ({ sourceId, folderId, includeSubfolders }),
    [sourceId, folderId, includeSubfolders],
  );
  const scopeKey = `${sourceId}|${folderId}|${includeSubfolders}`;
  const pile: Pile | null = location?.pile ?? null;
  const ready = location !== null && sources.status === 'ready' && sourceId !== null;

  // The tree and the suggestions follow the counts: when those change they are read again, and
  // the previous ones stay on screen meanwhile.
  const treeQuery = useQuery(
    {
      queryKey: ['ordering-tree', sourceId, countsVersion],
      queryFn: () => orderingApi.folderTree(sourceId!),
      enabled: ready && sourceId !== null,
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
    },
    queryClient,
  );
  const tree: FolderTree | null = treeQuery.isError ? null : (treeQuery.data ?? null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setPilesFailed(false);
    const settleWaiters = (value: PileCounts | null) => {
      for (const waiter of pilesWaiters.current.splice(0)) waiter(value);
    };
    orderingApi
      .piles(scope)
      .then((value) => {
        if (cancelled) return;
        setPiles(value);
        setPilesFailed(false);
        // A view with no pile in the address opens the first pile that has work, unless the
        // person picked one while the counts were loading.
        setLocation((current) =>
          current && !current.pile ? { ...current, pile: defaultPile(value) } : current,
        );
        settleWaiters(value);
      })
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (cancelled) return;
        setPiles(null);
        setPilesFailed(true);
        settleWaiters(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, scope, countsVersion]);

  useEffect(() => {
    setFolderFailed(false);
    if (!ready || !folderId) {
      setFolder(null);
      return;
    }
    let cancelled = false;
    orderingApi
      .folder(folderId)
      .then((value) => !cancelled && setFolder(value))
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (cancelled || isUnauthenticated(error)) return;
        if (error instanceof ApiError && error.status === 404) {
          // A folder that no longer exists is dropped from the view instead of showing nothing.
          setFolder(null);
          patchLocation({ folderId: null });
        } else setFolderFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, folderId, countsVersion, folderVersion, patchLocation]);

  const suggestionsQuery = useQuery(
    {
      queryKey: ['ordering-suggestions', scopeKey, countsVersion],
      queryFn: () => orderingApi.suggestions(scope),
      enabled: ready,
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
    },
    queryClient,
  );
  const suggestions: FilenameSuggestions | null = suggestionsQuery.isError
    ? null
    : (suggestionsQuery.data ?? null);

  const remember = useCallback((photos: readonly OrderingPhoto[]) => {
    for (const photo of photos) catalog.current.set(photo.id, photo);
  }, []);

  /** Names the view the list belongs to; a page that finishes for another view is dropped. */
  const viewKey = `${scopeKey}|${pile}|${listVersion}`;
  const viewRef = useRef(viewKey);
  viewRef.current = viewKey;
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!ready || !pile) return;
    let cancelled = false;
    cursorRef.current = null;
    loadingMoreRef.current = false;
    setList(EMPTY_LIST);
    orderingApi
      .photos(scope, pile)
      .then((page) => {
        if (cancelled) return;
        remember(page.items);
        setList({
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreFailed: false,
        });
      })
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (!cancelled) setList({ ...EMPTY_LIST, status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, scope, pile, listVersion, remember]);

  cursorRef.current = list.nextCursor;
  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || !pile || loadingMoreRef.current) return;
    const view = viewRef.current;
    loadingMoreRef.current = true;
    setList((current) => ({ ...current, loadingMore: true, moreFailed: false }));
    try {
      const page = await orderingApi.photos(scope, pile, { cursor });
      if (viewRef.current !== view) return;
      remember(page.items);
      setList((current) => {
        const known = new Set(current.items.map((item) => item.id));
        return {
          ...current,
          items: [...current.items, ...page.items.filter((item) => !known.has(item.id))],
          nextCursor: page.nextCursor,
          loadingMore: false,
        };
      });
    } catch (error) {
      signOutIfExpired(error);
      if (viewRef.current === view)
        setList((current) => ({ ...current, loadingMore: false, moreFailed: true }));
    } finally {
      if (viewRef.current === view) loadingMoreRef.current = false;
    }
  }, [pile, scope, remember]);

  /** Every id still to load in this view, page by page (for "Seleccionar las N del montón"). */
  const fetchRemainingIds = useCallback(
    async (onProgress?: (count: number) => void) => {
      const ids: string[] = [];
      let cursor = cursorRef.current;
      while (cursor && pile) {
        const page = await orderingApi.photos(scope, pile, { cursor, limit: 200 });
        remember(page.items);
        ids.push(...page.items.map((item) => item.id));
        onProgress?.(ids.length);
        cursor = page.nextCursor;
      }
      return ids;
    },
    [pile, scope, remember],
  );

  const pilesFailedRef = useRef(false);
  pilesFailedRef.current = pilesFailed;
  /** Reloads the photos; when the counts never arrived they are asked for again too. */
  const reloadList = useCallback(() => {
    setListVersion((value) => value + 1);
    if (pilesFailedRef.current) setCountsVersion((value) => value + 1);
  }, []);
  /** Asks for fresh counts; the counts effect makes the only request and answers every caller. */
  const refreshCounts = useCallback(
    () =>
      new Promise<PileCounts | null>((resolve) => {
        pilesWaiters.current.push(resolve);
        setCountsVersion((value) => value + 1);
      }),
    [],
  );
  const reloadFolder = useCallback(() => setFolderVersion((value) => value + 1), []);
  const reloadSources = useCallback(() => void sourcesQuery.refetch(), [sourcesQuery]);

  /** Photos that changed pile fly out of the view; with reduced motion they just disappear. */
  const removeFromList = useCallback(
    (ids: readonly string[]) => {
      const gone = new Set(ids);
      const drop = () => {
        setList((current) => ({
          ...current,
          items: current.items.filter((item) => !gone.has(item.id)),
        }));
        setLeaving(new Set());
      };
      if (reduced) {
        drop();
        return;
      }
      setLeaving(gone);
      window.setTimeout(drop, LEAVE_MS);
    },
    [reduced],
  );

  const patchPhotos = useCallback(
    (ids: readonly string[], patch: (photo: OrderingPhoto) => OrderingPhoto) => {
      const target = new Set(ids);
      for (const id of ids) {
        const photo = catalog.current.get(id);
        if (photo) catalog.current.set(id, patch(photo));
      }
      setList((current) => ({
        ...current,
        items: current.items.map((item) => (target.has(item.id) ? patch(item) : item)),
      }));
    },
    [],
  );

  // Without counts and without a pile in the address there is nothing to list yet: say so.
  const shownList: ListState =
    pilesFailed && !pile && list.status === 'loading' ? { ...EMPTY_LIST, status: 'error' } : list;

  return {
    location,
    patchLocation,
    sources,
    source,
    scope,
    scopeKey,
    ready,
    pile,
    piles,
    tree,
    folder,
    folderFailed,
    reloadFolder,
    suggestions,
    list: shownList,
    leaving,
    catalog,
    remember,
    loadMore,
    fetchRemainingIds,
    reloadList,
    refreshCounts,
    reloadSources,
    removeFromList,
    patchPhotos,
  };
}

export type OrderingData = ReturnType<typeof useOrderingData>;
