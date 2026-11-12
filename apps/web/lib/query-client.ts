import { QueryClient } from '@tanstack/react-query';

/** How long fetched archive data counts as fresh, and how long it stays in memory unused. */
export const ARCHIVE_STALE_MS = 5 * 60 * 1000;

/**
 * The one cache of server data in the app. Requests are deduplicated, kept for a few minutes and
 * dropped together when the archive index changes (see `archive-index-events`).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: ARCHIVE_STALE_MS, gcTime: ARCHIVE_STALE_MS, retry: false },
  },
});
