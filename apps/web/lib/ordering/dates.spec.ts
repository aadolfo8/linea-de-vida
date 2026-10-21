import { describe, expect, it } from 'vitest';
import {
  clampYear,
  daysInMonth,
  draftFromStored,
  draftLabel,
  draftToPayload,
  normalizeDraft,
  parseYearInput,
  payloadFromStored,
  ruleShortLabel,
  stepYear,
  storedLabel,
  storedShortLabel,
} from './dates';

const now = new Date('2026-10-21T00:00:00Z');

describe('date drafts', () => {
  it('derives the precision from what the person knows', () => {
    expect(draftToPayload({ year: 1998, month: null, day: null }, now)).toEqual({
      year: 1998,
      precision: 'YEAR',
    });
    expect(draftToPayload({ year: 2004, month: 8, day: null }, now)).toEqual({
      year: 2004,
      month: 8,
      precision: 'MONTH',
    });
    expect(draftToPayload({ year: 2004, month: 8, day: 12 }, now)).toEqual({
      year: 2004,
      month: 8,
      day: 12,
      precision: 'DAY',
    });
  });

  it('drops a day that has no month and clamps it to the month length', () => {
    expect(normalizeDraft({ year: 2004, month: null, day: 12 }, now)).toEqual({
      year: 2004,
      month: null,
      day: null,
    });
    expect(draftToPayload({ year: 2023, month: 2, day: 31 }, now).day).toBe(28);
    expect(draftToPayload({ year: 2024, month: 2, day: 31 }, now).day).toBe(29);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it('keeps the year inside the supported range', () => {
    expect(clampYear(1500, now)).toBe(1800);
    expect(clampYear(2999, now)).toBe(2026);
    expect(stepYear(2026, 1, now)).toBe(2026);
    expect(stepYear(1998, -1, now)).toBe(1997);
  });

  it('accepts only complete, in-range years from text', () => {
    expect(parseYearInput('1998', now)).toBe(1998);
    expect(parseYearInput('199', now)).toBeNull();
    expect(parseYearInput('abcd', now)).toBeNull();
    expect(parseYearInput('1700', now)).toBeNull();
    expect(parseYearInput('2099', now)).toBeNull();
  });

  it('writes labels in Spanish', () => {
    expect(draftLabel({ year: 1998, month: null, day: null }, now)).toBe('1998');
    expect(draftLabel({ year: 2004, month: 8, day: null }, now)).toBe('Agosto de 2004');
    expect(draftLabel({ year: 2004, month: 8, day: 12 }, now)).toBe('12 de agosto de 2004');
  });
});

describe('stored dates', () => {
  it('reads a stored value back by its precision', () => {
    expect(draftFromStored('2004-08-01T00:00:00.000Z', 'MONTH')).toEqual({
      year: 2004,
      month: 8,
      day: null,
    });
    expect(draftFromStored('2004-08-12T00:00:00.000Z', 'DAY')).toEqual({
      year: 2004,
      month: 8,
      day: 12,
    });
    expect(draftFromStored('1998-01-01T00:00:00.000Z', 'YEAR')).toEqual({
      year: 1998,
      month: null,
      day: null,
    });
    expect(draftFromStored(null, 'UNKNOWN')).toBeNull();
    expect(draftFromStored('not a date', 'DAY')).toBeNull();
  });

  it('rebuilds the request body of a stored date, for undo', () => {
    expect(payloadFromStored('2004-08-01T00:00:00.000Z', 'MONTH')).toEqual({
      year: 2004,
      month: 8,
      precision: 'MONTH',
    });
    expect(payloadFromStored(null, 'UNKNOWN')).toBeNull();
  });

  it('labels stored dates in full and short form', () => {
    expect(storedLabel('2004-08-12T00:00:00.000Z', 'DAY')).toBe('12 de agosto de 2004');
    expect(storedShortLabel('2004-08-01T00:00:00.000Z', 'MONTH')).toBe('ago 2004');
    expect(storedShortLabel('1998-01-01T00:00:00.000Z', 'YEAR')).toBe('1998');
    expect(storedLabel(null, 'UNKNOWN')).toBeNull();
    expect(ruleShortLabel({ dateValue: '1998-01-01T00:00:00.000Z', precision: 'YEAR' })).toBe(
      '1998',
    );
  });
});

describe('request helpers', () => {
  it('stores the first instant of the period and links to the timeline', async () => {
    const { storedValueFromPayload, timelinePathFor } = await import('./dates');
    expect(storedValueFromPayload({ year: 2004, month: 8, precision: 'MONTH' })).toBe(
      '2004-08-01T00:00:00.000Z',
    );
    expect(storedValueFromPayload({ year: 1998, precision: 'YEAR' })).toBe(
      '1998-01-01T00:00:00.000Z',
    );
    expect(timelinePathFor({ year: 2004, month: 8 })).toBe('/timeline/2004/8');
    expect(timelinePathFor({ year: 1998 })).toBe('/timeline/1998');
  });
});
