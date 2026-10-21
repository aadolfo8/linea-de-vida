import { describe, expect, it } from 'vitest';
import {
  CLEAR_STATUSES,
  DATE_STATUSES,
  HIDE_STATUSES,
  classifyResults,
  pileForPrecision,
  planRestore,
  withManualDate,
  withMissingAsFailed,
} from './results';
import type { OrderingPhoto } from './types';

const photo = (
  id: string,
  originKind: OrderingPhoto['effectiveDate']['originKind'],
  value: string | null,
  precision: OrderingPhoto['effectiveDate']['precision'],
): OrderingPhoto => ({
  id,
  fileName: `${id}.jpg`,
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  effectiveDate: { value, precision, origin: originKind.toUpperCase(), originKind },
  hidden: false,
  folderId: null,
});

describe('per-id results', () => {
  it('separates changed, unchanged and failed ids', () => {
    const results = [
      { id: 'a', status: 'UPDATED' },
      { id: 'b', status: 'NOT_FOUND' },
      { id: 'c', status: 'FAILED' },
    ];
    expect(classifyResults(results, DATE_STATUSES)).toEqual({
      changed: ['a'],
      unchanged: [],
      failed: ['b', 'c'],
    });
    expect(
      classifyResults(
        [
          { id: 'a', status: 'CLEARED' },
          { id: 'b', status: 'NO_MANUAL_DATE' },
        ],
        CLEAR_STATUSES,
      ),
    ).toEqual({ changed: ['a'], unchanged: ['b'], failed: [] });
    expect(
      classifyResults([{ id: 'a', status: 'ALREADY_HIDDEN' }], HIDE_STATUSES).unchanged,
    ).toEqual(['a']);
  });

  it('treats an unknown status and a missing answer as failures', () => {
    const classified = classifyResults([{ id: 'a', status: 'SOMETHING_NEW' }], DATE_STATUSES);
    expect(classified.failed).toEqual(['a']);
    expect(withMissingAsFailed(['a', 'z'], classified).failed).toEqual(['a', 'z']);
  });

  it('maps a precision to its pile', () => {
    expect(pileForPrecision('YEAR')).toBe('yearOnly');
    expect(pileForPrecision('MONTH')).toBe('dated');
    expect(pileForPrecision('DAY')).toBe('dated');
    expect(pileForPrecision('UNKNOWN')).toBe('undated');
  });
});

describe('restore plan', () => {
  it('re-applies previous manual dates grouped by value and clears the rest', () => {
    const plan = planRestore([
      photo('a', 'manual', '2004-08-01T00:00:00.000Z', 'MONTH'),
      photo('b', 'manual', '2004-08-01T00:00:00.000Z', 'MONTH'),
      photo('c', 'manual', '1998-01-01T00:00:00.000Z', 'YEAR'),
      photo('d', 'camera', '2001-05-03T00:00:00.000Z', 'DAY'),
      photo('e', 'none', null, 'UNKNOWN'),
    ]);
    expect(plan.sets).toEqual([
      { ids: ['a', 'b'], payload: { year: 2004, month: 8, precision: 'MONTH' } },
      { ids: ['c'], payload: { year: 1998, precision: 'YEAR' } },
    ]);
    expect(plan.clears).toEqual(['d', 'e']);
  });

  it('keeps only photos with a manual date for "Quitar fecha"', () => {
    const list = [
      photo('a', 'manual', '1998-01-01T00:00:00.000Z', 'YEAR'),
      photo('b', 'none', null, 'UNKNOWN'),
    ];
    expect(withManualDate(list).map((item) => item.id)).toEqual(['a']);
  });
});
