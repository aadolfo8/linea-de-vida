import { describe, expect, it } from 'vitest';
import { effectiveDate, validateManualDate } from '../src/manual-date.service';

describe('manual date validation', () => {
  it('uses a technical anchor while preserving partial precision', () => {
    const value = validateManualDate({ year: 2024, month: 2, precision: 'MONTH' });
    expect(value).toMatchObject({ precision: 'MONTH' });
    expect(value.dateValue.toISOString()).toBe('2024-02-01T00:00:00.000Z');
  });

  it.each([
    { year: 1899, precision: 'YEAR' },
    { year: 2024, month: 13, precision: 'MONTH' },
    { year: 2023, month: 2, day: 29, precision: 'DAY' },
    { year: 2024, day: 29, precision: 'DAY' },
    { year: 2024, month: 3, precision: 'YEAR' },
  ])('rejects invalid or inconsistent input %#', (input) => {
    expect(() => validateManualDate(input)).toThrow();
  });
});

describe('effective date', () => {
  it('prefers a manual value and restores the detected value when it is absent', () => {
    const detected = {
      detectedDate: new Date('2020-03-04T00:00:00.000Z'),
      detectedPrecision: 'DAY' as const,
      detectedSource: 'EXIF' as const,
    };
    expect(
      effectiveDate({
        ...detected,
        override: { dateValue: new Date('2024-01-01'), precision: 'YEAR' },
      }),
    ).toMatchObject({ origin: 'MANUAL', precision: 'YEAR' });
    expect(effectiveDate(detected)).toMatchObject({
      origin: 'EXIF',
      precision: 'DAY',
      value: detected.detectedDate,
    });
  });
});
