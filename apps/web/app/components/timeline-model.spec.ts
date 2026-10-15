import { describe, expect, it, vi } from 'vitest';
import {
  collectTimelineYears,
  groupTimelineGalleryRows,
  isCurrentTimelineRequest,
  parseTimelineRoute,
  photoAspectRatio,
  photoDateLabel,
  resolveInitialTimelineYear,
  resolveTimelineYearSelection,
  shouldCommitTemporalSelection,
  shouldStartTimelineRequest,
  temporalSelectionIndex,
  timelineHref,
  wrappedFocusIndex,
  type TimelineYearsPage,
} from './timeline-model';

describe('timeline route state', () => {
  it('uses bounded source-image proportions when available', () => {
    expect(photoAspectRatio({ dimensions: { width: 3000, height: 2000 } })).toBe(1.5);
    expect(photoAspectRatio({ dimensions: { width: 10000, height: 1000 } })).toBe(2);
    expect(photoAspectRatio({ dimensions: { width: 1, height: 100 } })).toBe(0.6);
    expect(photoAspectRatio({})).toBeUndefined();
  });

  it('formats only the precision actually assigned to a photo', () => {
    expect(
      photoDateLabel({ effectiveDate: { value: '2024-01-02T00:00:00.000Z', precision: 'DAY' } }),
    ).toBe('2 de enero de 2024');
    expect(
      photoDateLabel({ effectiveDate: { value: '2024-01-01T00:00:00.000Z', precision: 'MONTH' } }),
    ).toBe('enero de 2024');
    expect(
      photoDateLabel({ effectiveDate: { value: '2024-01-01T00:00:00.000Z', precision: 'YEAR' } }),
    ).toBe('2024');
    expect(photoDateLabel({ effectiveDate: { value: null, precision: 'UNKNOWN' } })).toBe(
      'Fecha no disponible',
    );
  });

  it('generates canonical query-free routes for every timeline level', () => {
    expect(timelineHref({})).toBe('/timeline');
    expect(timelineHref({ year: 2018, month: 5 })).toBe('/timeline/2018/5');
    expect(timelineHref({ year: 2018, month: 'sin-mes' })).toBe('/timeline/2018/sin-mes');
  });

  it('marks invalid dynamic month paths while retaining a valid year for correction', () => {
    expect(parseTimelineRoute('/timeline/2018/13')).toEqual({
      year: 2018,
      month: null,
      unknown: false,
      invalid: true,
    });
    expect(parseTimelineRoute('/timeline/not-a-year')).toEqual({
      year: null,
      month: null,
      unknown: false,
      invalid: true,
    });
  });
});

describe('timeline pagination and selection guards', () => {
  it('groups gallery items into complete ordered rows without reordering photos', () => {
    const items = Array.from({ length: 12 }, (_, index) => `photo-${index}`);
    const rows = groupTimelineGalleryRows(items);

    expect(rows.map((row) => row.entries.map(({ span }) => span))).toEqual([
      [7, 5],
      [4, 3, 5],
      [5, 7],
      [7, 5],
      [4, 3, 5],
    ]);
    expect(rows.flatMap((row) => row.entries.map(({ item }) => item))).toEqual(items);
    rows.forEach((row) => {
      expect(row.entries.reduce((total, entry) => total + entry.span, 0)).toBe(12);
    });

    for (let count = 2; count <= 20; count += 1) {
      const grouped = groupTimelineGalleryRows(Array.from({ length: count }, (_, index) => index));
      expect(grouped.every((row) => row.entries.length > 1)).toBe(true);
    }
  });

  it('follows bounded year pages and removes duplicate boundary items', async () => {
    const pages: TimelineYearsPage[] = [
      {
        firstYear: 1999,
        lastYear: 2026,
        latestYear: 2026,
        items: [
          { year: 2026, photoCount: 4 },
          { year: 2025, photoCount: 2 },
        ],
        nextCursor: 'next',
      },
      {
        firstYear: 1999,
        lastYear: 2026,
        latestYear: 2026,
        items: [
          { year: 2025, photoCount: 2 },
          { year: 2024, photoCount: 7 },
        ],
        nextCursor: null,
      },
    ];
    const fetchPage = vi.fn(async (cursor?: string) => pages[cursor ? 1 : 0]);

    await expect(collectTimelineYears(fetchPage)).resolves.toMatchObject({
      latestYear: 2026,
      items: [
        { year: 2024, photoCount: 7 },
        { year: 2025, photoCount: 2 },
        { year: 2026, photoCount: 4 },
      ],
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('accepts only the latest request and avoids route commits for the current snap', () => {
    expect(isCurrentTimelineRequest(3, 4)).toBe(false);
    expect(isCurrentTimelineRequest(4, 4)).toBe(true);
    expect(shouldCommitTemporalSelection(2018, 2018)).toBe(false);
    expect(shouldCommitTemporalSelection(2018, 2019)).toBe(true);
  });

  it('single-sources the initial year and carousel snap from the latest archive year', () => {
    const years: TimelineYearsPage = {
      firstYear: 2024,
      lastYear: 2026,
      latestYear: 2026,
      items: [
        { year: 2024, photoCount: 7 },
        { year: 2025, photoCount: 2 },
        { year: 2026, photoCount: 4 },
      ],
    };

    expect(resolveInitialTimelineYear(years, null)).toBe(2026);
    expect(resolveInitialTimelineYear(years, 2025)).toBe(2025);
    expect(
      temporalSelectionIndex(
        years.items.map(({ year }) => ({ key: `${year}` })),
        '2026',
      ),
    ).toBe(2);

    const pending = resolveTimelineYearSelection(null, null);
    const ready = resolveTimelineYearSelection(years, null, pending);
    expect(ready).toMatchObject({ visualYear: 2026, settledYear: 2026 });
    expect(resolveTimelineYearSelection(years, null, ready)).toBe(ready);
    expect(
      resolveTimelineYearSelection(years, 2025, {
        ...ready,
        visualYear: 2024,
        settledYear: 2024,
      }),
    ).toMatchObject({ visualYear: 2025, settledYear: 2025 });
  });

  it('lets replacement loads bypass stale loading and cooldown guards', () => {
    expect(
      shouldStartTimelineRequest({ reset: true, loading: true, cooldownUntil: 200, now: 100 }),
    ).toBe(true);
    expect(
      shouldStartTimelineRequest({ reset: false, loading: true, cooldownUntil: 0, now: 100 }),
    ).toBe(false);
    expect(
      shouldStartTimelineRequest({ reset: false, loading: false, cooldownUntil: 200, now: 100 }),
    ).toBe(false);

    const staleRequest = 7;
    const replacementRequest = staleRequest + 1;
    expect(isCurrentTimelineRequest(staleRequest, replacementRequest)).toBe(false);
    expect(isCurrentTimelineRequest(replacementRequest, replacementRequest)).toBe(true);
  });

  it('wraps focus at both modal boundaries', () => {
    expect(wrappedFocusIndex(0, 3, true)).toBe(2);
    expect(wrappedFocusIndex(2, 3, false)).toBe(0);
    expect(wrappedFocusIndex(-1, 3, false)).toBe(0);
  });
});
