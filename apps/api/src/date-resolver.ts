export type Precision = 'DAY' | 'MONTH' | 'YEAR' | 'UNKNOWN';
export type DateSource = 'EXIF' | 'DRIVE_IMAGE_METADATA' | 'TAKEOUT' | 'FOLDER' | 'NONE';
export interface ResolvedDate {
  value: Date | null;
  precision: Precision;
  source: DateSource;
}

const months: Record<string, number> = {
  enero: 1,
  ene: 1,
  february: 2,
  febrero: 2,
  feb: 2,
  march: 3,
  marzo: 3,
  mar: 3,
  april: 4,
  abril: 4,
  abr: 4,
  may: 5,
  mayo: 5,
  june: 6,
  junio: 6,
  jun: 6,
  july: 7,
  julio: 7,
  jul: 7,
  august: 8,
  agosto: 8,
  ago: 8,
  september: 9,
  septiembre: 9,
  sep: 9,
  october: 10,
  octubre: 10,
  oct: 10,
  november: 11,
  noviembre: 11,
  nov: 11,
  december: 12,
  diciembre: 12,
  dic: 12,
};
const makeDate = (year: number, month = 1, day = 1) => new Date(Date.UTC(year, month - 1, day));
const clean = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Parses only complete, deterministic date evidence from folder segments. */
export class FolderDateParser {
  parse(segments: string[]): ResolvedDate {
    const normalized = segments.map(clean);
    for (const segment of normalized) {
      const iso = /^(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})$/.exec(segment);
      const words = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/.exec(segment);
      if (iso && valid(+iso[1], +iso[2], +iso[3]))
        return { value: makeDate(+iso[1], +iso[2], +iso[3]), precision: 'MONTH', source: 'FOLDER' };
      if (words && months[words[2]] && valid(+words[3], months[words[2]], +words[1]))
        return {
          value: makeDate(+words[3], months[words[2]], +words[1]),
          precision: 'MONTH',
          source: 'FOLDER',
        };
    }
    let year: number | undefined;
    let month: number | undefined;
    for (const segment of normalized) {
      if (/^(19|20)\d{2}$/.test(segment)) year = +segment;
      else if (months[segment]) month = months[segment];
      else if (/^(0[1-9]|1[0-2])$/.test(segment) && year && !month) month = +segment;
    }
    if (year && month)
      return { value: makeDate(year, month), precision: 'MONTH', source: 'FOLDER' };
    if (year) return { value: makeDate(year), precision: 'YEAR', source: 'FOLDER' };
    return { value: null, precision: 'UNKNOWN', source: 'NONE' };
  }
}
const valid = (year: number, month: number, day: number) =>
  year >= 1900 &&
  year <= 2100 &&
  month >= 1 &&
  month <= 12 &&
  day >= 1 &&
  day <= new Date(Date.UTC(year, month, 0)).getUTCDate();

export class PhotoDateResolver {
  constructor(private readonly folders = new FolderDateParser()) {}
  resolve(input: {
    exifDate?: string | null;
    driveImageTime?: string | null;
    takeoutPhotoTakenTime?: string | null;
    folderSegments: string[];
  }): ResolvedDate {
    for (const [raw, source] of [
      [input.exifDate, 'EXIF'],
      [input.driveImageTime, 'DRIVE_IMAGE_METADATA'],
      [input.takeoutPhotoTakenTime, 'TAKEOUT'],
    ] as const) {
      if (raw) {
        const date = new Date(raw);
        if (!Number.isNaN(date.valueOf()))
          return {
            value: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())),
            precision: 'MONTH',
            source,
          };
      }
    }
    return this.folders.parse(input.folderSegments);
  }
}
