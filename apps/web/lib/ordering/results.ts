import { payloadFromStored } from './dates';
import type { DatePayload, OrderingPhoto, PerIdResult, Pile } from './types';

/** What each batch endpoint says a single id can end as. Anything unlisted counts as a failure. */
export const DATE_STATUSES = { changed: ['UPDATED'], unchanged: [] as string[] };
export const CLEAR_STATUSES = { changed: ['CLEARED'], unchanged: ['NO_MANUAL_DATE'] };
export const HIDE_STATUSES = { changed: ['HIDDEN'], unchanged: ['ALREADY_HIDDEN'] };
export const UNHIDE_STATUSES = { changed: ['VISIBLE'], unchanged: ['ALREADY_VISIBLE'] };

export type Classified = { changed: string[]; unchanged: string[]; failed: string[] };

export function classifyResults(
  results: readonly PerIdResult[],
  statuses: { changed: readonly string[]; unchanged: readonly string[] },
): Classified {
  const out: Classified = { changed: [], unchanged: [], failed: [] };
  for (const { id, status } of results) {
    if (statuses.changed.includes(status)) out.changed.push(id);
    else if (statuses.unchanged.includes(status)) out.unchanged.push(id);
    else out.failed.push(id);
  }
  return out;
}

/** Ids the request named but the response did not answer for are failures too. */
export function withMissingAsFailed(requested: readonly string[], classified: Classified) {
  const answered = new Set([...classified.changed, ...classified.unchanged, ...classified.failed]);
  return {
    ...classified,
    failed: [...classified.failed, ...requested.filter((id) => !answered.has(id))],
  };
}

/** The pile a photo belongs to once it has this precision (and is not hidden). */
export function pileForPrecision(precision: DatePayload['precision'] | 'UNKNOWN'): Pile {
  if (precision === 'YEAR') return 'yearOnly';
  if (precision === 'UNKNOWN') return 'undated';
  return 'dated';
}

export type RestorePlan = {
  /** Photos that had a manual date: put it back, one request per distinct date. */
  sets: Array<{ ids: string[]; payload: DatePayload }>;
  /** Photos that had no manual date: clearing returns them to whatever was detected. */
  clears: string[];
};

/**
 * How to undo a date change: re-apply each photo's previous manual date, and clear the manual
 * date of the ones that had none. The photos' previous state is read before the change.
 */
export function planRestore(previous: readonly OrderingPhoto[]): RestorePlan {
  const groups = new Map<string, { ids: string[]; payload: DatePayload }>();
  const clears: string[] = [];
  for (const photo of previous) {
    const { value, precision, originKind } = photo.effectiveDate;
    const payload = originKind === 'manual' ? payloadFromStored(value, precision) : null;
    if (!payload) {
      clears.push(photo.id);
      continue;
    }
    const key = `${payload.precision}:${payload.year}:${payload.month ?? ''}:${payload.day ?? ''}`;
    const group = groups.get(key) ?? { ids: [], payload };
    group.ids.push(photo.id);
    groups.set(key, group);
  }
  return { sets: [...groups.values()], clears };
}

/** Photos with a manual date, the only ones "Quitar fecha" can change. */
export const withManualDate = (photos: readonly OrderingPhoto[]) =>
  photos.filter((photo) => photo.effectiveDate.originKind === 'manual');
