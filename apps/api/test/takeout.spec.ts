import { describe, expect, it } from 'vitest';
import { PhotoDateResolver } from '../src/date-resolver';
import { TakeoutMatcher, TakeoutMetadataParser } from '../src/takeout';

describe('TakeoutMetadataParser', () => {
  const parser = new TakeoutMetadataParser();
  it('accepts a small valid metadata subset and usable GPS', () =>
    expect(
      parser.parse(
        '{"title":"sunset.jpg","photoTakenTime":{"timestamp":"1704067200"},"geoData":{"latitude":40.4,"longitude":-3.7}}',
      ),
    ).toMatchObject({
      kind: 'VALID',
      metadata: { title: 'sunset.jpg', location: { latitude: 40.4 } },
    }));
  it.each([
    '{',
    '[]',
    '{"title":3}',
    '{"photoTakenTime":{"timestamp":"no"}}',
    '{"geoData":{"latitude":99,"longitude":0}}',
  ])('rejects untrusted JSON %#', (raw) => expect(parser.parse(raw).kind).toBe('INVALID'));
});

describe('TakeoutMatcher', () => {
  const matcher = new TakeoutMatcher();
  it('prefers an exact adjacent sidecar over title alternatives', () =>
    expect(
      matcher.match('IMG_1.jpg', [
        { fileName: 'IMG_1.jpg.json', metadata: { title: 'other.jpg' } },
      ]),
    ).toMatchObject({ status: 'TAKEOUT_MATCHED', reason: 'adjacent-sidecar-exact' }));
  it('normalizes duplicate suffixes and extension variants', () =>
    expect(
      matcher.match('Álbum (1).JPG', [{ fileName: 'Album.jpg.json', metadata: {} }]),
    ).toMatchObject({ status: 'TAKEOUT_MATCHED' }));
  it('does not guess between equivalent candidates', () =>
    expect(
      matcher.match('photo.jpg', [
        { fileName: 'first.json', metadata: { title: 'photo.jpg' } },
        { fileName: 'other.json', metadata: { title: 'photo.jpg' } },
      ]),
    ).toMatchObject({ status: 'TAKEOUT_AMBIGUOUS' }));
  it('keeps photos when no JSON candidate exists', () =>
    expect(matcher.match('missing.jpg', []).status).toBe('TAKEOUT_NOT_FOUND'));
});

describe('Takeout date precedence', () => {
  it('uses Takeout after Drive and before folders', () => {
    const resolver = new PhotoDateResolver();
    expect(
      resolver.resolve({
        takeoutPhotoTakenTime: '2020-02-03T00:00:00.000Z',
        folderSegments: ['2024'],
      }),
    ).toMatchObject({ source: 'TAKEOUT' });
    expect(
      resolver.resolve({
        driveImageTime: '2021-02-03T00:00:00.000Z',
        takeoutPhotoTakenTime: '2020-02-03T00:00:00.000Z',
        folderSegments: [],
      }),
    ).toMatchObject({ source: 'DRIVE_IMAGE_METADATA' });
  });
});
