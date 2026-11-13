import { apiJson } from '../../lib/api';
import { subscribeArchiveIndexUpdated } from '../../lib/archive-index-events';
import { queryClient } from '../../lib/query-client';
import {
  collectTimelineYears,
  type TimelineMonth,
  type TimelineMonthPreviews,
  type TimelinePhotoPage,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from './timeline-model';

const MAX_CACHED_PHOTOS = 1800;

type Gallery = { photos: TimelinePhotoPage['items']; nextCursor: string | null };

const keys = {
  years: ['years'] as const,
  summary: (year: number) => ['year', year] as const,
  previews: (year: number) => ['month-previews', year] as const,
  gallery: (year: number, month: TimelineMonth) => ['gallery', year, month] as const,
  page: (year: number, month: TimelineMonth, limit: number, cursor: string | null) =>
    ['gallery-page', year, month, limit, cursor] as const,
};

/** Bumped when the archive changes so a page already in flight cannot merge into the new cache. */
let archiveRevision = 0;

/** Query families that depend on the archive index; session and source lists are not among them. */
const ARCHIVE_KEYS = new Set([
  'years',
  'year',
  'month-previews',
  'gallery',
  'gallery-page',
  'cover-years',
  'cover-year',
  'cover-candidates',
]);

/** Fetches through the shared cache; an answer that outlives an archive change is not kept. */
async function load<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) {
  const revision = archiveRevision;
  const data = await queryClient.fetchQuery({ queryKey, queryFn });
  if (revision !== archiveRevision) queryClient.removeQueries({ queryKey });
  return data;
}

export const getCachedYearSummary = (year: number) =>
  queryClient.getQueryData<TimelineYearSummary>(keys.summary(year)) ?? null;

export const loadYearSummary = (year: number) =>
  load(keys.summary(year), () => apiJson<TimelineYearSummary>(`/timeline/years/${year}`));

export const getCachedMonthPreviews = (year: number) =>
  queryClient.getQueryData<TimelineMonthPreviews>(keys.previews(year)) ?? null;

export const loadMonthPreviews = (year: number) =>
  load(keys.previews(year), () =>
    apiJson<TimelineMonthPreviews>(`/timeline/years/${year}/month-previews`),
  );

export const getCachedTimelineYears = () =>
  queryClient.getQueryData<TimelineYearsPage>(keys.years) ?? null;

export const loadTimelineYears = (fetchPage: (cursor?: string) => Promise<TimelineYearsPage>) =>
  load(keys.years, () => collectTimelineYears(fetchPage));

/** The pages of one month loaded so far, in order, with the cursor of the next one. */
export const getCachedGallery = (year: number, month: TimelineMonth) =>
  queryClient.getQueryData<Gallery>(keys.gallery(year, month)) ?? null;

/** Loads one page (deduplicated by the query cache) and appends it to the month's gallery. */
export async function loadGalleryPage(
  year: number,
  month: TimelineMonth,
  cursor: string | null,
  limit = 30,
) {
  const revision = archiveRevision;
  const path =
    month === 'sin-mes'
      ? `/timeline/years/${year}/unknown-month/photos`
      : `/timeline/years/${year}/months/${month}/photos`;
  const page = await queryClient.fetchQuery({
    queryKey: keys.page(year, month, limit, cursor),
    queryFn: () =>
      apiJson<TimelinePhotoPage>(
        `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    staleTime: 0, // concurrent callers share the request; only the merged gallery is kept
    gcTime: 0,
  });
  if (revision !== archiveRevision) return page;
  const key = keys.gallery(year, month);
  const previous = queryClient.getQueryData<Gallery>(key);
  if (cursor && !previous) return page; // a continuation of a gallery that is no longer cached
  const seen = new Set(previous?.photos.map((photo) => photo.id) ?? []);
  const photos = cursor
    ? [...(previous?.photos ?? []), ...page.items.filter((photo) => !seen.has(photo.id))]
    : page.items;
  if (photos.length > MAX_CACHED_PHOTOS) queryClient.removeQueries({ queryKey: key });
  else queryClient.setQueryData<Gallery>(key, { photos, nextCursor: page.nextCursor });
  return page;
}

export function invalidateTimelineCache() {
  archiveRevision += 1;
  // Requests in flight are left to finish for their callers; they drop their own result (above).
  queryClient.removeQueries({
    predicate: (query) =>
      ARCHIVE_KEYS.has(String(query.queryKey[0])) && query.state.fetchStatus !== 'fetching',
  });
}

if (typeof window !== 'undefined') subscribeArchiveIndexUpdated(invalidateTimelineCache);
