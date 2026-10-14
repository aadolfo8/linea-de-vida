import { describe, expect, it } from 'vitest';
import { FolderDateParser, PhotoDateResolver } from '../src/date-resolver';
describe('FolderDateParser', () => {
  const parser = new FolderDateParser();
  it('parses Spanish month hierarchy without inventing a day', () =>
    expect(parser.parse(['Fotos', '2024', 'marzo'])).toMatchObject({
      precision: 'MONTH',
      source: 'FOLDER',
    }));
  it.each(['2024-03-14', '2024_03_14', '14 marzo 2024'])(
    'preserves the known day in %s',
    (folder) =>
      expect(parser.parse([folder])).toEqual({
        value: new Date('2024-03-14T00:00:00Z'),
        precision: 'DAY',
        source: 'FOLDER',
      }),
  );
  it('keeps a year-only folder at YEAR precision', () =>
    expect(parser.parse(['Family', '2024'])).toEqual({
      value: new Date('2024-01-01T00:00:00Z'),
      precision: 'YEAR',
      source: 'FOLDER',
    }));
  it('preserves a leap day but rejects an impossible full date', () => {
    expect(parser.parse(['2024-02-29'])).toMatchObject({
      value: new Date('2024-02-29T00:00:00Z'),
      precision: 'DAY',
    });
    expect(parser.parse(['2023-02-29'])).toMatchObject({ value: null, precision: 'UNKNOWN' });
  });
  it('recognizes abbreviated Spanish month folders', () =>
    expect(parser.parse(['2008', 'Ago'])).toMatchObject({ precision: 'MONTH', source: 'FOLDER' }));
  it('rejects ambiguous folders', () =>
    expect(parser.parse(['vacaciones', '24'])).toMatchObject({
      precision: 'UNKNOWN',
      value: null,
    }));
});
describe('PhotoDateResolver', () => {
  it('prefers Drive image metadata over folders', () =>
    expect(
      new PhotoDateResolver().resolve({
        driveImageTime: '2020-02-03T12:00:00Z',
        folderSegments: ['2024'],
      }),
    ).toMatchObject({ source: 'DRIVE_IMAGE_METADATA', precision: 'DAY' }));
  it.each([
    ['exifDate', 'EXIF'],
    ['driveImageTime', 'DRIVE_IMAGE_METADATA'],
    ['takeoutPhotoTakenTime', 'TAKEOUT'],
  ] as const)('preserves DAY precision from %s', (field, source) => {
    expect(
      new PhotoDateResolver().resolve({
        [field]: '2020-02-03T12:00:00Z',
        folderSegments: ['2024', 'marzo'],
      }),
    ).toEqual({ value: new Date('2020-02-03T00:00:00Z'), precision: 'DAY', source });
  });
  it('falls back to partial folder evidence when metadata is invalid', () => {
    expect(
      new PhotoDateResolver().resolve({
        driveImageTime: 'invalid',
        folderSegments: ['2024', 'marzo'],
      }),
    ).toEqual({
      value: new Date('2024-03-01T00:00:00Z'),
      precision: 'MONTH',
      source: 'FOLDER',
    });
  });
});
