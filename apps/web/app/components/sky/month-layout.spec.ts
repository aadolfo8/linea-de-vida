import { describe, expect, it } from 'vitest';
import type { Precision, TimelinePhoto } from '../timeline-model';
import { compactHeaderGeometry } from './constellation-layout';
import { masonryLanes } from './masonry';
import {
  extendSectionLayout,
  groupMonthPhotos,
  monthGeometry,
  sectionRailLabel,
  shouldLoadMore,
} from './month-layout';

const photo = (
  id: string,
  value: string | null,
  precision: Precision,
  width = 1500,
  height = 1000,
): TimelinePhoto => ({
  id,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  dimensions: { width, height },
  effectiveDate: { value, precision },
});

describe('groupMonthPhotos', () => {
  it('opens one section per exact day, newest first, with a readable label', () => {
    const sections = groupMonthPhotos([
      photo('a', '2004-08-14T00:00:00.000Z', 'DAY'),
      photo('b', '2004-08-14T00:00:00.000Z', 'DAY'),
      photo('c', '2004-08-09T00:00:00.000Z', 'DAY'),
    ]);

    expect(sections.map((section) => [section.key, section.label, section.day])).toEqual([
      ['d:2004-08-14', '14 de agosto', 14],
      ['d:2004-08-09', '9 de agosto', 9],
    ]);
    expect(sections[0]!.photos.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('puts month-precision photos in "Día sin concretar" after the days, never on a day', () => {
    const sections = groupMonthPhotos([
      photo('m', '2004-08-01T00:00:00.000Z', 'MONTH'),
      photo('a', '2004-08-14T00:00:00.000Z', 'DAY'),
      photo('n', '2004-08-01T00:00:00.000Z', 'MONTH'),
    ]);

    expect(sections.map((section) => [section.label, section.kind])).toEqual([
      ['14 de agosto', 'day'],
      ['Día sin concretar', 'month'],
    ]);
    expect(sections[1]!.photos.map((item) => item.id)).toEqual(['m', 'n']);
    expect(sections.map(sectionRailLabel)).toEqual(['14', 'S/D']);
  });

  it('keeps year-precision photos in one honest "Fecha sin concretar" section', () => {
    const sections = groupMonthPhotos([
      photo('y1', '2004-01-01T00:00:00.000Z', 'YEAR'),
      photo('y2', '2004-01-01T00:00:00.000Z', 'YEAR'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ label: 'Fecha sin concretar', kind: 'year', day: null });
    expect(sectionRailLabel(sections[0]!)).toBe('S/F');
  });

  it('does not invent precision for photos without a usable date', () => {
    const sections = groupMonthPhotos([
      photo('x', null, 'DAY'),
      photo('z', 'not a date', 'DAY'),
      photo('u', null, 'UNKNOWN'),
    ]);

    expect(sections.map((section) => [section.kind, section.label])).toEqual([
      ['unknown', 'Fecha no disponible'],
    ]);
  });

  it('extends the last day and adds new ones as later pages arrive', () => {
    const first = [
      photo('a', '2004-08-14T00:00:00.000Z', 'DAY'),
      photo('b', '2004-08-13T00:00:00.000Z', 'DAY'),
    ];
    const second = [
      photo('c', '2004-08-13T00:00:00.000Z', 'DAY'),
      photo('d', '2004-08-12T00:00:00.000Z', 'DAY'),
      photo('e', '2004-08-01T00:00:00.000Z', 'MONTH'),
    ];
    const before = groupMonthPhotos(first);
    const after = groupMonthPhotos([...first, ...second]);

    expect(before.map((section) => section.photos.length)).toEqual([1, 1]);
    expect(after.map((section) => [section.key, section.photos.length])).toEqual([
      ['d:2004-08-14', 1],
      ['d:2004-08-13', 2],
      ['d:2004-08-12', 1],
      ['month', 1],
    ]);
  });
});

describe('monthGeometry', () => {
  it('uses 2 to 6 columns of about 250px with a 6px gap, 4px on phones', () => {
    const desktop = monthGeometry({ width: 1440, height: 900 }, 'vertical');
    expect(desktop).toMatchObject({ axis: 'vertical', lanes: 4, gap: 6 });
    expect(desktop.laneSize).toBeGreaterThan(290);
    expect(monthGeometry({ width: 4000, height: 900 }, 'vertical').lanes).toBe(6);
    expect(monthGeometry({ width: 700, height: 900 }, 'vertical').lanes).toBe(2);

    const phone = monthGeometry({ width: 390, height: 800 }, 'vertical');
    expect(phone).toMatchObject({ lanes: 2, gap: 4 });
  });

  it('fills the height between chrome and rail with 2 or 3 rows when horizontal', () => {
    const tall = monthGeometry({ width: 1440, height: 900 }, 'horizontal');
    const short = monthGeometry({ width: 1440, height: 700 }, 'horizontal');
    expect(tall.lanes).toBe(3);
    expect(short.lanes).toBe(2);
    expect(tall.crossOffset + tall.lanes * tall.laneSize + (tall.lanes - 1) * tall.gap).toBeCloseTo(
      900 - 900 * 0.14,
    );
  });
});

describe('extendSectionLayout', () => {
  const geometry = monthGeometry({ width: 1440, height: 900 }, 'vertical');
  const photos = Array.from({ length: 24 }, (_, index) =>
    photo(
      `p${index}`,
      '2004-08-14T00:00:00.000Z',
      'DAY',
      1000 + (index % 5) * 300,
      1000 + ((index * 7) % 4) * 250,
    ),
  );

  it('continues from the lane extents without moving anything already placed', () => {
    const first = extendSectionLayout(null, photos.slice(0, 12), geometry);
    const more = extendSectionLayout(first, photos, geometry);
    const fresh = extendSectionLayout(null, photos, geometry);

    expect(more.placements.slice(0, 12)).toEqual(first.placements);
    expect(more.placements).toHaveLength(24);
    // Appending is exactly the layout of the whole list, so pages never show seams.
    expect(more.placements.map(({ x, y, w, h }) => [x, y, w, h])).toEqual(
      fresh.placements.map(({ x, y, w, h }) => [x, y, w, h]),
    );
    expect(more.length).toBeCloseTo(fresh.length);
    expect(more.length).toBeGreaterThan(first.length);
  });

  it('returns the same layout when nothing was appended', () => {
    const first = extendSectionLayout(null, photos.slice(0, 12), geometry);
    expect(extendSectionLayout(first, photos.slice(0, 12), geometry)).toBe(first);
  });

  it('starts over when the geometry or the photos before the new ones change', () => {
    const first = extendSectionLayout(null, photos.slice(0, 12), geometry);
    const phone = monthGeometry({ width: 390, height: 800 }, 'vertical');
    const resized = extendSectionLayout(first, photos.slice(0, 12), phone);
    expect(resized.placements[0]!.w).toBe(phone.laneSize);

    const reordered = extendSectionLayout(first, [...photos.slice(1, 13)], geometry);
    expect(reordered.placements[0]!.item.id).toBe('p1');
  });

  it('grows along the travel axis in both orientations', () => {
    const rows = monthGeometry({ width: 1440, height: 900 }, 'horizontal');
    const layout = extendSectionLayout(null, photos, rows);
    expect(layout.placements.every((placement) => placement.h === rows.laneSize)).toBe(true);
    expect(layout.length).toBeGreaterThan(rows.laneSize);
  });

  it('keeps masonryLanes unchanged when no initial extents are given', () => {
    const items = [{ aspect: 2 }, { aspect: 1 }];
    expect(masonryLanes(items, 'vertical', 2, 100, 10).extents).toEqual([60, 110]);
  });
});

describe('shouldLoadMore', () => {
  const base = {
    current: 0,
    viewportLength: 900,
    trackLength: 3000,
    hasMore: true,
    busy: false,
    failed: false,
    lastRequestLength: -1,
  };

  it('asks for the next page when the end of the loaded content is near', () => {
    expect(shouldLoadMore({ ...base, current: 900 })).toBe(true);
    expect(shouldLoadMore({ ...base, current: 0, trackLength: 2000 })).toBe(true);
  });

  it('waits while the end is still far, and in either orientation the maths are the same', () => {
    expect(shouldLoadMore({ ...base, current: 0, trackLength: 9000 })).toBe(false);
    expect(shouldLoadMore({ ...base, current: 0, viewportLength: 1600, trackLength: 3900 })).toBe(
      true,
    );
  });

  it('never asks while loading, after a failure, without more pages, or before the last page was measured', () => {
    expect(shouldLoadMore({ ...base, current: 900, busy: true })).toBe(false);
    expect(shouldLoadMore({ ...base, current: 900, failed: true })).toBe(false);
    expect(shouldLoadMore({ ...base, current: 900, hasMore: false })).toBe(false);
    expect(shouldLoadMore({ ...base, current: 900, lastRequestLength: 3000 })).toBe(false);
    expect(shouldLoadMore({ ...base, current: 900, lastRequestLength: 2400 })).toBe(true);
  });
});

describe('compactHeaderGeometry', () => {
  it('sizes a month title for a wide window, a phone and a sideways track', () => {
    expect(compactHeaderGeometry({ width: 1440, height: 900 }, 'vertical').size).toBe(150);
    const phone = compactHeaderGeometry({ width: 390, height: 800 }, 'vertical');
    expect(phone.size).toBeCloseTo(50.7);
    expect(phone.length).toBeCloseTo(50.7 * 2 + 90);
    const sideways = compactHeaderGeometry({ width: 1440, height: 900 }, 'horizontal');
    expect(sideways.size).toBe(170);
    expect(sideways.titleTop).toBeCloseTo(288);
  });
});
