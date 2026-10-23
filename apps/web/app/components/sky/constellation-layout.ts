import type { SkyOrientation } from './orientation';
import { clamp } from './rng';

export type ConstellationKind = {
  /** Cluster height as a fraction of the viewport height when travelling sideways. */
  hFrac: number;
  /** Width / height of the photo cluster. */
  ratio: number;
  /** Cluster width as a fraction of the viewport width when travelling vertically. */
  vFrac: number;
  maxW: number;
};

export const YEAR_CONSTELLATION: ConstellationKind = {
  hFrac: 0.5,
  ratio: 1.45,
  vFrac: 0.62,
  maxW: 780,
};
export const MONTH_CONSTELLATION: ConstellationKind = {
  hFrac: 0.44,
  ratio: 1.3,
  vFrac: 0.6,
  maxW: 700,
};

/** Narrow vertical travel keeps a left gutter and the slim rail's column free of content. */
export const SMALL_GUTTER = 16;
export const SMALL_RAIL = 44;
/** Least room (px) between two groups when travelling sideways on a small screen. */
export const MIN_SIDEWAYS_GAP_SMALL = 170;

export type ConstellationGeometry = {
  clusterWidth: number;
  clusterHeight: number;
  /** Cluster position inside its section. */
  clusterX: number;
  clusterY: number;
  /** Section extent along its own axis (the other one fills the stage). */
  sectionSize: number;
  /** Space before the section; the last one also leaves room to settle. */
  marginLead: number;
  marginTail: number;
  numeralSize: number;
  /** Distance from the section bottom to the label when travelling sideways. */
  labelBottom: number;
  /** Where the thread's node sits inside the section. */
  nodeX: number;
  nodeY: number;
  tileGap: number;
};

/** Geometry of one constellation, ported from the approved prototype. */
export function constellationGeometry(
  kind: ConstellationKind,
  viewport: { width: number; height: number },
  orientation: SkyOrientation,
  index: number,
  count: number,
  { afterHeader = false }: { afterHeader?: boolean } = {},
): ConstellationGeometry {
  const { width: vw, height: vh } = viewport;
  const horizontal = orientation === 'horizontal';
  const small = vw < 640;
  const clusterWidth = horizontal
    ? Math.min(vh * kind.hFrac * kind.ratio, vw * 0.84)
    : Math.min(small ? vw - SMALL_GUTTER - SMALL_RAIL : vw * kind.vFrac, kind.maxW);
  const clusterHeight = clusterWidth / kind.ratio;
  // Sideways, the room between groups follows the size of a group too: a narrow, tall phone has
  // a small width but wide groups, which a width-only gap packed shoulder to shoulder.
  // A phone held sideways is wide but short, so it counts as compact too.
  const compact = small || vh < 500;
  const between = horizontal
    ? Math.max(
        vw * (compact ? 0.2 : 0.11),
        clusterWidth * (compact ? 0.6 : 0.25),
        compact ? MIN_SIDEWAYS_GAP_SMALL : 0,
      )
    : vh * 0.2;
  const first = horizontal ? vw * (afterHeader ? 0.04 : 0.08) : vh * (afterHeader ? 0.06 : 0.26);
  const marginTail = index === count - 1 ? (horizontal ? vw * 0.3 : vh * 0.3) : 0;
  const marginLead = index === 0 ? first : between;
  const zigzag = index % 2 === 0 ? -1 : 1;
  const tileGap = small ? 5 : 7;

  if (horizontal) {
    const clusterY = clamp(
      (vh - clusterHeight) / 2 + zigzag * vh * 0.05 + vh * 0.05,
      vh * 0.2,
      vh - clusterHeight - vh * 0.12,
    );
    return {
      clusterWidth,
      clusterHeight,
      clusterX: 0,
      clusterY,
      sectionSize: clusterWidth,
      marginLead,
      marginTail,
      numeralSize: Math.min(vh * 0.13, 120),
      labelBottom: vh - clusterY + 18,
      nodeX: 0,
      nodeY: clusterY + clusterHeight + 26,
      tileGap,
    };
  }

  const labelHeight = Math.min(vh * 0.16, 150);
  const clusterX = small
    ? SMALL_GUTTER
    : (vw - clusterWidth) / 2 + zigzag * Math.min(vw * 0.07, (vw - clusterWidth) / 2 - 24);
  return {
    clusterWidth,
    clusterHeight,
    clusterX,
    clusterY: labelHeight,
    sectionSize: clusterHeight + labelHeight,
    marginLead,
    marginTail,
    numeralSize: Math.min(labelHeight * 0.62, vw * 0.14),
    labelBottom: 0,
    nodeX: clusterX - (small ? 8 : 18),
    nodeY: 8,
    tileGap,
  };
}

/** The big outline header that leads a deeper list, e.g. the year above its months. */
export function periodHeaderGeometry(
  viewport: { width: number; height: number },
  orientation: SkyOrientation,
) {
  const { width: vw, height: vh } = viewport;
  if (orientation === 'horizontal') {
    const size = Math.min(vh * 0.3, 260);
    return {
      size,
      length: size * 2.4,
      margin: vw * 0.06,
      numeralBottom: vh * 0.3,
      metaTop: vh * 0.72,
    };
  }
  const size = Math.min(vw * 0.2, vh * 0.2, 200);
  return {
    size,
    length: size + vh * 0.12,
    margin: vh * 0.16,
    numeralBottom: 0,
    metaTop: size + 18,
  };
}

/**
 * Header of a single period such as "Agosto 2004": smaller than the year numeral because the
 * title is longer and may wrap, ported from the prototype's month depth.
 */
export function compactHeaderGeometry(
  viewport: { width: number; height: number },
  orientation: SkyOrientation,
) {
  const { width: vw, height: vh } = viewport;
  if (orientation === 'horizontal') {
    const size = Math.min(vh * 0.2, 170);
    return {
      size,
      length: Math.min(vw * 0.5, size * 3.4),
      margin: vw * 0.06,
      titleWidth: Math.min(vw * 0.46, size * 3.2),
      titleTop: vh * 0.32,
      metaTop: vh * 0.32 - 30,
    };
  }
  const size = Math.min(vw * 0.13, 150);
  const small = vw < 640;
  return {
    size,
    length: size * (small ? 2 : 1) + 90,
    margin: vh * 0.17,
    titleWidth: vw * 0.8,
    titleTop: 30,
    metaTop: 0,
  };
}
