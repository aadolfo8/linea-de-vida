/**
 * Deterministic dates carried by file names (phone cameras, WhatsApp, screenshots, messengers).
 * Only complete calendar dates are accepted, always at DAY precision; anything ambiguous or
 * implausible yields nothing so a file name never invents a date.
 */
export type FilenameDateKind =
  | 'whatsapp'
  | 'android-camera'
  | 'pixel'
  | 'screenshot'
  | 'messenger'
  | 'timestamp';

export interface FilenameDate {
  value: Date;
  kind: FilenameDateKind;
}

type Pattern = { kind: FilenameDateKind; regex: RegExp };

// Every pattern captures year, month, day as groups 1-3. Time parts, when present, are validated
// so that a long digit run that merely looks like a timestamp is not accepted.
const compactTime = String.raw`(?<h>\d{2})(?<mi>\d{2})(?<s>\d{2})`;
const patterns: Pattern[] = [
  // IMG-20190812-WA0001.jpg, VID-20190812-WA0003.mp4
  { kind: 'whatsapp', regex: /^(?:IMG|VID)-(\d{4})(\d{2})(\d{2})-WA\d+/i },
  // WhatsApp Image 2019-08-12 at 10.20.30.jpeg, Imagen de WhatsApp 2019-08-12 a las 10.20.30
  { kind: 'whatsapp', regex: /^WhatsApp (?:Image|Video) (\d{4})-(\d{2})-(\d{2})(?: at |$)/i },
  {
    kind: 'whatsapp',
    regex: /^(?:Imagen|V[ií]deo) de WhatsApp (\d{4})-(\d{2})-(\d{2})(?: a las |$)/i,
  },
  // IMG_20190812_123456.jpg, VID_20190812_123456, MVIMG_/BURST/PANO variants
  {
    kind: 'android-camera',
    regex: new RegExp(
      String.raw`^(?:IMG|VID|MVIMG|BURST|PANO)[_-](\d{4})(\d{2})(\d{2})[_-]${compactTime}\d{0,3}(?!\d)`,
      'i',
    ),
  },
  // PXL_20190812_123456789.jpg
  { kind: 'pixel', regex: /^PXL_(\d{4})(\d{2})(\d{2})_\d{6,9}(?!\d)/i },
  // Screenshot_2019-08-12-12-34-56, Screenshot_20190812-123456, Screenshot from 2019-08-12 12-34-56,
  // Captura de pantalla 2019-08-12 a las 12.34.56, Screen Shot 2019-08-12 at 10.20.30
  {
    kind: 'screenshot',
    regex: /^Screenshot[_ ](?:from )?(\d{4})-(\d{2})-(\d{2})(?!\d)/i,
  },
  { kind: 'screenshot', regex: /^Screenshot_(\d{4})(\d{2})(\d{2})-\d{6}(?!\d)/i },
  {
    kind: 'screenshot',
    regex: /^(?:Captura de pantalla|Screen ?Shot) (\d{4})-(\d{2})-(\d{2})(?!\d)/i,
  },
  // signal-2019-08-12-12-34-56-123.jpg
  { kind: 'messenger', regex: /^signal-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}-\d{2}/i },
  // 20190812_123456.jpg, 20190812_123456_1.jpg
  {
    kind: 'timestamp',
    regex: new RegExp(String.raw`^(\d{4})(\d{2})(\d{2})[_-]${compactTime}(?!\d)`),
  },
  // 2019-08-12 12.34.56.jpg, 2019-08-12_12-34-56.jpg
  { kind: 'timestamp', regex: /^(\d{4})-(\d{2})-(\d{2})[ _T]\d{2}[.:-]\d{2}[.:-]\d{2}(?!\d)/ },
];

const stripExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

const plausible = (year: number, month: number, day: number, today: Date) => {
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Date.UTC(year, month - 1, day) <= todayUtc;
};

export function parseFilenameDate(fileName: string, today = new Date()): FilenameDate | null {
  const base = stripExtension(fileName.trim());
  for (const { kind, regex } of patterns) {
    const match = regex.exec(base);
    if (!match) continue;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const time = match.groups;
    if (time?.h !== undefined && (+time.h > 23 || +time.mi > 59 || +time.s > 59)) continue;
    if (!plausible(year, month, day, today)) continue;
    return { value: new Date(Date.UTC(year, month - 1, day)), kind };
  }
  return null;
}
