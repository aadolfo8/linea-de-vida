import type { DateDraft, DatePayload, DatePrecision, FolderDateRule } from './types';

export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const MONTH_ABBREVIATIONS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

export const MIN_YEAR = 1800;
export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

/** Stored dates are read back without the "not in the future" cap. */
const NO_CAP = new Date(Date.UTC(9999, 0, 1));

export const maxYear = (now: Date = new Date()) => now.getUTCFullYear();

export const clampYear = (year: number, now: Date = new Date()) =>
  Math.min(maxYear(now), Math.max(MIN_YEAR, Math.trunc(year)));

/** A four-digit year within range, or `null` while the text is not one yet. */
export function parseYearInput(text: string, now: Date = new Date()): number | null {
  if (!/^\d{4}$/.test(text.trim())) return null;
  const year = Number(text);
  return year >= MIN_YEAR && year <= maxYear(now) ? year : null;
}

export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export const monthName = (month: number) => capitalize(MONTH_NAMES[month - 1] ?? '');

/** Keeps a draft coherent: a day needs a month, and cannot exceed the month's length. */
export function normalizeDraft(draft: DateDraft, now: Date = new Date()): DateDraft {
  const year = clampYear(draft.year, now);
  const month = draft.month && draft.month >= 1 && draft.month <= 12 ? draft.month : null;
  const day =
    month && draft.day && draft.day >= 1 ? Math.min(draft.day, daysInMonth(year, month)) : null;
  return { year, month, day };
}

/** The request body for a draft: precision follows exactly what the person knows. */
export function draftToPayload(draft: DateDraft, now: Date = new Date()): DatePayload {
  const { year, month, day } = normalizeDraft(draft, now);
  if (month && day) return { year, month, day, precision: 'DAY' };
  if (month) return { year, month, precision: 'MONTH' };
  return { year, precision: 'YEAR' };
}

/** "2004", "Agosto de 2004" or "12 de agosto de 2004". */
export function draftLabel(draft: DateDraft, now: Date = new Date()) {
  const { year, month, day } = normalizeDraft(draft, now);
  if (month && day) return `${day} de ${MONTH_NAMES[month - 1]} de ${year}`;
  if (month) return `${monthName(month)} de ${year}`;
  return String(year);
}

/** Reads a stored date back into the parts the person would enter. */
export function draftFromStored(value: string | null, precision: DatePrecision): DateDraft | null {
  if (!value || precision === 'UNKNOWN') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (precision === 'YEAR') return { year, month: null, day: null };
  if (precision === 'MONTH') return { year, month, day: null };
  return { year, month, day };
}

export function payloadFromStored(value: string | null, precision: DatePrecision) {
  const draft = draftFromStored(value, precision);
  return draft ? draftToPayload(draft, NO_CAP) : null;
}

/** The label of a stored date, or `null` when the photo has none. */
export function storedLabel(value: string | null, precision: DatePrecision) {
  const draft = draftFromStored(value, precision);
  return draft ? draftLabel(draft, NO_CAP) : null;
}

/** Short label for a tile or a folder: "2004", "ago 2004" or "12 ago 2004". */
export function storedShortLabel(value: string | null, precision: DatePrecision) {
  const draft = draftFromStored(value, precision);
  if (!draft) return null;
  if (draft.month && draft.day)
    return `${draft.day} ${MONTH_ABBREVIATIONS[draft.month - 1]} ${draft.year}`;
  if (draft.month) return `${MONTH_ABBREVIATIONS[draft.month - 1]} ${draft.year}`;
  return String(draft.year);
}

export const ruleShortLabel = (rule: Pick<FolderDateRule, 'dateValue' | 'precision'>) =>
  storedShortLabel(rule.dateValue, rule.precision);

export const stepYear = (year: number, delta: number, now: Date = new Date()) =>
  clampYear(year + delta, now);

export const originLabels = {
  camera: 'cámara',
  google: 'Google Fotos',
  filename: 'por su nombre',
  folder: 'carpeta',
  manual: 'a mano',
  none: '',
} as const;

export const photoCountText = (count: number) =>
  `${count.toLocaleString('es-ES')} ${count === 1 ? 'foto' : 'fotos'}`;

/** The ISO value the API would store for a date request: the first instant of its period. */
export const storedValueFromPayload = (payload: DatePayload) =>
  new Date(Date.UTC(payload.year, (payload.month ?? 1) - 1, payload.day ?? 1)).toISOString();

/** Where "Ver en la cronología" goes for a date: its month, or its year when the month is unknown. */
export const timelinePathFor = (payload: Pick<DatePayload, 'year' | 'month'>) =>
  `/timeline/${payload.year}${payload.month ? `/${payload.month}` : ''}`;
