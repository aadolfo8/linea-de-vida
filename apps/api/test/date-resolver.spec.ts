import { describe, expect, it } from 'vitest';
import { FolderDateParser, PhotoDateResolver } from '../src/date-resolver';
describe('FolderDateParser', () => {
  const parser = new FolderDateParser();
  it('parses Spanish month hierarchy without inventing a day', () =>
    expect(parser.parse(['Fotos', '2024', 'marzo'])).toMatchObject({
      precision: 'MONTH',
      source: 'FOLDER',
    }));
  it('uses a deterministic full date only to classify its month', () =>
    expect(parser.parse(['2024-03-14'])).toMatchObject({ precision: 'MONTH' }));
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
    ).toMatchObject({ source: 'DRIVE_IMAGE_METADATA', precision: 'MONTH' }));
});
