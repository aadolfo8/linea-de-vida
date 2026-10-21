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

describe('mosaic', () => {
  const aspects = [1.5, 0.75, 1.78, 1, 0.66, 1.33, 1.5, 0.8];

  it('is deterministic for the same seed', () => {
    const first = mosaic(photos(aspects), 780, 540, seededRng(11), 7);
    const second = mosaic(photos(aspects), 780, 540, seededRng(11), 7);
    expect(second).toEqual(first);
  });

  it('places every photo exactly once inside the box without overlaps', () => {
    const gap = 6;
    const cells = mosaic(photos(aspects), 780, 540, seededRng(3), gap);
    expect(cells.map(({ item }) => item.id).sort()).toEqual(aspects.map((_, id) => id));
    cells.forEach((cell) => {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.x + cell.w).toBeLessThanOrEqual(780 + 1e-6);
      expect(cell.y + cell.h).toBeLessThanOrEqual(540 + 1e-6);
    });
    cells.forEach((a, i) =>
      cells.slice(i + 1).forEach((b) => {
        const overlapX = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6;
        const overlapY = a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
        expect(overlapX && overlapY).toBe(false);
      }),
    );
  });

  it('gives the widest cells the widest photos', () => {
    const cells = mosaic(photos(aspects), 780, 540, seededRng(5), 0);
    const byCellShape = [...cells].sort((a, b) => a.w / a.h - b.w / b.h);
    const photoAspects = byCellShape.map(({ item }) => item.aspect);
    expect(photoAspects).toEqual([...photoAspects].sort((a, b) => a - b));
  });

  it('handles empty and single inputs', () => {
    expect(mosaic([], 100, 100, seededRng(1), 4)).toEqual([]);
    const [only] = mosaic(photos([1.5]), 200, 100, seededRng(1), 10);
    expect(only).toMatchObject({ x: 5, y: 5, w: 190, h: 90 });
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
