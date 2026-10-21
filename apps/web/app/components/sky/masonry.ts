import type { MosaicItem } from './mosaic';

export type TravelAxis = 'vertical' | 'horizontal';
export type MasonryPlacement<T extends MosaicItem> = {
  item: T;
  lane: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Shortest-lane placement. When travelling vertically the lanes are columns of width
 * `laneSize` and photos grow downward; when travelling horizontally the lanes are rows of
 * height `laneSize` and photos grow sideways. `length` is the extent along the travel axis.
 */
export function masonryLanes<T extends MosaicItem>(
  items: readonly T[],
  axis: TravelAxis,
  lanes: number,
  laneSize: number,
  gap: number,
) {
  const count = Math.max(1, Math.floor(lanes));
  const extents = Array<number>(count).fill(0);
  const placements: MasonryPlacement<T>[] = items.map((item) => {
    const lane = extents.indexOf(Math.min(...extents));
    const along = extents[lane]!;
    const cross = lane * (laneSize + gap);
    const aspect = item.aspect > 0 ? item.aspect : 1;
    const placement =
      axis === 'vertical'
        ? { x: cross, y: along, w: laneSize, h: laneSize / aspect }
        : { x: along, y: cross, w: laneSize * aspect, h: laneSize };
    extents[lane] = along + (axis === 'vertical' ? placement.h : placement.w) + gap;
    return { item, lane, ...placement };
  });
  const length = items.length ? Math.max(...extents) - gap : 0;
  return { placements, length, crossSize: count * laneSize + (count - 1) * gap };
}
