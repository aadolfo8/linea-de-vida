'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isUnauthenticated } from '../../lib/api';
import { orderingApi } from '../../lib/ordering/client';
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

function signOutIfExpired(error: unknown) {
  if (isUnauthenticated(error)) window.location.replace('/');
}

/**
 * Everything Ordenar reads: the sources, the piles, the folder tree, the photos of the current
 * view and the filename suggestions. The view itself (source, folder, pile) lives in the address.
 */
export function useOrderingData({ reduced }: { reduced: boolean }) {
  const [location, setLocation] = useState<OrderLocation | null>(null);
  const [sources, setSources] = useState<{
    status: 'loading' | 'ready' | 'error';
    items: Source[];
  }>({ status: 'loading', items: [] });
  const [tree, setTree] = useState<FolderTree | null>(null);
  const [piles, setPiles] = useState<PileCounts | null>(null);
  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [suggestions, setSuggestions] = useState<FilenameSuggestions | null>(null);
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [countsVersion, setCountsVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [sourcesVersion, setSourcesVersion] = useState(0);
  const catalog = useRef(new Map<string, OrderingPhoto>());
  const pileDecided = useRef<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    orderingApi
      .sources()
      .then((page) => !cancelled && setSources({ status: 'ready', items: page.items }))
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (!cancelled) setSources({ status: 'error', items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [sourcesVersion]);

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
  const ready = location !== null && sources.status === 'ready' && sourceId !== null;
  const pile: Pile | null = location?.pile ?? null;

  useEffect(() => {
    if (!ready || !sourceId) return;
    let cancelled = false;
    orderingApi
      .folderTree(sourceId)
      .then((value) => !cancelled && setTree(value))
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (!cancelled) setTree(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, sourceId, countsVersion]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    orderingApi
      .piles(scope)
      .then((value) => {
        if (cancelled) return;
        setPiles(value);
        // First load of a view with no pile in the address: open the first pile that has work.
        if (!location?.pile && pileDecided.current !== scopeKey) {
          pileDecided.current = scopeKey;
          patchLocation({ pile: defaultPile(value) });
        }
      })
      .catch((error: unknown) => {
        signOutIfExpired(error);
        if (!cancelled) setPiles(null);
      });
    return () => {
      cancelled = true;
    };
    // `location.pile` is read only for the first decision; changing it must not refetch counts.
  }, [ready, scopeKey, countsVersion]);

  useEffect(() => {
    if (!ready || !folderId) {
      setFolder(null);
      return;
    }
    let cancelled = false;
    orderingApi
      .folder(folderId)
      .then((value) => !cancelled && setFolder(value))
      .catch(() => {
        // A folder that no longer exists is dropped from the view instead of showing nothing.
        if (!cancelled) {
          setFolder(null);
          patchLocation({ folderId: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, folderId, countsVersion, patchLocation]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    orderingApi
      .suggestions(scope)
      .then((value) => !cancelled && setSuggestions(value))
      .catch(() => !cancelled && setSuggestions(null));
    return () => {
      cancelled = true;
    };
  }, [ready, scopeKey, countsVersion, scope]);

  const remember = useCallback((photos: readonly OrderingPhoto[]) => {
    for (const photo of photos) catalog.current.set(photo.id, photo);
  }, []);

  useEffect(() => {
    if (!ready || !pile) return;
    let cancelled = false;
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
  }, [ready, scope, scopeKey, pile, listVersion, remember]);

  const cursorRef = useRef<string | null>(null);
  cursorRef.current = list.nextCursor;
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current;
    if (!cursor || !pile || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setList((current) => ({ ...current, loadingMore: true, moreFailed: false }));
    try {
      const page = await orderingApi.photos(scope, pile, { cursor });
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
      setList((current) => ({ ...current, loadingMore: false, moreFailed: true }));
    } finally {
      loadingMoreRef.current = false;
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

  const reloadList = useCallback(() => setListVersion((value) => value + 1), []);
  const refreshCounts = useCallback(async () => {
    setCountsVersion((value) => value + 1);
    try {
      return await orderingApi.piles(scope);
    } catch {
      return null;
    }
  }, [scope]);
  const reloadSources = useCallback(() => setSourcesVersion((value) => value + 1), []);

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
    suggestions,
    list,
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
