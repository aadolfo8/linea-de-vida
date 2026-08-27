export type Precision = 'YEAR' | 'MONTH' | 'DAY' | 'UNKNOWN';

export type TimelinePhoto = {
  id: string;
  fileName: string;
  mimeType: string;
  thumbnailUrl: string;
  effectiveDate: { value: string | null; precision: Precision };
};

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

export type TimelinePhotoPage = { items: TimelinePhoto[]; nextCursor: string | null };
export type TimelineMonth = number | 'sin-mes';
export type TimelineView = 'immersive' | 'editorial';

export type TimelineRouteState = {
  year: number | null;
  month: number | null;
  unknown: boolean;
  invalid: boolean;
};

export type TimelineYearSelection = {
  scope: string;
  visualYear: number | null;
  settledYear: number | null;
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
  view = 'immersive',
}: {
  year?: number | null;
  month?: TimelineMonth | null;
  view?: TimelineView;
}) {
  const path = year ? `/timeline/${year}${month ? `/${month}` : ''}` : '/timeline';
  return view === 'editorial' ? `${path}?view=editorial` : path;
}

export const monthFormatter = new Intl.DateTimeFormat('es', {
  month: 'long',
  timeZone: 'UTC',
});

export const monthLabel = (month: number) =>
  monthFormatter.format(new Date(Date.UTC(2024, month - 1)));

export function isCurrentTimelineRequest(requestId: number, latestRequestId: number) {
  return requestId === latestRequestId;
}

export function resolveInitialTimelineYear(
  years: Pick<TimelineYearsPage, 'items' | 'latestYear'> | null,
  routeYear: number | null,
) {
  if (!years?.items.length) return routeYear;
  if (routeYear && years.items.some((item) => item.year === routeYear)) return routeYear;
  if (years.latestYear && years.items.some((item) => item.year === years.latestYear))
    return years.latestYear;
  return years.items.at(-1)?.year ?? null;
}

export function resolveTimelineYearSelection(
  years: TimelineYearsPage | null,
  routeYear: number | null,
  current: TimelineYearSelection | null = null,
): TimelineYearSelection {
  const scope = [
    routeYear ?? 'root',
    years ? (years.firstYear ?? 'empty') : 'pending',
    years ? (years.lastYear ?? 'empty') : 'pending',
    years ? (years.latestYear ?? 'empty') : 'pending',
    years?.items.length ?? 0,
  ].join(':');
  if (current?.scope === scope) return current;

  const initialYear = resolveInitialTimelineYear(years, routeYear);
  return { scope, visualYear: initialYear, settledYear: initialYear };
}

export function temporalSelectionIndex(
  items: readonly { key: string }[],
  selectedKey: string | null,
) {
  const selectedIndex = selectedKey ? items.findIndex((item) => item.key === selectedKey) : -1;
  return selectedIndex >= 0 ? selectedIndex : 0;
}

export function shouldStartTimelineRequest({
  reset,
  loading,
  cooldownUntil,
  now,
}: {
  reset: boolean;
  loading: boolean;
  cooldownUntil: number;
  now: number;
}) {
  return reset || (!loading && now >= cooldownUntil);
}

export function wrappedFocusIndex(currentIndex: number, length: number, backwards: boolean) {
  if (length <= 0) return -1;
  if (currentIndex < 0) return backwards ? length - 1 : 0;
  return (currentIndex + (backwards ? -1 : 1) + length) % length;
}

export function shouldCommitTemporalSelection(
  committed: string | number | null,
  settled: string | number,
) {
  return committed !== settled;
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
