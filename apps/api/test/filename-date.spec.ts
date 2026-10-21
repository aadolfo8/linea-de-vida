import { describe, expect, it } from 'vitest';
import { parseFilenameDate } from '../src/filename-date';
import { PhotoDateResolver } from '../src/date-resolver';

const today = new Date('2026-10-21T12:00:00Z');
const parse = (name: string) => parseFilenameDate(name, today);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('parseFilenameDate', () => {
  it.each([
    ['IMG-20190812-WA0001.jpg', '2019-08-12', 'whatsapp'],
    ['VID-20190812-WA0034.mp4', '2019-08-12', 'whatsapp'],
    ['img-20190812-wa0001.JPG', '2019-08-12', 'whatsapp'],
    ['IMG-20190812-WA0001-edited.jpg', '2019-08-12', 'whatsapp'],
    ['WhatsApp Image 2019-08-12 at 10.20.30.jpeg', '2019-08-12', 'whatsapp'],
    ['WhatsApp Image 2019-08-12 at 10.20.30 (1).jpeg', '2019-08-12', 'whatsapp'],
    ['WhatsApp Video 2019-08-12 at 10.20.30.mp4', '2019-08-12', 'whatsapp'],
    ['Imagen de WhatsApp 2019-08-12 a las 10.20.30.jpg', '2019-08-12', 'whatsapp'],
    ['IMG_20190812_123456.jpg', '2019-08-12', 'android-camera'],
    ['IMG_20190812_123456_1.jpg', '2019-08-12', 'android-camera'],
    ['IMG_20190812_123456789.jpg', '2019-08-12', 'android-camera'],
    ['VID_20190812_123456.mp4', '2019-08-12', 'android-camera'],
    ['MVIMG_20190812_123456.jpg', '2019-08-12', 'android-camera'],
    ['PXL_20190812_123456789.jpg', '2019-08-12', 'pixel'],
    ['PXL_20190812_123456789.MP.jpg', '2019-08-12', 'pixel'],
    ['Screenshot_2019-08-12-12-34-56.png', '2019-08-12', 'screenshot'],
    ['Screenshot_20190812-123456.png', '2019-08-12', 'screenshot'],
    ['Screenshot from 2019-08-12 12-34-56.png', '2019-08-12', 'screenshot'],
    ['Captura de pantalla 2019-08-12 a las 12.34.56.png', '2019-08-12', 'screenshot'],
    ['Screen Shot 2019-08-12 at 10.20.30.png', '2019-08-12', 'screenshot'],
    ['signal-2019-08-12-12-34-56-123.jpg', '2019-08-12', 'messenger'],
    ['20190812_123456.jpg', '2019-08-12', 'timestamp'],
    ['20190812_123456_001.jpg', '2019-08-12', 'timestamp'],
    ['2019-08-12 12.34.56.jpg', '2019-08-12', 'timestamp'],
    ['2019-08-12_12-34-56.jpg', '2019-08-12', 'timestamp'],
    ['IMG_20240229_101010.jpg', '2024-02-29', 'android-camera'],
  ])('reads %s', (name, date, kind) => {
    expect(parse(name)).toEqual({ value: day(date), kind });
  });

  it.each([
    'IMG_1234.jpg',
    'BURST20190812123456.jpg', // no separator, not a supported pattern
    'DSC00123.JPG',
    'IMG_20191340_120000.jpg', // month 13
    'IMG_20190230_120000.jpg', // 30 February
    'IMG_20230229_120000.jpg', // 2023 is not a leap year
    'IMG_20190812_256000.jpg', // time 25:60:00
    'IMG_20990101_120000.jpg', // future
    'IMG_18990101_120000.jpg', // before 1900
    'IMG-20190812-0001.jpg', // not the WhatsApp counter
    'IMG-20190812.jpg', // no marker, no time
    '20190812.jpg', // bare eight digits
    '12345678_123456.jpg', // digits that are not a date
    '20191340_123456.jpg',
    'VID_20190812_999999.mp4',
    'WhatsApp Image 2019-13-12 at 10.20.30.jpeg',
    'Screenshot_1.png',
    'Screenshot 2019.png',
    'photo 2019-08-12.jpg',
    'Holiday 2019-08-12 family.jpg',
    'PXL_20190812_12.jpg',
    '',
  ])('rejects %s', (name) => {
    expect(parse(name)).toBeNull();
  });

  it('accepts today but not tomorrow', () => {
    expect(parse('IMG_20261021_090000.jpg')).toEqual({
      value: day('2026-10-21'),
      kind: 'android-camera',
    });
    expect(parse('IMG_20261022_090000.jpg')).toBeNull();
  });

  it('does not read a date from a folder-like or extension-only name', () => {
    expect(parse('.jpg')).toBeNull();
    expect(parse('2019-08-12')).toBeNull();
  });
});

describe('PhotoDateResolver with file names', () => {
  const resolver = new PhotoDateResolver();
  it('uses the file name below camera, Drive and Takeout evidence', () => {
    for (const [field, source] of [
      ['exifDate', 'EXIF'],
      ['driveImageTime', 'DRIVE_IMAGE_METADATA'],
      ['takeoutPhotoTakenTime', 'TAKEOUT'],
    ] as const)
      expect(
        resolver.resolve({
          [field]: '2020-02-03T12:00:00Z',
          fileName: 'IMG-20190812-WA0001.jpg',
          folderSegments: ['2024'],
        }),
      ).toMatchObject({ source, value: day('2020-02-03') });
  });

  it('uses the file name above the folder-name parser', () => {
    expect(
      resolver.resolve({ fileName: 'IMG-20190812-WA0001.jpg', folderSegments: ['2024', 'marzo'] }),
    ).toEqual({ value: day('2019-08-12'), precision: 'DAY', source: 'FILENAME' });
  });

  it('falls back to the folder when the name carries no date', () => {
    expect(resolver.resolve({ fileName: 'IMG_1234.jpg', folderSegments: ['2024'] })).toMatchObject({
      source: 'FOLDER',
      precision: 'YEAR',
    });
  });
});
