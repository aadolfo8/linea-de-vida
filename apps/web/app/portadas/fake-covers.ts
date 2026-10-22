import { ApiError } from '../../lib/api';
import type { TimelinePhoto } from '../components/timeline-model';

/**
 * A small in-memory archive that answers the Portadas API, for the screen tests. It keeps the
 * rules that matter to the screen: chosen photos come first in the chosen order, the rest of the
 * cover is filled automatically, and a hidden or re-dated photo drops out when read.
 */
export type FakePhoto = {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  precision: 'YEAR' | 'MONTH' | 'DAY';
  hidden?: boolean;
};

type CoverBody = {
  kind: 'YEAR' | 'MONTH' | 'UNKNOWN_MONTH';
  year: number;
  month?: number | null;
  photoIds: string[];
};

export type FakeCall = { method: string; path: string; body: CoverBody | undefined };

const LIMITS = { YEAR: 8, MONTH: 6, UNKNOWN_MONTH: 6 } as const;

export const fakeCoverPhoto = (
  id: string,
  date: string,
  precision: FakePhoto['precision'] = 'DAY',
  hidden = false,
): FakePhoto => ({ id, date, precision, hidden });

const compact = (photo: FakePhoto): TimelinePhoto => ({
  id: photo.id,
  fileName: `${photo.id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
  effectiveDate: { value: `${photo.date}T00:00:00.000Z`, precision: photo.precision },
});

export function createFakeCovers(
  photos: FakePhoto[],
  options: {
    /** `kind[:month]` -> ordered photo ids, as stored. */
    stored?: Record<string, string[]>;
    pageSize?: number;
  } = {},
) {
  const calls: FakeCall[] = [];
  const stored = new Map<string, string[]>(Object.entries(options.stored ?? {}));
  const pageSize = options.pageSize ?? 60;
  const yearOf = (photo: FakePhoto) => Number(photo.date.slice(0, 4));
  const monthOf = (photo: FakePhoto) => Number(photo.date.slice(5, 7));
  const visible = (year: number) =>
    photos.filter((photo) => !photo.hidden && yearOf(photo) === year);
  const inScope = (photo: FakePhoto, kind: string, month: number | null) =>
    kind === 'YEAR'
      ? true
      : kind === 'UNKNOWN_MONTH'
        ? photo.precision === 'YEAR'
        : photo.precision !== 'YEAR' && monthOf(photo) === month;
  const key = (kind: string, month: number | null) => (kind === 'MONTH' ? `MONTH:${month}` : kind);

  const validChosen = (year: number, kind: string, month: number | null) =>
    (stored.get(key(kind, month)) ?? [])
      .map((id) => photos.find((photo) => photo.id === id))
      .filter(
        (photo): photo is FakePhoto =>
          !!photo && !photo.hidden && yearOf(photo) === year && inScope(photo, kind, month),
      );

  /** Chosen first, then the newest others, up to the limit. */
  const effective = (year: number, kind: keyof typeof LIMITS, month: number | null) => {
    const chosen = validChosen(year, kind, month);
    const rest = visible(year)
      .filter((photo) => inScope(photo, kind, month) && !chosen.includes(photo))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    return [...chosen, ...rest].slice(0, LIMITS[kind]);
  };

  const candidates = (year: number, kind: string, month: number | null, cursor: string | null) => {
    const all = visible(year)
      .filter((photo) => inScope(photo, kind, month))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const offset = cursor ? Number(cursor) : 0;
    const page = all.slice(offset, offset + pageSize);
    return {
      items: page.map(compact),
      nextCursor: offset + pageSize < all.length ? String(offset + pageSize) : null,
    };
  };

  const scopeOf = (body: CoverBody) => ({
    kind: body.kind,
    year: body.year,
    month: body.month ?? null,
  });

  const handler = async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body: CoverBody | undefined = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const url = new URL(path, 'http://x.test');
    const route = url.pathname;
    const cursor = url.searchParams.get('cursor');

    if (route === '/timeline/years') {
      const years = [...new Set(photos.filter((p) => !p.hidden).map(yearOf))].sort((a, b) => b - a);
      return {
        firstYear: years.at(-1) ?? null,
        lastYear: years[0] ?? null,
        latestYear: years[0] ?? null,
        items: years.map((year) => ({ year, photoCount: visible(year).length })),
        nextCursor: null,
      };
    }
    const summary = route.match(/^\/timeline\/years\/(\d+)$/);
    if (summary) {
      const year = Number(summary[1]);
      const dated = visible(year);
      return {
        year,
        total: dated.length,
        months: Array.from({ length: 12 }, (_, index) => ({
          month: index + 1,
          photoCount: dated.filter((p) => p.precision !== 'YEAR' && monthOf(p) === index + 1)
            .length,
        })),
        unknownMonthCount: dated.filter((p) => p.precision === 'YEAR').length,
        previews: effective(year, 'YEAR', null).map(compact),
      };
    }
    const previews = route.match(/^\/timeline\/years\/(\d+)\/month-previews$/);
    if (previews) {
      const year = Number(previews[1]);
      const months = [
        ...new Set(
          visible(year)
            .filter((p) => p.precision !== 'YEAR')
            .map(monthOf),
        ),
      ].sort((a, b) => a - b);
      const items: {
        month: number | null;
        kind: 'MONTH' | 'YEAR';
        label: string | null;
        photoCount: number;
        previews: TimelinePhoto[];
      }[] = months.map((month) => ({
        month,
        kind: 'MONTH',
        label: null,
        photoCount: visible(year).filter((p) => p.precision !== 'YEAR' && monthOf(p) === month)
          .length,
        previews: effective(year, 'MONTH', month).map(compact),
      }));
      if (visible(year).some((p) => p.precision === 'YEAR'))
        items.push({
          month: null,
          kind: 'YEAR',
          label: 'Fecha sin concretar',
          photoCount: visible(year).filter((p) => p.precision === 'YEAR').length,
          previews: effective(year, 'UNKNOWN_MONTH', null).map(compact),
        });
      return { year, items };
    }
    if (route === '/covers' && method === 'GET') {
      const year = Number(url.searchParams.get('year'));
      const item = (kind: keyof typeof LIMITS, month: number | null) => ({
        kind,
        month,
        limit: LIMITS[kind],
        photos: validChosen(year, kind, month).map(compact),
        dropped: (stored.get(key(kind, month)) ?? [])
          .filter((id) => !validChosen(year, kind, month).some((p) => p.id === id))
          .map((photoId) => ({
            photoId,
            reason: photos.find((p) => p.id === photoId)?.hidden ? 'HIDDEN' : 'OUT_OF_SCOPE',
          })),
      });
      const keys = [...stored.keys()].filter((k) => k !== 'YEAR');
      return {
        year,
        limits: LIMITS,
        items: [
          item('YEAR', null),
          ...keys
            .filter((k) => k.startsWith('MONTH:'))
            .map((k) => item('MONTH', Number(k.slice(6))))
            .sort((a, b) => a.month! - b.month!),
          ...(stored.has('UNKNOWN_MONTH') ? [item('UNKNOWN_MONTH', null)] : []),
        ],
      };
    }
    if (route === '/covers' && method === 'PUT' && body) {
      const { kind, year, month } = scopeOf(body);
      const rejected = body.photoIds.filter((id) => {
        const photo = photos.find((p) => p.id === id);
        return !photo || photo.hidden || yearOf(photo) !== year || !inScope(photo, kind, month);
      });
      if (rejected.length) throw new ApiError(400, 'COVER_PHOTOS_REJECTED', 'rejected', null, null);
      if (body.photoIds.length > LIMITS[kind])
        throw new ApiError(400, 'TOO_MANY_COVERS', 'too many', null, null);
      if (body.photoIds.length) stored.set(key(kind, month), body.photoIds);
      else stored.delete(key(kind, month));
      return { photoIds: body.photoIds };
    }
    if (route === '/covers' && method === 'DELETE' && body) {
      const { kind, month } = scopeOf(body);
      stored.delete(key(kind, month));
      return { photoIds: [] };
    }
    if (route === '/photos') {
      return candidates(Number(url.searchParams.get('year')), 'YEAR', null, cursor);
    }
    const monthPhotos = route.match(/^\/timeline\/years\/(\d+)\/months\/(\d+)\/photos$/);
    if (monthPhotos)
      return candidates(Number(monthPhotos[1]), 'MONTH', Number(monthPhotos[2]), cursor);
    const unknown = route.match(/^\/timeline\/years\/(\d+)\/unknown-month\/photos$/);
    if (unknown) return candidates(Number(unknown[1]), 'UNKNOWN_MONTH', null, cursor);
    throw new Error(`Unexpected request ${method} ${path}`);
  };

  return { handler, calls, stored, photos };
}
