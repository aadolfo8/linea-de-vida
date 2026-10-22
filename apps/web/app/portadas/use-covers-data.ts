'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson, signOutIfExpired } from '../../lib/api';
import { coversApi } from '../../lib/covers/client';
import { sameScope, type CoverScope, type CoversResponse } from '../../lib/covers/model';
import {
  loadMonthPreviews,
  loadTimelineYears,
  loadYearSummary,
} from '../components/timeline-cache';
import type {
  TimelinePhoto,
  TimelineMonthPreviews,
  TimelineYearSummary,
  TimelineYearsPage,
} from '../components/timeline-model';

export type YearData = {
  summary: TimelineYearSummary;
  monthPreviews: TimelineMonthPreviews;
  covers: CoversResponse;
};

type Status = 'loading' | 'ready' | 'error';

/** The years that have photos, newest first. */
export function useYears() {
  const [state, setState] = useState<{ status: Status; years: number[] }>({
    status: 'loading',
    years: [],
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, status: 'loading' }));
    loadTimelineYears((cursor) =>
      apiJson<TimelineYearsPage>(
        `/timeline/years?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    )
      .then((page) => {
        if (!current) return;
        const years = page.items
          .filter((item) => item.photoCount > 0)
          .map((item) => item.year)
          .sort((a, b) => b - a);
        setState({ status: 'ready', years });
      })
      .catch((error) => {
        if (!current) return;
        signOutIfExpired(error);
        setState({ status: 'error', years: [] });
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  return { ...state, reload: () => setAttempt((value) => value + 1) };
}

/** What one year shows today (its automatic photos and its chosen covers), and a way to reload it. */
export function useYearData(year: number | null) {
  const [state, setState] = useState<{ status: Status; data: YearData | null }>({
    status: 'loading',
    data: null,
  });
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (year === null) return null;
    const mine = ++generation.current;
    try {
      const [summary, monthPreviews, covers] = await Promise.all([
        loadYearSummary(year),
        loadMonthPreviews(year),
        coversApi.list(year),
      ]);
      if (mine !== generation.current) return null;
      const data = { summary, monthPreviews, covers };
      setState({ status: 'ready', data });
      return data;
    } catch (error) {
      if (mine !== generation.current) return null;
      signOutIfExpired(error);
      setState((previous) => ({ status: 'error', data: previous.data }));
      return null;
    }
  }, [year]);

  useEffect(() => {
    setState({ status: 'loading', data: null });
    void load();
  }, [load]);

  return { ...state, reload: load };
}

/** The photos a cover can be made of, a page at a time. */
export function useCandidates(year: number | null, scope: CoverScope | null) {
  const [state, setState] = useState<{
    status: Status;
    items: TimelinePhoto[];
    nextCursor: string | null;
    loadingMore: boolean;
    moreFailed: boolean;
  }>({ status: 'loading', items: [], nextCursor: null, loadingMore: false, moreFailed: false });
  const scopeRef = useRef<CoverScope | null>(null);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const kindKey = scope ? `${scope.kind}:${scope.month}` : null;

  useEffect(() => {
    if (year === null || !scope) return;
    scopeRef.current = scope;
    const mine = ++generation.current;
    setState({
      status: 'loading',
      items: [],
      nextCursor: null,
      loadingMore: false,
      moreFailed: false,
    });
    coversApi
      .candidates(year, scope, null)
      .then((page) => {
        if (mine !== generation.current) return;
        setState({
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreFailed: false,
        });
      })
      .catch((error) => {
        if (mine !== generation.current) return;
        signOutIfExpired(error);
        setState((previous) => ({ ...previous, status: 'error' }));
      });
    // `scope` is identified by its key; a new object for the same cover must not reload.
  }, [year, kindKey, attempt]);

  const loadMore = useCallback(() => {
    const current = scopeRef.current;
    const cursor = state.nextCursor;
    if (year === null || !current || !cursor || state.loadingMore) return;
    const mine = generation.current;
    setState((previous) => ({ ...previous, loadingMore: true, moreFailed: false }));
    coversApi
      .candidates(year, current, cursor)
      .then((page) => {
        if (mine !== generation.current || !sameScope(current, scopeRef.current!)) return;
        setState((previous) => {
          const seen = new Set(previous.items.map((photo) => photo.id));
          return {
            ...previous,
            items: [...previous.items, ...page.items.filter((photo) => !seen.has(photo.id))],
            nextCursor: page.nextCursor,
            loadingMore: false,
          };
        });
      })
      .catch((error) => {
        if (mine !== generation.current) return;
        signOutIfExpired(error);
        setState((previous) => ({ ...previous, loadingMore: false, moreFailed: true }));
      });
  }, [year, state.nextCursor, state.loadingMore]);

  return { ...state, loadMore, reload: () => setAttempt((value) => value + 1) };
}
