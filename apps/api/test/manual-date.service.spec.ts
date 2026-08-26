import { describe, expect, it } from 'vitest';
import { effectiveDate, ManualDateService, validateManualDate } from '../src/manual-date.service';

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

  it('uses a folder rule only as a fallback unless its scope explicitly replaces detection', () => {
    const detected = {
      detectedDate: new Date('2020-03-04T00:00:00.000Z'),
      detectedPrecision: 'DAY' as const,
      detectedSource: 'EXIF' as const,
    };
    const rule = {
      dateValue: new Date('1998-01-01T00:00:00.000Z'),
      precision: 'YEAR' as const,
      scope: 'FALLBACK_DESCENDANTS' as const,
    };
    expect(effectiveDate({ ...detected, folderRule: rule })).toMatchObject({ origin: 'EXIF' });
    expect(
      effectiveDate({
        ...detected,
        folderRule: { ...rule, scope: 'ALL_DESCENDANTS' },
      }),
    ).toMatchObject({ origin: 'FOLDER_RULE', precision: 'YEAR' });
    expect(
      effectiveDate({
        detectedDate: null,
        detectedPrecision: 'UNKNOWN',
        detectedSource: 'NONE',
        folderRule: rule,
      }),
    ).toMatchObject({ origin: 'FOLDER_RULE', precision: 'YEAR' });
  });

  it('prefers an explicit folder rule over a date inferred from a folder name', () => {
    expect(
      effectiveDate({
        detectedDate: new Date('1998-01-01T00:00:00.000Z'),
        detectedPrecision: 'YEAR',
        detectedSource: 'FOLDER',
        folderRule: {
          dateValue: new Date('2004-07-01T00:00:00.000Z'),
          precision: 'MONTH',
          scope: 'FALLBACK_DESCENDANTS',
        },
      }),
    ).toMatchObject({ origin: 'FOLDER_RULE', precision: 'MONTH' });
  });

  it('always keeps an individual manual correction above a folder rule', () => {
    expect(
      effectiveDate({
        detectedDate: null,
        detectedPrecision: 'UNKNOWN',
        detectedSource: 'NONE',
        folderRule: {
          dateValue: new Date('1998-01-01T00:00:00.000Z'),
          precision: 'YEAR',
          scope: 'ALL_DESCENDANTS',
        },
        override: { dateValue: new Date('2004-07-01T00:00:00.000Z'), precision: 'MONTH' },
      }),
    ).toMatchObject({ origin: 'MANUAL', precision: 'MONTH' });
  });

  it('retains a persisted folder-rule result when the rule is not loaded with the photo', () => {
    expect(
      effectiveDate({
        detectedDate: null,
        detectedPrecision: 'UNKNOWN',
        detectedSource: 'NONE',
        effectiveDateValue: new Date('1998-01-01T00:00:00.000Z'),
        effectiveDatePrecision: 'YEAR',
        effectiveDateSource: 'FOLDER_RULE',
      }),
    ).toMatchObject({ origin: 'FOLDER_RULE', precision: 'YEAR' });
  });
});

describe('removing a manual date', () => {
  it('restores the applicable folder rule instead of leaving the photo undated', async () => {
    let update: any;
    const prisma: any = {
      photo: {
        findFirst: async () => ({
          id: 'photo',
          userId: 'owner',
          sourceId: 'source',
          folderId: 'child',
          detectedDate: null,
          detectedPrecision: 'UNKNOWN',
          detectedSource: 'NONE',
          effectiveDateValue: new Date('2010-01-01T00:00:00.000Z'),
          effectiveDatePrecision: 'YEAR',
          effectiveDateSource: 'MANUAL',
        }),
        update: async (args: any) => {
          update = args;
          return args.data;
        },
      },
      indexedFolder: {
        findMany: async () => [
          {
            id: 'root',
            parentId: null,
            dateRule: {
              dateValue: new Date('1998-01-01T00:00:00.000Z'),
              precision: 'YEAR',
              scope: 'FALLBACK_DESCENDANTS',
            },
          },
          { id: 'child', parentId: 'root', dateRule: null },
        ],
      },
      manualDateOverride: { deleteMany: async () => ({ count: 1 }) },
      $transaction: async (operation: (tx: any) => unknown) => operation(prisma),
    };

    await new ManualDateService(prisma).remove('owner', 'photo');

    expect(update.data).toMatchObject({
      effectiveDateValue: new Date('1998-01-01T00:00:00.000Z'),
      effectiveDatePrecision: 'YEAR',
      effectiveDateSource: 'FOLDER_RULE',
    });
  });
});
