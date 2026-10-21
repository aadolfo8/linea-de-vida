'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCachedGallery, loadGalleryPage } from '../timeline-cache';
import type { TimelineMonth, TimelinePhoto, TimelinePhotoPage } from '../timeline-model';

/** Photos asked for per page; the endpoint accepts up to 100. */
export const MONTH_PAGE_SIZE = 60;

type State = {
  photos: TimelinePhoto[];
  /** Cursor of the next page, null when everything has been loaded. */
  cursor: string | null;
  /** True once the first page (or a cached copy of it) is in. */
  loaded: boolean;
  loading: boolean;
  failed: boolean;
};

const initialState = (year: number, month: TimelineMonth): State => {
  const cached = getCachedGallery(year, month);
  return cached
    ? {
        photos: cached.photos,
        cursor: cached.nextCursor,
        loaded: true,
        loading: false,
        failed: false,
      }
    : { photos: [], cursor: null, loaded: false, loading: false, failed: false };
};

const append = (current: TimelinePhoto[], items: TimelinePhoto[]) => {
  const seen = new Set(current.map((photo) => photo.id));
  const fresh = items.filter((photo) => !seen.has(photo.id));
  return fresh.length ? [...current, ...fresh] : current;
};

/**
 * Keyset-paged photos of one period. Pages are appended (never replaced), a request already in
 * flight is shared with whoever asks for the same cursor, and `revision` starts over when the
 * archive index changed underneath.
 */
export function useMonthPhotos(year: number, month: TimelineMonth, revision: number) {
  const [state, setState] = useState(() => initialState(year, month));
  const cursor = useRef<string | null>(state.cursor);
  const generation = useRef(0);
  const inflight = useRef<{
    cursor: string | null;
    promise: Promise<TimelinePhotoPage | null>;
  } | null>(null);

  const request = useCallback(
    (from: string | null) => {
      const running = inflight.current;
      if (running) return running.cursor === from ? running.promise : Promise.resolve(null);
      const mine = generation.current;
      setState((current) => ({ ...current, loading: true, failed: false }));
      const promise = loadGalleryPage(year, month, from, MONTH_PAGE_SIZE).then(
        (page) => {
          if (mine !== generation.current) return page;
          inflight.current = null;
          cursor.current = page.nextCursor;
          setState((current) => ({
            photos: from === null ? page.items : append(current.photos, page.items),
            cursor: page.nextCursor,
            loaded: true,
            loading: false,
            failed: false,
          }));
          return page;
        },
        () => {
          if (mine !== generation.current) return null;
          inflight.current = null;
          setState((current) => ({ ...current, loading: false, failed: true }));
          return null;
        },
      );
      inflight.current = { cursor: from, promise };
      return promise;
    },
    [month, year],
  );

  useEffect(() => {
    generation.current += 1;
    inflight.current = null;
    const next = initialState(year, month);
    cursor.current = next.cursor;
    setState(next);
    if (!next.loaded) void request(null);
    return () => {
      generation.current += 1;
      inflight.current = null;
    };
  }, [month, request, revision, year]);

  /** Fetches the next page; resolves to null when there is none or the request failed. */
  const loadNext = useCallback(
    () => (cursor.current ? request(cursor.current) : Promise.resolve(null)),
    [request],
  );

  /** For the viewer: an empty last page tells it nothing more is coming. */
  const loadMoreForViewer = useCallback(
    () =>
      cursor.current
        ? request(cursor.current)
        : Promise.resolve<TimelinePhotoPage>({ items: [], nextCursor: null }),
    [request],
  );

  /** Repeats whatever failed: the first page, or the page after the last loaded one. */
  const retry = useCallback(() => {
    void request(cursor.current);
  }, [request]);

  return { ...state, loadNext, loadMoreForViewer, retry };
}
