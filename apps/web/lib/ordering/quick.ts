import { clampYear } from './dates';

/**
 * Typing state of "Fechar una a una". Digits build either a year (four digits) or a month (one or
 * two); the year is remembered from one photo to the next, the month starts empty on each photo.
 */
export type QuickState = {
  year: number | null;
  month: number | null;
  /** Digits typed but not yet a year or a month ("1" may still become 12 or 1998). */
  buffer: string;
};

export const initialQuickState = (year: number | null): QuickState => ({
  year,
  month: null,
  buffer: '',
});

/** Next photo: the year stays, the month and any half-typed digits go. */
export const nextPhotoState = (state: QuickState): QuickState => ({
  year: state.year,
  month: null,
  buffer: '',
});

const isMonth = (value: string) => value !== '' && Number(value) >= 1 && Number(value) <= 12;

export function pushDigit(state: QuickState, digit: string, now: Date = new Date()): QuickState {
  const buffer = state.buffer + digit;
  if (buffer.length === 4) {
    const year = Number(buffer);
    return year >= 1800 && year <= now.getUTCFullYear()
      ? { ...state, year, buffer: '' }
      : { ...state, buffer: '' };
  }
  // "1" and "2" may still become a month (10-12) or the start of a year (19xx, 20xx).
  if (buffer === '1' || buffer === '2') return { ...state, buffer };
  if (buffer.length === 1)
    return buffer === '0' ? state : { ...state, month: Number(buffer), buffer: '' };
  if (buffer.length === 2) {
    if (buffer === '10' || buffer === '11' || buffer === '12')
      return { ...state, month: Number(buffer), buffer: '' };
    if (buffer === '18' || buffer === '19' || buffer === '20') return { ...state, buffer };
    // Not a month and not a year start ("13", "25"): the last digit starts over.
    return pushDigit({ ...state, buffer: '' }, digit, now);
  }
  return { ...state, buffer };
}

/** Commits digits left over when the person saves ("1" then Enter means January). */
export function flushBuffer(state: QuickState): QuickState {
  if (isMonth(state.buffer) && state.buffer.length <= 2)
    return { ...state, month: Number(state.buffer), buffer: '' };
  return { ...state, buffer: '' };
}

export function stepQuickYear(
  state: QuickState,
  delta: number,
  fallbackYear = 2000,
  now: Date = new Date(),
): QuickState {
  return {
    ...state,
    buffer: '',
    year: clampYear((state.year ?? fallbackYear) + delta, now),
  };
}

export function setQuickYear(state: QuickState, year: number | null): QuickState {
  return { ...state, buffer: '', year };
}

export function setQuickMonth(state: QuickState, month: number | null): QuickState {
  return { ...state, buffer: '', month };
}

export type QuickKey =
  | { kind: 'digit'; digit: string }
  | { kind: 'year-step'; delta: number }
  | { kind: 'save' }
  | { kind: 'skip' }
  | { kind: 'hide' }
  | { kind: 'finish' }
  | { kind: 'none' };

/** Which quick-mode command a key press is. Typing in a text field is left to the field. */
export function quickKey(key: string, inTextField: boolean): QuickKey {
  if (key === 'Escape') return { kind: 'finish' };
  if (key === 'Enter') return { kind: 'save' };
  if (inTextField) return { kind: 'none' };
  if (/^[0-9]$/.test(key)) return { kind: 'digit', digit: key };
  if (key === 'ArrowLeft') return { kind: 'year-step', delta: -1 };
  if (key === 'ArrowRight') return { kind: 'year-step', delta: 1 };
  if (key === 's' || key === 'S') return { kind: 'skip' };
  if (key === 'h' || key === 'H') return { kind: 'hide' };
  return { kind: 'none' };
}
