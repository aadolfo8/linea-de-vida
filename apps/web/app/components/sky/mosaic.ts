import type { Rng } from './rng';

export type MosaicItem = { aspect: number };
export type MosaicCell<T extends MosaicItem> = {
  item: T;
  /** Top-left of the (unrotated) tile inside the box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Slight tilt in degrees around the tile centre. */
  rotate: number;
  /** Stacking order; the lead photo sits on top where tiles overlap. */
  z: number;
};

/** Share of the box the tiles cover together; the rest is sky showing between them. */
const COVERAGE = 0.62;
/** Tiles may overlap by this share of their smaller side before they are pushed apart. */
const OVERLAP_ALLOWANCE = 0.14;
const RELAX_PASSES = 14;
const MAX_TILT = 5.5;
const MIN_TILT = 1.2;
/** A tile never grows beyond this share of the box on either side. */
const MAX_SPAN = 0.62;
const MIN_TILE = 14;

type Body = { cx: number; cy: number; w: number; h: number; rotate: number };

/** Half extents of the axis-aligned box that contains a rotated tile. */
const halfExtent = (body: Body) => {
  const angle = (Math.abs(body.rotate) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    hx: (body.w * cos + body.h * sin) / 2,
    hy: (body.w * sin + body.h * cos) / 2,
  };
};

/**
 * Photos tossed on a table: every tile keeps its photo's real aspect ratio, sizes vary (the
 * first photos are the largest), tiles tilt a few degrees and overlap a little. The layout
 * starts from a jittered grid so nothing piles up, relaxes the worst overlaps, and keeps every
 * tilted tile inside the box. The same rng always yields the same table.
 */
export function mosaic<T extends MosaicItem>(
  items: readonly T[],
  width: number,
  height: number,
  rng: Rng,
  gap: number,
): MosaicCell<T>[] {
  const count = items.length;
  if (count === 0) return [];
  const pad = gap / 2;
  const innerW = Math.max(MIN_TILE, width - gap);
  const innerH = Math.max(MIN_TILE, height - gap);

  // Areas: lead photos bigger, the rest varied.
  const weights = items.map((_, index) =>
    index === 0 ? 2.6 : index === 1 ? 1.6 : 0.7 + rng() * 0.6,
  );
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const budget = innerW * innerH * COVERAGE;

  const bodies: Body[] = items.map((item, index) => {
    const aspect = item.aspect > 0 && Number.isFinite(item.aspect) ? item.aspect : 1.5;
    const area = (weights[index]! / totalWeight) * budget;
    let w = Math.sqrt(area * aspect);
    let h = w / aspect;
    const fit = Math.min(1, (innerW * MAX_SPAN) / w, (innerH * MAX_SPAN) / h);
    w = Math.max(MIN_TILE, w * fit);
    h = Math.max(MIN_TILE, h * fit);
    const sign = rng() < 0.5 ? -1 : 1;
    const rotate = count === 1 ? 0 : sign * (MIN_TILT + rng() * (MAX_TILT - MIN_TILT));
    return { cx: 0, cy: 0, w, h, rotate };
  });

  // Jittered grid: slots in a shuffled order, the lead photo near the middle of the table.
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * innerW) / innerH)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const slots = Array.from({ length: columns * rows }, (_, slot) => slot);
  for (let index = slots.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [slots[index], slots[other]] = [slots[other]!, slots[index]!];
  }
  const centreSlot = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
  const lead = slots.indexOf(centreSlot);
  if (lead > 0) [slots[0], slots[lead]] = [slots[lead]!, slots[0]!];
  const slotW = innerW / columns;
  const slotH = innerH / rows;
  bodies.forEach((body, index) => {
    const slot = slots[index]!;
    body.cx = pad + ((slot % columns) + 0.5 + (rng() - 0.5) * 0.7) * slotW;
    body.cy = pad + (Math.floor(slot / columns) + 0.5 + (rng() - 0.5) * 0.7) * slotH;
  });

  const keepInside = (body: Body) => {
    const { hx, hy } = halfExtent(body);
    body.cx =
      hx * 2 >= innerW ? width / 2 : Math.min(width - pad - hx, Math.max(pad + hx, body.cx));
    body.cy =
      hy * 2 >= innerH ? height / 2 : Math.min(height - pad - hy, Math.max(pad + hy, body.cy));
  };

  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const ea = halfExtent(a);
        const eb = halfExtent(b);
        const allowance = Math.min(a.w, a.h, b.w, b.h) * OVERLAP_ALLOWANCE;
        const penX = ea.hx + eb.hx - Math.abs(a.cx - b.cx) - allowance;
        const penY = ea.hy + eb.hy - Math.abs(a.cy - b.cy) - allowance;
        if (penX <= 0 || penY <= 0) continue;
        // Separate along the axis that needs the smaller push.
        if (penX < penY) {
          const push = (penX / 2) * (a.cx <= b.cx ? 1 : -1);
          a.cx -= push;
          b.cx += push;
        } else {
          const push = (penY / 2) * (a.cy <= b.cy ? 1 : -1);
          a.cy -= push;
          b.cy += push;
        }
      }
    }
    bodies.forEach(keepInside);
  }

  return bodies.map((body, index) => ({
    item: items[index]!,
    x: body.cx - body.w / 2,
    y: body.cy - body.h / 2,
    w: body.w,
    h: body.h,
    rotate: Number(body.rotate.toFixed(2)),
    z: count - index,
  }));
}
