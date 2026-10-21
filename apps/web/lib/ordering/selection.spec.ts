import { describe, expect, it } from 'vitest';
import {
  addAll,
  allSelected,
  chunk,
  rangeIds,
  removeAll,
  selectRange,
  toggleId,
} from './selection';

const ids = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('toggles one id without touching the original set', () => {
    const base = new Set(['a']);
    expect([...toggleId(base, 'b')]).toEqual(['a', 'b']);
    expect([...toggleId(base, 'a')]).toEqual([]);
    expect([...base]).toEqual(['a']);
  });

  it('selects a range in either direction, including both ends', () => {
    expect(rangeIds(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect([...selectRange(new Set(['a']), ids, 'c', 'e')]).toEqual(['a', 'c', 'd', 'e']);
  });

  it('falls back to the clicked tile without a usable anchor', () => {
    expect(rangeIds(ids, null, 'c')).toEqual(['c']);
    expect(rangeIds(ids, 'gone', 'c')).toEqual(['c']);
    expect(rangeIds(ids, 'a', 'gone')).toEqual([]);
  });

  it('adds and removes many ids and detects a full selection', () => {
    const all = addAll(new Set(), ids);
    expect(allSelected(all, ids)).toBe(true);
    expect(allSelected(new Set(), [])).toBe(false);
    expect([...removeAll(all, ['a', 'b'])]).toEqual(['c', 'd', 'e']);
  });

  it('splits long lists for the API limit', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
