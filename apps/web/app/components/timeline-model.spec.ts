import { describe, expect, it, vi } from 'vitest';
import {
  collectTimelineYears,
  parseTimelineRoute,
  photoAspectRatio,
  photoDateLabel,
  photoPrecisionLabel,
  safeOrganizeReturnHref,
  timelineHref,
  timelineHrefWithReturn,
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

  it('names the precision of a date without claiming more than is known', () => {
    const at = (precision: 'DAY' | 'MONTH' | 'YEAR' | 'UNKNOWN') => ({
      effectiveDate: { value: '2024-01-01T00:00:00.000Z', precision },
    });
    expect(photoPrecisionLabel(at('DAY'))).toBe('Día exacto');
    expect(photoPrecisionLabel(at('MONTH'))).toBe('Día sin concretar');
    expect(photoPrecisionLabel(at('YEAR'))).toBe('Mes sin concretar');
    expect(photoPrecisionLabel(at('UNKNOWN'))).toBeNull();
    expect(photoPrecisionLabel({ effectiveDate: { value: null, precision: 'DAY' } })).toBeNull();
  });

  it('generates canonical query-free routes for every timeline level', () => {
    expect(timelineHref({})).toBe('/timeline');
    expect(timelineHref({ year: 2018, month: 5 })).toBe('/timeline/2018/5');
    expect(timelineHref({ year: 2018, month: 'sin-mes' })).toBe('/timeline/2018/sin-mes');
  });

  it('carries a validated Organizar return destination through temporal routes', () => {
    const returnTo = '/organizar?source=s1&folder=f2&task=dates&restoreScroll=640#photos-workspace';
    expect(timelineHrefWithReturn('/timeline/1987/7', returnTo)).toBe(
      `/timeline/1987/7?returnTo=${encodeURIComponent(returnTo)}`,
    );
    expect(safeOrganizeReturnHref(returnTo, 'https://example.test')).toBe(returnTo);
    expect(safeOrganizeReturnHref('https://attacker.test/organizar', 'https://example.test')).toBe(
      null,
    );
    expect(safeOrganizeReturnHref('/settings', 'https://example.test')).toBe(null);
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

describe('timeline pagination and focus guards', () => {
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

  it('wraps focus at both modal boundaries', () => {
    expect(wrappedFocusIndex(0, 3, true)).toBe(2);
    expect(wrappedFocusIndex(2, 3, false)).toBe(0);
    expect(wrappedFocusIndex(-1, 3, false)).toBe(0);
  });
});
