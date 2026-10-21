import { apiJson } from '../../lib/api';
import { subscribeArchiveIndexUpdated } from '../../lib/archive-index-events';
import {
  collectTimelineYears,
  type TimelineMonth,
  type TimelinePhotoPage,
  type TimelineYearSummary,
  type TimelineYearsPage,
} from './timeline-model';

const TTL = 5 * 60 * 1000;
const MAX_SUMMARIES = 12;
const MAX_GALLERIES = 6;
const MAX_CACHED_PHOTOS = 1800;

type CacheEntry<T> = { value: T; expiresAt: number };
type GalleryEntry = {
  photos: TimelinePhotoPage['items'];
  nextCursor: string | null;
  expiresAt: number;
};

const summaries = new Map<number, CacheEntry<TimelineYearSummary>>();
let years: CacheEntry<TimelineYearsPage> | null = null;
const galleries = new Map<string, GalleryEntry>();
const inFlight = new Map<string, Promise<unknown>>();
let archiveRevision = 0;
let galleryCachedPhotos = 0;

function readCache<K extends string | number, T>(cache: Map<K, CacheEntry<T>>, key: K) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function pruneCache<T>(cache: Map<string | number, CacheEntry<T>>, maximum: number) {
  while (cache.size > maximum) cache.delete(cache.keys().next().value!);
}

export function getCachedYearSummary(year: number) {
  return readCache(summaries, year);
}

export async function loadYearSummary(year: number) {
  const cached = getCachedYearSummary(year);
  if (cached) return cached;
  const key = `summary:${archiveRevision}:${year}`;
  let pending = inFlight.get(key) as Promise<TimelineYearSummary> | undefined;
  if (!pending) {
    const revision = archiveRevision;
    pending = apiJson<TimelineYearSummary>(`/timeline/years/${year}`)
      .then((data) => {
        if (revision === archiveRevision) {
          summaries.set(year, { value: data, expiresAt: Date.now() + TTL });
          pruneCache(summaries, MAX_SUMMARIES);
        }
        return data;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

export function getCachedGallery(year: number, month: TimelineMonth) {
  const key = `${year}:${month}`;
  const entry = galleries.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) {
      galleryCachedPhotos -= entry.photos.length;
      galleries.delete(key);
    }
    return null;
  }
  galleries.delete(key);
  galleries.set(key, entry);
  return { photos: entry.photos, nextCursor: entry.nextCursor };
}

export function loadGalleryPage(year: number, month: TimelineMonth, cursor: string | null) {
  const galleryKey = `${year}:${month}`;
  const requestKey = `gallery:${archiveRevision}:${galleryKey}:${cursor ?? 'first'}`;
  let pending = inFlight.get(requestKey) as Promise<TimelinePhotoPage> | undefined;
  if (!pending) {
    const revision = archiveRevision;
    const path =
      month === 'sin-mes'
        ? `/timeline/years/${year}/unknown-month/photos`
        : `/timeline/years/${year}/months/${month}/photos`;
    pending = apiJson<TimelinePhotoPage>(
      `${path}?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
      .then((page) => {
        if (revision === archiveRevision) {
          const existing = galleries.get(galleryKey);
          if (existing && existing.expiresAt <= Date.now()) {
            galleryCachedPhotos -= existing.photos.length;
            galleries.delete(galleryKey);
          }
          const previous = galleries.get(galleryKey);
          const seen = new Set(previous?.photos.map((photo) => photo.id) ?? []);
          const additions = cursor ? page.items.filter((photo) => !seen.has(photo.id)) : page.items;
          const photos = cursor ? [...(previous?.photos ?? []), ...additions] : page.items;
          if (previous) galleryCachedPhotos -= previous.photos.length;
          galleries.delete(galleryKey);
          if (photos.length <= MAX_CACHED_PHOTOS && (!cursor || previous)) {
            const entry = { photos, nextCursor: page.nextCursor, expiresAt: Date.now() + TTL };
            galleries.set(galleryKey, entry);
            galleryCachedPhotos += photos.length;
          }
          while (galleries.size > MAX_GALLERIES || galleryCachedPhotos > MAX_CACHED_PHOTOS) {
            const oldestKey = galleries.keys().next().value;
            if (oldestKey === undefined || (oldestKey === galleryKey && galleries.size === 1))
              break;
            const oldest = galleries.get(oldestKey)!;
            galleryCachedPhotos -= oldest.photos.length;
            galleries.delete(oldestKey);
          }
        }
        return page;
      })
      .finally(() => inFlight.delete(requestKey));
    inFlight.set(requestKey, pending);
  }
  return pending;
}

export function invalidateTimelineCache() {
  archiveRevision += 1;
  summaries.clear();
  years = null;
  galleries.clear();
  galleryCachedPhotos = 0;
  // Keep in-flight promises registered until settlement; their captured revision
  // prevents stale responses from repopulating the cache.
}

export function getCachedTimelineYears() {
  if (!years || years.expiresAt <= Date.now()) return null;
  return years.value;
}

export function loadTimelineYears(fetchPage: (cursor?: string) => Promise<TimelineYearsPage>) {
  const cached = getCachedTimelineYears();
  if (cached) return Promise.resolve(cached);
  const key = `years:${archiveRevision}`;
  let pending = inFlight.get(key) as Promise<TimelineYearsPage> | undefined;
  if (!pending) {
    const revision = archiveRevision;
    pending = collectTimelineYears(fetchPage)
      .then((data) => {
        if (revision === archiveRevision) years = { value: data, expiresAt: Date.now() + TTL };
        return data;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

if (typeof window !== 'undefined') subscribeArchiveIndexUpdated(invalidateTimelineCache);
