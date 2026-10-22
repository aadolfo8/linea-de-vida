import type { TimelinePhoto } from '../../app/components/timeline-model';

export type CoverKind = 'YEAR' | 'MONTH' | 'UNKNOWN_MONTH';
export type DropReason = 'NOT_ACTIVE' | 'HIDDEN' | 'OUT_OF_SCOPE';

/** One cover of a year: the year itself, one of its months or its "Sin mes" group. */
export type CoverScope = { kind: CoverKind; month: number | null };

export type CoverItem = CoverScope & {
  limit: number;
  /** Chosen photos that still belong to the cover, in the chosen order. */
  photos: TimelinePhoto[];
  /** Chosen photos that stopped qualifying (hidden, gone or re-dated). */
  dropped: { photoId: string; reason: DropReason }[];
};

export type CoversResponse = {
  year: number;
  limits: Record<CoverKind, number>;
  items: CoverItem[];
};

export const YEAR_SCOPE: CoverScope = { kind: 'YEAR', month: null };
export const UNKNOWN_MONTH_SCOPE: CoverScope = { kind: 'UNKNOWN_MONTH', month: null };
export const monthScope = (month: number): CoverScope => ({ kind: 'MONTH', month });

export const DEFAULT_LIMITS: Record<CoverKind, number> = { YEAR: 8, MONTH: 6, UNKNOWN_MONTH: 6 };

export const scopeKey = (scope: CoverScope) =>
  scope.kind === 'MONTH' ? `MONTH:${scope.month}` : scope.kind;

export const sameScope = (a: CoverScope, b: CoverScope) => scopeKey(a) === scopeKey(b);

const monthNames = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' });

export function monthName(month: number) {
  const name = monthNames.format(new Date(Date.UTC(2000, month - 1, 1)));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function scopeTitle(scope: CoverScope, year: number) {
  if (scope.kind === 'YEAR') return `Portada de ${year}`;
  if (scope.kind === 'UNKNOWN_MONTH') return `Sin mes de ${year}`;
  return `${monthName(scope.month!)} de ${year}`;
}

export function scopeName(scope: CoverScope) {
  if (scope.kind === 'YEAR') return 'Portada del año';
  if (scope.kind === 'UNKNOWN_MONTH') return 'Sin mes';
  return monthName(scope.month!);
}

export const dropReasonCopy: Record<DropReason, string> = {
  HIDDEN: 'está oculta',
  NOT_ACTIVE: 'ya no está en tu archivo',
  OUT_OF_SCOPE: 'ya no tiene una fecha de esta portada',
};

/** What a cover with this many chosen photos is called in the list: "Automática" or "Elegida (3)". */
export function coverStatus(item: Pick<CoverItem, 'photos' | 'dropped'> | undefined) {
  if (!item || (!item.photos.length && !item.dropped.length)) return 'Automática';
  return `Elegida (${item.photos.length})`;
}

export const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Adds a photo at the end of the choice, or removes it when it is already there (the rest
 * renumber). `blocked` means the cover is full and nothing changed.
 */
export function toggleChoice(ids: readonly string[], id: string, limit: number) {
  if (ids.includes(id)) return { ids: ids.filter((other) => other !== id), blocked: false };
  if (ids.length >= limit) return { ids: ids.slice(), blocked: true };
  return { ids: [...ids, id], blocked: false };
}

/** Moves a chosen photo one place earlier (-1) or later (1); the edges stay where they are. */
export function moveChoice(ids: readonly string[], id: string, delta: -1 | 1) {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids.slice();
  const next = ids.slice();
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * What the cover will look like: the chosen photos first, then the automatic ones the archive
 * already shows for it, never repeating a chosen photo, up to the limit.
 */
export function previewPhotos(
  chosen: readonly TimelinePhoto[],
  automatic: readonly TimelinePhoto[],
  limit: number,
) {
  const taken = new Set(chosen.map((photo) => photo.id));
  return [...chosen, ...automatic.filter((photo) => !taken.has(photo.id))].slice(0, limit);
}
