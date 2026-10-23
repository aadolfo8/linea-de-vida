import { describe, expect, it } from 'vitest';
import {
  MIN_SIDEWAYS_GAP_SMALL,
  SMALL_GUTTER,
  SMALL_RAIL,
  YEAR_CONSTELLATION,
  constellationGeometry,
  periodHeaderGeometry,
} from './constellation-layout';

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 800 };

describe('constellation geometry', () => {
  it('sizes the cluster by the viewport width when travelling vertically', () => {
    const geometry = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 1, 3);
    expect(geometry.clusterWidth).toBeCloseTo(Math.min(1440 * 0.62, 780));
    expect(geometry.clusterWidth / geometry.clusterHeight).toBeCloseTo(1.45);
    expect(geometry.sectionSize).toBeCloseTo(geometry.clusterHeight + Math.min(900 * 0.16, 150));
  });

  it('zigzags desktop constellations and keeps the rail column free on small screens', () => {
    const even = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 0, 3);
    const odd = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 1, 3);
    const centred = (1440 - even.clusterWidth) / 2;
    expect(even.clusterX).toBeLessThan(centred);
    expect(odd.clusterX).toBeGreaterThan(centred);

    const small = constellationGeometry(YEAR_CONSTELLATION, phone, 'vertical', 0, 3);
    expect(small.clusterX).toBe(SMALL_GUTTER);
    expect(small.clusterX + small.clusterWidth + SMALL_RAIL).toBeLessThanOrEqual(390);
    expect(small.tileGap).toBe(5);
  });

  it('leads with more room for the first constellation and settles after the last', () => {
    const first = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 0, 3);
    const middle = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 1, 3);
    const last = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 2, 3);
    expect(first.marginLead).toBeGreaterThan(middle.marginLead);
    expect(first.marginTail).toBe(0);
    expect(last.marginTail).toBeGreaterThan(0);
    const afterHeader = constellationGeometry(YEAR_CONSTELLATION, desktop, 'vertical', 0, 3, {
      afterHeader: true,
    });
    expect(afterHeader.marginLead).toBeLessThan(first.marginLead);
  });

  it('lays constellations out sideways with the cluster inside the stage height', () => {
    const geometry = constellationGeometry(YEAR_CONSTELLATION, desktop, 'horizontal', 0, 2);
    expect(geometry.clusterX).toBe(0);
    expect(geometry.sectionSize).toBe(geometry.clusterWidth);
    expect(geometry.clusterY).toBeGreaterThanOrEqual(900 * 0.2);
    expect(geometry.clusterY + geometry.clusterHeight).toBeLessThanOrEqual(900);
    expect(geometry.nodeY).toBeGreaterThan(geometry.clusterY + geometry.clusterHeight);
  });
});

describe('sideways spacing on small screens', () => {
  const phones = [
    { width: 390, height: 800 },
    { width: 844, height: 390 },
    { width: 360, height: 640 },
    { width: 600, height: 900 },
  ];

  it.each(phones)('keeps years apart on %o', (viewport) => {
    const second = constellationGeometry(YEAR_CONSTELLATION, viewport, 'horizontal', 1, 4);
    expect(second.marginLead).toBeGreaterThanOrEqual(MIN_SIDEWAYS_GAP_SMALL);
    expect(second.marginLead).toBeGreaterThanOrEqual(second.clusterWidth * 0.6);
    expect(second.marginLead).toBeGreaterThanOrEqual(viewport.width * 0.2);
  });

  it('still grows the gap with the group on roomy screens', () => {
    const wide = constellationGeometry(
      YEAR_CONSTELLATION,
      { width: 1440, height: 900 },
      'horizontal',
      1,
      4,
    );
    expect(wide.marginLead).toBeGreaterThanOrEqual(wide.clusterWidth * 0.25);
    expect(wide.marginLead).toBeGreaterThanOrEqual(1440 * 0.11);
  });
});

describe('period header geometry', () => {
  it('is taller than wide when travelling vertically and sideways otherwise', () => {
    expect(periodHeaderGeometry(desktop, 'vertical').size).toBeLessThanOrEqual(200);
    expect(periodHeaderGeometry(desktop, 'horizontal').length).toBeGreaterThan(
      periodHeaderGeometry(desktop, 'horizontal').size,
    );
  });
});
