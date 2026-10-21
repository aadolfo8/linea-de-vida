import { describe, expect, it } from 'vitest';
import {
  flushBuffer,
  initialQuickState,
  nextPhotoState,
  pushDigit,
  quickKey,
  setQuickMonth,
  stepQuickYear,
} from './quick';

const now = new Date('2026-10-21T00:00:00Z');
const type = (digits: string, start = initialQuickState(null)) =>
  [...digits].reduce((state, digit) => pushDigit(state, digit, now), start);

describe('quick mode typing', () => {
  it('four digits make the year', () => {
    expect(type('1998')).toMatchObject({ year: 1998, month: null, buffer: '' });
    expect(type('2004').year).toBe(2004);
  });

  it('one or two digits make the month, after the year is set', () => {
    expect(type('8', initialQuickState(1998))).toMatchObject({ year: 1998, month: 8 });
    expect(type('11', initialQuickState(1998))).toMatchObject({ year: 1998, month: 11 });
  });

  it('keeps "1" and "2" waiting, and flushes them as January and February on save', () => {
    const waiting = type('1', initialQuickState(1998));
    expect(waiting).toMatchObject({ month: null, buffer: '1' });
    expect(flushBuffer(waiting)).toMatchObject({ year: 1998, month: 1, buffer: '' });
    expect(flushBuffer(type('2', initialQuickState(1998))).month).toBe(2);
  });

  it('does not take a leading zero or an out-of-range year', () => {
    expect(type('0', initialQuickState(1998))).toMatchObject({ month: null, buffer: '' });
    expect(type('2099', initialQuickState(1998)).year).toBe(1998);
    expect(type('1700', initialQuickState(1998)).year).toBe(1998);
  });

  it('recovers from digits that are neither a month nor a year start', () => {
    expect(type('13', initialQuickState(1998))).toMatchObject({ month: 3, buffer: '' });
    expect(type('25', initialQuickState(1998))).toMatchObject({ month: 5, buffer: '' });
  });

  it('remembers the year for the next photo and forgets the month', () => {
    const saved = setQuickMonth(initialQuickState(1998), 8);
    expect(nextPhotoState(saved)).toEqual({ year: 1998, month: null, buffer: '' });
  });

  it('steps the year inside the supported range', () => {
    expect(stepQuickYear(initialQuickState(1998), 1, 2000, now).year).toBe(1999);
    expect(stepQuickYear(initialQuickState(null), -1, 2000, now).year).toBe(1999);
    expect(stepQuickYear(initialQuickState(2026), 1, 2000, now).year).toBe(2026);
  });
});

describe('quick mode keys', () => {
  it('maps the documented keys', () => {
    expect(quickKey('Enter', false)).toEqual({ kind: 'save' });
    expect(quickKey('Escape', false)).toEqual({ kind: 'finish' });
    expect(quickKey('s', false)).toEqual({ kind: 'skip' });
    expect(quickKey('H', false)).toEqual({ kind: 'hide' });
    expect(quickKey('ArrowLeft', false)).toEqual({ kind: 'year-step', delta: -1 });
    expect(quickKey('ArrowRight', false)).toEqual({ kind: 'year-step', delta: 1 });
    expect(quickKey('7', false)).toEqual({ kind: 'digit', digit: '7' });
  });

  it('leaves letters, digits and arrows to a focused text field but keeps Enter and Escape', () => {
    expect(quickKey('7', true)).toEqual({ kind: 'none' });
    expect(quickKey('s', true)).toEqual({ kind: 'none' });
    expect(quickKey('ArrowLeft', true)).toEqual({ kind: 'none' });
    expect(quickKey('Enter', true)).toEqual({ kind: 'save' });
    expect(quickKey('Escape', true)).toEqual({ kind: 'finish' });
  });
});
