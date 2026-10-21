import type { Rng } from './rng';

export type MosaicItem = { aspect: number };
export type MosaicCell<T extends MosaicItem> = {
  item: T;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Rect = { x: number; y: number; w: number; h: number };

const MIN_CELL = 4;

/**
 * Weighted treemap: the first photos get the largest cells and the rng picks every split,
 * so the same seed always yields the same shapes. Cells are then assigned by aspect ratio:
 * the widest cells receive the widest photos so crops stay gentle.
 */
export function mosaic<T extends MosaicItem>(
  items: readonly T[],
  width: number,
  height: number,
  rng: Rng,
  gap: number,
): MosaicCell<T>[] {
  if (items.length === 0) return [];
  let weights = items.map((_, index) =>
    index === 0 ? 3.2 : index === 1 ? 1.9 : 0.8 + rng() * 0.6,
  );
  if (rng() < 0.5) weights = weights.reverse();

  const rects: Rect[] = [];
  const split = (x: number, y: number, w: number, h: number, list: number[]) => {
    if (list.length === 1) {
      rects.push({ x, y, w, h });
      return;
    }
    const total = list.reduce((sum, value) => sum + value, 0);
    const target = total * (0.4 + rng() * 0.2);
    let count = 1;
    let accumulated = list[0]!;
    while (count < list.length - 1 && accumulated + list[count]! <= target) {
      accumulated += list[count]!;
      count += 1;
    }
    const share = accumulated / total;
    if (w >= h * 0.9) {
      split(x, y, w * share, h, list.slice(0, count));
      split(x + w * share, y, w * (1 - share), h, list.slice(count));
    } else {
      split(x, y, w, h * share, list.slice(0, count));
      split(x, y + h * share, w, h * (1 - share), list.slice(count));
    }
  };
  split(0, 0, width, height, weights);

  const cellsByShape = rects
    .map((rect) => ({ rect, shape: rect.w / rect.h }))
    .sort((a, b) => a.shape - b.shape);
  const itemsByShape = items.slice().sort((a, b) => a.aspect - b.aspect);
  return cellsByShape.map(({ rect }, index) => ({
    item: itemsByShape[index]!,
    x: rect.x + gap / 2,
    y: rect.y + gap / 2,
    w: Math.max(MIN_CELL, rect.w - gap),
    h: Math.max(MIN_CELL, rect.h - gap),
  }));
}
