import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiJson } from '../../lib/api';
import { coversApi } from '../../lib/covers/client';
import { type CoverScope, type CoversResponse } from '../../lib/covers/model';
import { queryClient } from '../../lib/query-client';
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
  const query = useQuery(
    {
      queryKey: ['cover-years'],
      queryFn: async () => {
        const page = await loadTimelineYears((cursor) =>
          apiJson<TimelineYearsPage>(
            `/timeline/years?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          ),
        );
        return page.items
          .filter((item) => item.photoCount > 0)
          .map((item) => item.year)
          .sort((a, b) => b - a);
      },
    },
    queryClient,
  );
  const status: Status = query.isError ? 'error' : query.data ? 'ready' : 'loading';
  return { status, years: query.data ?? [], reload: () => void query.refetch() };
}

/** What one year shows today (its automatic photos and its chosen covers), and a way to reload it. */
export function useYearData(year: number | null) {
  const query = useQuery(
    {
      queryKey: ['cover-year', year],
      enabled: year !== null,
      // The covers are what people change here: always read them fresh when the year opens.
      staleTime: 0,
      gcTime: 0,
      queryFn: async (): Promise<YearData> => {
        const [summary, monthPreviews, covers] = await Promise.all([
          loadYearSummary(year!),
          loadMonthPreviews(year!),
          coversApi.list(year!),
        ]);
        return { summary, monthPreviews, covers };
      },
    },
    queryClient,
  );
  const status: Status = query.isError ? 'error' : query.data ? 'ready' : 'loading';
  return {
    status,
    data: query.data ?? null,
    reload: async () => (await query.refetch()).data ?? null,
  };
}

/** The photos a cover can be made of, a page at a time. */
export function useCandidates(year: number | null, scope: CoverScope | null) {
  // `scope` is identified by its key; a new object for the same cover must not reload.
  const kindKey = scope ? `${scope.kind}:${scope.month}` : null;
  const query = useInfiniteQuery(
    {
      queryKey: ['cover-candidates', year, kindKey],
      enabled: year !== null && scope !== null,
      staleTime: 0,
      gcTime: 0,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }) => coversApi.candidates(year!, scope!, pageParam),
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    },
    queryClient,
  );
  const items = useMemo(() => {
    const seen = new Set<string>();
    const all: TimelinePhoto[] = [];
    for (const page of query.data?.pages ?? [])
      for (const photo of page.items)
        if (!seen.has(photo.id)) {
          seen.add(photo.id);
          all.push(photo);
        }
    return all;
  }, [query.data]);
  const status: Status = query.data ? 'ready' : query.isError ? 'error' : 'loading';
  const last = query.data?.pages.at(-1);
  return {
    status,
    items,
    nextCursor: last?.nextCursor ?? null,
    loadingMore: query.isFetchingNextPage,
    moreFailed: query.isFetchNextPageError,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    reload: () => void query.refetch(),
  };
}
