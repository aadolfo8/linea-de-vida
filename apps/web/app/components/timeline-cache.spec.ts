import { afterEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api', () => ({ apiJson }));

import {
  getCachedGallery,
  getCachedTimelineYears,
  getCachedYearSummary,
  invalidateTimelineCache,
  loadGalleryPage,
  loadTimelineYears,
  loadYearSummary,
} from './timeline-cache';
import type { TimelinePhoto, TimelinePhotoPage } from './timeline-model';

const photo = (id: string): TimelinePhoto => ({
  id,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  effectiveDate: { value: null, precision: 'UNKNOWN' },
});

afterEach(() => {
  invalidateTimelineCache();
  apiJson.mockReset();
});

describe('timeline data cache', () => {
  it('deduplicates concurrent page requests and retains ordered pages', async () => {
    const first: TimelinePhotoPage = { items: [photo('a')], nextCursor: 'next' };
    const second: TimelinePhotoPage = { items: [photo('b')], nextCursor: null };
    apiJson.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const requestA = loadGalleryPage(2026, 3, null);
    const requestB = loadGalleryPage(2026, 3, null);
    expect(requestA).toBe(requestB);
    await Promise.all([requestA, requestB]);
    await loadGalleryPage(2026, 3, 'next');

    expect(apiJson).toHaveBeenCalledTimes(2);
    expect(getCachedGallery(2026, 3)?.photos.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(getCachedGallery(2026, 3)?.nextCursor).toBeNull();
  });

  it('deduplicates summaries and caches the collected year index', async () => {
    const summary = { year: 2026, total: 1, months: [], unknownMonthCount: 0, previews: [] };
    apiJson.mockResolvedValue(summary);
    const [a, b] = await Promise.all([loadYearSummary(2026), loadYearSummary(2026)]);
    expect(a).toBe(summary);
    expect(b).toBe(summary);
    expect(getCachedYearSummary(2026)).toBe(summary);
    expect(apiJson).toHaveBeenCalledTimes(1);

    const index = {
      firstYear: 2026,
      lastYear: 2026,
      latestYear: 2026,
      items: [{ year: 2026, photoCount: 1 }],
    };
    await loadTimelineYears(async () => index);
    expect(getCachedTimelineYears()).toEqual(index);
  });

  it('does not allow a response from an older archive revision to repopulate the cache', async () => {
    let resolveRequest!: (value: TimelinePhotoPage) => void;
    apiJson.mockImplementation(
      () => new Promise<TimelinePhotoPage>((resolve) => (resolveRequest = resolve)),
    );
    const pending = loadGalleryPage(2026, 3, null);
    invalidateTimelineCache();
    resolveRequest({ items: [photo('old')], nextCursor: null });
    await pending;
    expect(getCachedGallery(2026, 3)).toBeNull();
  });
});
