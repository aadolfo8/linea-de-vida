export type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';

export type TimelinePhoto = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  dimensions?: { width: number; height: number };
  effectiveDate: { value: string | null; precision: Precision };
};

export function photoAspectRatio(photo: Pick<TimelinePhoto, 'dimensions'>) {
  const { width, height } = photo.dimensions ?? {};
  if (!width || !height || !Number.isFinite(width / height)) return undefined;
  return Math.min(2, Math.max(0.6, width / height));
}

const photoDateFormats = {
  YEAR: new Intl.DateTimeFormat('es-ES', { year: 'numeric', timeZone: 'UTC' }),
  MONTH: new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
  DAY: new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }),
};

export function photoDateLabel(photo: Pick<TimelinePhoto, 'effectiveDate'>) {
  const { value, precision } = photo.effectiveDate;
  if (!value || precision === 'UNKNOWN') return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return photoDateFormats[precision].format(date);
}

/** What the archive really knows about a photo's date, as a short chip. */
export function photoPrecisionLabel(photo: Pick<TimelinePhoto, 'effectiveDate'>) {
  const { value, precision } = photo.effectiveDate;
  if (!value) return null;
  if (precision === 'DAY') return 'Día exacto';
  if (precision === 'MONTH') return 'Día sin concretar';
  if (precision === 'YEAR') return 'Mes sin concretar';
  return null;
}

export type TimelineYearItem = { year: number; photoCount: number };

export type TimelineYearsPage = {
  firstYear: number | null;
  lastYear: number | null;
  latestYear: number | null;
  items: TimelineYearItem[];
  nextCursor?: string | null;
};

export type TimelineYearSummary = {
  year: number;
  total: number;
  months: { month: number; photoCount: number }[];
  unknownMonthCount: number;
  previews: TimelinePhoto[];
};

/** One constellation of a year: a month with photos, or the group of photos without a month. */
export type TimelineMonthPreview = {
  month: number | null;
  kind: 'MONTH' | 'YEAR';
  label: string | null;
  photoCount: number;
  previews: TimelinePhoto[];
};

export type TimelineMonthPreviews = { year: number; items: TimelineMonthPreview[] };

export type TimelinePhotoPage = { items: TimelinePhoto[]; nextCursor: string | null };
export type TimelineMonth = number | 'sin-mes';

export type TimelineRouteState = {
  year: number | null;
  month: number | null;
  unknown: boolean;
  invalid: boolean;
};

const validYear = (value: string) => {
  const year = /^\d{4}$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null;
};

export function parseTimelineRoute(pathname: string): TimelineRouteState {
  const parts = pathname.split('/').filter(Boolean);
  const empty = { year: null, month: null, unknown: false };
  if (parts[0] !== 'timeline' || parts.length > 3) return { ...empty, invalid: true };
  if (parts.length === 1) return { ...empty, invalid: false };

  const year = validYear(parts[1] ?? '');
  if (!year) return { ...empty, invalid: true };
  if (parts.length === 2) return { year, month: null, unknown: false, invalid: false };

  if (parts[2] === 'sin-mes') return { year, month: null, unknown: true, invalid: false };
  const month = /^\d{1,2}$/.test(parts[2] ?? '') ? Number(parts[2]) : NaN;
  if (Number.isInteger(month) && month >= 1 && month <= 12)
    return { year, month, unknown: false, invalid: false };
  return { year, month: null, unknown: false, invalid: true };
}

export function timelineHref({
  year,
  month,
}: {
  year?: number | null;
  month?: TimelineMonth | null;
} = {}) {
  return year ? `/timeline/${year}${month ? `/${month}` : ''}` : '/timeline';
}

export function timelineHrefWithReturn(
  href: string,
  returnTo: string | null,
  returnLabel?: string | null,
) {
  if (!returnTo) return href;
  const url = new URL(href, 'http://linea-de-vida.local');
  url.searchParams.set('returnTo', returnTo);
  if (returnLabel) url.searchParams.set('returnLabel', returnLabel);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function safeOrganizeReturnHref(value: string | null, origin: string) {
  if (!value) return null;
  try {
    const base = new URL(origin);
    const target = new URL(value, base);
    const known = target.pathname === '/ordenar' || target.pathname === '/organizar';
    if (target.origin !== base.origin || !known) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export const monthFormatter = new Intl.DateTimeFormat('es', {
  month: 'long',
  timeZone: 'UTC',
});

export const monthLabel = (month: number) =>
  monthFormatter.format(new Date(Date.UTC(2024, month - 1)));

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** "Agosto", the way a month heads its constellation. */
export const monthTitle = (month: number) => capitalize(monthLabel(month));

export const photoCountLabel = (count: number) =>
  `${count.toLocaleString('es-ES')} ${count === 1 ? 'foto' : 'fotos'}`;

export const monthCountLabel = (count: number) => `${count} ${count === 1 ? 'mes' : 'meses'}`;

export function wrappedFocusIndex(currentIndex: number, length: number, backwards: boolean) {
  if (length <= 0) return -1;
  if (currentIndex < 0) return backwards ? length - 1 : 0;
  return (currentIndex + (backwards ? -1 : 1) + length) % length;
}

export async function collectTimelineYears(
  fetchPage: (cursor?: string) => Promise<TimelineYearsPage>,
) {
  let firstPage: TimelineYearsPage | null = null;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  const items = new Map<number, TimelineYearItem>();

  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
    const page = await fetchPage(cursor);
    firstPage ??= page;
    page.items.forEach((item) => items.set(item.year, item));
    if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return {
    firstYear: firstPage?.firstYear ?? null,
    lastYear: firstPage?.lastYear ?? null,
    latestYear: firstPage?.latestYear ?? null,
    items: [...items.values()].sort((a, b) => a.year - b.year),
  } satisfies TimelineYearsPage;
}
