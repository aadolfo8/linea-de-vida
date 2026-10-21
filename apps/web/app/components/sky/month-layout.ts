import { masonryLanes, type MasonryPlacement, type TravelAxis } from './masonry';
import { clamp } from './rng';
import { monthLabel, photoAspectRatio, type TimelinePhoto } from '../timeline-model';

export type MonthSectionKind = 'day' | 'month' | 'year' | 'unknown';

/** One group of the month depth: a day, or an honest "we do not know the day" bucket. */
export type MonthSection = {
  key: string;
  kind: MonthSectionKind;
  label: string;
  /** Day of the month for `day` sections, null otherwise. */
  day: number | null;
  photos: TimelinePhoto[];
};

const UNDATED_ORDER: Exclude<MonthSectionKind, 'day'>[] = ['month', 'year', 'unknown'];
const UNDATED_LABELS: Record<Exclude<MonthSectionKind, 'day'>, string> = {
  month: 'Día sin concretar',
  year: 'Fecha sin concretar',
  unknown: 'Fecha no disponible',
};

const dayOf = (photo: TimelinePhoto) => {
  const { value, precision } = photo.effectiveDate;
  if (precision !== 'DAY' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Groups photos (already ordered newest first) by what their date really says: one section
 * per exact day, then one bucket per coarser precision. A photo is never given a more precise
 * date than the archive knows. Day sections keep first-appearance order, so appending a page
 * only ever extends the last section or adds new ones.
 */
export function groupMonthPhotos(photos: readonly TimelinePhoto[]): MonthSection[] {
  const days = new Map<string, MonthSection>();
  const undated = new Map<Exclude<MonthSectionKind, 'day'>, MonthSection>();
  for (const photo of photos) {
    const date = dayOf(photo);
    if (date) {
      const key = `d:${date.toISOString().slice(0, 10)}`;
      let section = days.get(key);
      if (!section) {
        section = {
          key,
          kind: 'day',
          label: `${date.getUTCDate()} de ${monthLabel(date.getUTCMonth() + 1)}`,
          day: date.getUTCDate(),
          photos: [],
        };
        days.set(key, section);
      }
      section.photos.push(photo);
      continue;
    }
    const { precision } = photo.effectiveDate;
    const kind = precision === 'MONTH' ? 'month' : precision === 'YEAR' ? 'year' : 'unknown';
    let section = undated.get(kind);
    if (!section) {
      section = { key: kind, kind, label: UNDATED_LABELS[kind], day: null, photos: [] };
      undated.set(kind, section);
    }
    section.photos.push(photo);
  }
  return [...days.values(), ...UNDATED_ORDER.flatMap((kind) => undated.get(kind) ?? [])];
}

/** Short rail label of a section: the day number, or S/D (no day) and S/F (no date). */
export const sectionRailLabel = (section: MonthSection) =>
  section.day !== null
    ? String(section.day).padStart(2, '0')
    : section.kind === 'month'
      ? 'S/D'
      : 'S/F';

export type MonthGeometry = {
  axis: TravelAxis;
  lanes: number;
  laneSize: number;
  gap: number;
  /** Offset of the first lane across the travel axis inside a section. */
  crossOffset: number;
  /** Space the day heading takes before the first photo along the travel axis. */
  headingSpace: number;
  /** Space before a section (the first one gets less, it follows the header). */
  leadFirst: number;
  leadNext: number;
  /** Room left after the last photo so the end can settle and show its status. */
  tail: number;
};

/** Lane geometry of the approved prototype: columns when vertical, rows when horizontal. */
export function monthGeometry(
  viewport: { width: number; height: number },
  orientation: 'vertical' | 'horizontal',
): MonthGeometry {
  const { width: vw, height: vh } = viewport;
  const small = vw < 640;
  const gap = small ? 4 : 6;
  if (orientation === 'horizontal') {
    const top = vh * 0.2;
    const bottom = vh * 0.14;
    const rows = vh > 760 ? 3 : 2;
    return {
      axis: 'horizontal',
      lanes: rows,
      laneSize: (vh - top - bottom - gap * (rows - 1)) / rows,
      gap,
      crossOffset: top,
      headingSpace: 0,
      leadFirst: vw * 0.04,
      leadNext: vw * 0.06,
      tail: vw * 0.3,
    };
  }
  const pad = small ? 16 : Math.max(24, vw * 0.06);
  const rail = small ? 30 : 110;
  const available = vw - pad - rail;
  const columns = clamp(Math.floor(available / (small ? 150 : 250)), 2, 6);
  return {
    axis: 'vertical',
    lanes: columns,
    laneSize: (available - gap * (columns - 1)) / columns,
    gap,
    crossOffset: pad,
    headingSpace: 34,
    leadFirst: 0,
    leadNext: vh * 0.08,
    tail: vh * 0.3,
  };
}

type LayoutItem = { id: string; aspect: number; photo: TimelinePhoto };
export type MonthTilePlacement = MasonryPlacement<LayoutItem>;

/** Where every photo of one section sits, plus what is needed to keep extending it. */
export type SectionLayout = {
  signature: string;
  placements: MonthTilePlacement[];
  extents: number[];
  /** Extent along the travel axis, without the heading. */
  length: number;
};

const signatureOf = (geometry: MonthGeometry) =>
  [geometry.axis, geometry.lanes, geometry.laneSize.toFixed(3), geometry.gap].join(':');

/**
 * Lays a section out, reusing the previous layout when it is a prefix of the same photos at
 * the same geometry: appended photos continue from the lane extents and everything already
 * placed stays exactly where it was.
 */
export function extendSectionLayout(
  previous: SectionLayout | null,
  photos: readonly TimelinePhoto[],
  geometry: MonthGeometry,
): SectionLayout {
  const signature = signatureOf(geometry);
  const base =
    previous !== null &&
    previous.signature === signature &&
    previous.placements.length <= photos.length &&
    previous.placements.every((placement, index) => placement.item.id === photos[index]!.id)
      ? previous
      : null;
  const start = base ? base.placements.length : 0;
  if (base && start === photos.length) return base;
  const items: LayoutItem[] = photos.slice(start).map((photo) => ({
    id: photo.id,
    aspect: photoAspectRatio(photo) ?? 1.5,
    photo,
  }));
  const next = masonryLanes(
    items,
    geometry.axis,
    geometry.lanes,
    geometry.laneSize,
    geometry.gap,
    base?.extents,
  );
  return {
    signature,
    placements: base ? [...base.placements, ...next.placements] : next.placements,
    extents: next.extents,
    length: next.length,
  };
}

/** The viewport sits this many viewports from the end of the loaded content before paging. */
export const PAGING_LOOKAHEAD = 2.5;

/**
 * Whether the travel position is close enough to the end of what is loaded to fetch more.
 * `lastRequestLength` is the track length when the previous page was requested: until the
 * appended photos have been measured (the length changes) no further page is asked for.
 */
export function shouldLoadMore({
  current,
  viewportLength,
  trackLength,
  hasMore,
  busy,
  failed,
  lastRequestLength,
}: {
  current: number;
  viewportLength: number;
  trackLength: number;
  hasMore: boolean;
  busy: boolean;
  failed: boolean;
  lastRequestLength: number;
}) {
  if (!hasMore || busy || failed || trackLength === lastRequestLength) return false;
  return current + viewportLength * PAGING_LOOKAHEAD >= trackLength;
}
