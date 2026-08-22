export type TakeoutLocation = { latitude: number; longitude: number };
export type TakeoutMetadata = {
  title?: string;
  photoTakenTime?: string;
  location?: TakeoutLocation;
};
export type TakeoutParseResult =
  | { kind: 'VALID'; metadata: TakeoutMetadata }
  | { kind: 'INVALID'; reason: 'MALFORMED_JSON' | 'INVALID_SHAPE' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const usableCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** Parses only the small, documented subset used by the date resolver. */
export class TakeoutMetadataParser {
  parse(raw: string): TakeoutParseResult {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { kind: 'INVALID', reason: 'MALFORMED_JSON' };
    }
    if (!isRecord(value)) return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
    const metadata: TakeoutMetadata = {};
    if ('title' in value) {
      if (typeof value.title !== 'string' || !value.title.trim())
        return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
      metadata.title = value.title;
    }
    if ('photoTakenTime' in value) {
      if (!isRecord(value.photoTakenTime) || typeof value.photoTakenTime.timestamp !== 'string')
        return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
      const seconds = Number(value.photoTakenTime.timestamp);
      if (!Number.isFinite(seconds) || Number.isNaN(new Date(seconds * 1000).valueOf()))
        return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
      metadata.photoTakenTime = value.photoTakenTime.timestamp;
    }
    if ('geoData' in value) {
      if (!isRecord(value.geoData)) return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
      const { latitude, longitude } = value.geoData;
      if (latitude !== 0 || longitude !== 0) {
        if (!usableCoordinate(latitude, 90) || !usableCoordinate(longitude, 180))
          return { kind: 'INVALID', reason: 'INVALID_SHAPE' };
        metadata.location = { latitude, longitude };
      }
    }
    return { kind: 'VALID', metadata };
  }
}

export type TakeoutJsonCandidate = { fileName: string; metadata: TakeoutMetadata };
export type TakeoutMatch = {
  status: 'TAKEOUT_MATCHED' | 'TAKEOUT_NOT_FOUND' | 'TAKEOUT_AMBIGUOUS';
  metadata?: TakeoutMetadata;
  reason: string;
};
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s*\(\d+\)(?=(\.[^.]+)?$)/, '')
    .trim();
const withoutExtension = (value: string) => value.replace(/\.[^.]+$/, '');
const sidecarName = (value: string) =>
  value.replace(/\.json$/i, '').replace(/\.supplemental-metadata$/i, '');

/** Matches only candidates from the same enumerated folder, never by a global fuzzy search. */
export class TakeoutMatcher {
  match(photoName: string, candidates: TakeoutJsonCandidate[]): TakeoutMatch {
    const stages: Array<[string, (candidate: TakeoutJsonCandidate) => boolean]> = [
      ['adjacent-sidecar-exact', (candidate) => sidecarName(candidate.fileName) === photoName],
      ['title-exact', (candidate) => candidate.metadata.title === photoName],
      [
        'takeout-normalized-name',
        (candidate) =>
          normalize(sidecarName(candidate.fileName)) === normalize(photoName) ||
          normalize(candidate.metadata.title ?? '') === normalize(photoName),
      ],
      [
        'name-without-extension',
        (candidate) =>
          withoutExtension(normalize(sidecarName(candidate.fileName))) ===
            withoutExtension(normalize(photoName)) ||
          withoutExtension(normalize(candidate.metadata.title ?? '')) ===
            withoutExtension(normalize(photoName)),
      ],
    ];
    for (const [reason, predicate] of stages) {
      const matches = candidates.filter(predicate);
      if (matches.length === 1)
        return { status: 'TAKEOUT_MATCHED', metadata: matches[0].metadata, reason };
      if (matches.length > 1) return { status: 'TAKEOUT_AMBIGUOUS', reason };
    }
    return { status: 'TAKEOUT_NOT_FOUND', reason: 'no-adjacent-metadata' };
  }
}
