import { describe, expect, it } from 'vitest';
import { masonryLanes } from './masonry';
import { mosaic } from './mosaic';
import { seededRng, shuffle } from './rng';

const photos = (aspects: number[]) => aspects.map((aspect, id) => ({ id, aspect }));

describe('seeded rng', () => {
  it('repeats the same sequence for a seed and differs between seeds', () => {
    const a = seededRng(2004);
    const b = seededRng(2004);
    const sequenceA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sequenceA);
    expect(sequenceA.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRng(2005)()).not.toBe(seededRng(2004)());
  });

  it('shuffles without losing or mutating items', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffle(input, seededRng(7));
    expect([...result].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('mosaic (scattered collage)', () => {
  const aspects = [1.5, 0.75, 1.78, 1, 0.66, 1.33, 1.5, 0.8];
  const box = { w: 780, h: 540 };
  const lay = (list: number[], seed: number, gap = 7) =>
    mosaic(photos(list), box.w, box.h, seededRng(seed), gap);

  it('is deterministic for the same seed and differs between seeds', () => {
    expect(lay(aspects, 11)).toEqual(lay(aspects, 11));
    expect(lay(aspects, 12)).not.toEqual(lay(aspects, 11));
  });

  it('places every photo exactly once', () => {
    const cells = lay(aspects, 3);
    expect(cells.map(({ item }) => item.id)).toEqual(aspects.map((_, id) => id));
  });

  it('keeps each photo at its own aspect ratio, so nothing is cropped', () => {
    lay(aspects, 5).forEach((cell) => expect(cell.w / cell.h).toBeCloseTo(cell.item.aspect, 1));
  });

  it('keeps every tilted tile inside the box', () => {
    [1, 2, 3, 4, 5, 6, 7].forEach((seed) =>
      lay(aspects, seed).forEach((cell) => {
        const angle = (Math.abs(cell.rotate) * Math.PI) / 180;
        const hx = (cell.w * Math.cos(angle) + cell.h * Math.sin(angle)) / 2;
        const hy = (cell.w * Math.sin(angle) + cell.h * Math.cos(angle)) / 2;
        const cx = cell.x + cell.w / 2;
        const cy = cell.y + cell.h / 2;
        expect(cx - hx).toBeGreaterThanOrEqual(-1e-6);
        expect(cy - hy).toBeGreaterThanOrEqual(-1e-6);
        expect(cx + hx).toBeLessThanOrEqual(box.w + 1e-6);
        expect(cy + hy).toBeLessThanOrEqual(box.h + 1e-6);
      }),
    );
  });

  it('tilts tiles a few degrees, varies their sizes and lets only small overlaps happen', () => {
    const cells = lay(aspects, 9);
    cells.forEach((cell) => {
      expect(Math.abs(cell.rotate)).toBeGreaterThan(0);
      expect(Math.abs(cell.rotate)).toBeLessThanOrEqual(6);
    });
    expect(new Set(cells.map((cell) => Math.round((cell.w * cell.h) / 1000))).size).toBeGreaterThan(
      3,
    );
    cells.forEach((a, i) =>
      cells.slice(i + 1).forEach((b) => {
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapX > 0 && overlapY > 0) {
          const smaller = Math.min(a.w * a.h, b.w * b.h);
          expect((overlapX * overlapY) / smaller).toBeLessThan(0.45);
        }
      }),
    );
  });

  it('makes the lead photo the largest and stacks it on top', () => {
    const cells = lay(aspects, 4);
    const areas = cells.map((cell) => cell.w * cell.h);
    expect(areas[0]).toBe(Math.max(...areas));
    expect(cells[0]!.z).toBe(Math.max(...cells.map((cell) => cell.z)));
  });

  it('copes with empty, single and odd aspect inputs', () => {
    expect(mosaic([], 100, 100, seededRng(1), 4)).toEqual([]);
    const [only] = mosaic(photos([1.5]), 200, 100, seededRng(1), 10);
    expect(only!.rotate).toBe(0);
    expect(only!.w / only!.h).toBeCloseTo(1.5, 1);
    const odd = lay([0, Number.NaN, -2, 40], 2);
    odd.forEach((cell) => {
      expect(Number.isFinite(cell.x + cell.y + cell.w + cell.h)).toBe(true);
      expect(cell.w).toBeGreaterThan(0);
    });
  });
});

describe('masonryLanes', () => {
  const items = photos([1, 0.5, 2, 1]);

  it('fills columns with the shortest lane first when travelling vertically', () => {
    const { placements, length } = masonryLanes(items, 'vertical', 2, 100, 10);
    expect(placements.map(({ lane }) => lane)).toEqual([0, 1, 0, 0]);
    expect(placements[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    expect(placements[1]).toMatchObject({ x: 110, y: 0, w: 100, h: 200 });
    expect(placements[2]).toMatchObject({ x: 0, y: 110, w: 100, h: 50 });
    expect(placements[3]).toMatchObject({ x: 0, y: 170, w: 100, h: 100 });
    expect(length).toBe(270);
  });

  it('mirrors the placement into rows when travelling horizontally', () => {
    const { placements, length, crossSize } = masonryLanes(items, 'horizontal', 2, 100, 10);
    expect(placements[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    expect(placements[1]).toMatchObject({ x: 0, y: 110, w: 50, h: 100 });
    expect(placements[2]).toMatchObject({ lane: 1, x: 60, y: 110, w: 200, h: 100 });
    expect(length).toBeGreaterThan(0);
    expect(crossSize).toBe(210);
  });

  it('reports an empty extent for no photos and guards bad aspect ratios', () => {
    expect(masonryLanes([], 'vertical', 3, 100, 10).length).toBe(0);
    expect(masonryLanes(photos([0]), 'vertical', 1, 100, 10).placements[0]!.h).toBe(100);
  });
});
