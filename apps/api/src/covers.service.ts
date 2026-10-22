import { BadRequestException, Injectable } from '@nestjs/common';
import {
  COVER_LIMITS,
  CoverKind,
  CoverScope,
  coverDropReason,
  readYearCovers,
  ScopeCovers,
} from './covers';
import { compactPhoto } from './photo-summary';
import { PrismaService } from './prisma.service';

const KINDS: CoverKind[] = ['YEAR', 'MONTH', 'UNKNOWN_MONTH'];

const invalid = (code: string, message: string) => new BadRequestException({ code, message });

function parseYear(year: unknown) {
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > 2100)
    throw invalid('INVALID_YEAR', 'A valid year is required.');
  return year;
}

/** Validates the identity of a cover: a year, a month of it or its "Sin mes" group. */
export function parseCoverScope(body: any): CoverScope {
  const kind = body?.kind;
  if (!KINDS.includes(kind))
    throw invalid('INVALID_COVER_KIND', 'Choose a year, month or Sin mes.');
  const year = parseYear(body?.year);
  const month = body?.month;
  if (kind === 'MONTH') {
    if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12)
      throw invalid('INVALID_MONTH', 'A valid month is required.');
    return { kind, year, month };
  }
  if (month !== undefined && month !== null)
    throw invalid('INVALID_MONTH', 'Only a month cover takes a month.');
  return { kind, year, month: 0 };
}

const present = (covers: ScopeCovers) => ({
  photos: covers.valid.map(compactPhoto),
  dropped: covers.dropped,
});

/**
 * Covers chosen by the user. Only references are stored; the photos that stopped qualifying are
 * dropped when read, never deleted here, so a photo shown again or re-dated back returns by itself.
 */
@Injectable()
export class CoversService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, rawYear: unknown) {
    const year = parseYear(
      typeof rawYear === 'string' && rawYear.trim() ? Number(rawYear) : rawYear,
    );
    const covers = await readYearCovers(this.prisma, userId, year);
    return {
      year,
      limits: COVER_LIMITS,
      items: [
        { kind: 'YEAR', month: null, limit: COVER_LIMITS.YEAR, ...present(covers.year) },
        ...[...covers.months]
          .sort(([a], [b]) => a - b)
          .map(([month, scope]) => ({
            kind: 'MONTH',
            month,
            limit: COVER_LIMITS.MONTH,
            ...present(scope),
          })),
        ...(covers.unknownMonth.valid.length || covers.unknownMonth.dropped.length
          ? [
              {
                kind: 'UNKNOWN_MONTH',
                month: null,
                limit: COVER_LIMITS.UNKNOWN_MONTH,
                ...present(covers.unknownMonth),
              },
            ]
          : []),
      ],
    };
  }

  /** Replaces the whole set of one scope, or rejects it untouched with a status per photo. */
  async replace(userId: string, body: any) {
    const scope = parseCoverScope(body);
    const raw = body?.photoIds;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !id.trim()))
      throw invalid('INVALID_PHOTO_IDS', 'Provide the ordered list of photo IDs.');
    const ids = [...new Set<string>(raw)];
    const limit = COVER_LIMITS[scope.kind];
    if (ids.length > limit)
      throw invalid('TOO_MANY_COVERS', `A cover holds at most ${limit} photos.`);
    const owned: any[] = ids.length
      ? await this.prisma.photo.findMany({ where: { id: { in: ids }, userId } })
      : [];
    const byId = new Map(owned.map((photo) => [photo.id, photo]));
    const results = ids.map((id) => {
      const photo = byId.get(id);
      if (!photo) return { id, status: 'NOT_FOUND' };
      const reason = coverDropReason(photo, scope);
      return { id, status: reason === 'OUT_OF_SCOPE' ? 'NOT_ELIGIBLE' : (reason ?? 'OK') };
    });
    if (results.some((result) => result.status !== 'OK'))
      throw new BadRequestException({
        code: 'COVER_PHOTOS_REJECTED',
        message: 'Some photos cannot be on this cover.',
        results,
      });
    await this.prisma.$transaction(async (tx: any) => {
      await tx.photoCover.deleteMany({ where: this.where(userId, scope) });
      if (ids.length)
        await tx.photoCover.createMany({
          data: ids.map((photoId, position) => ({ userId, ...scope, photoId, position })),
        });
    });
    return { kind: scope.kind, year: scope.year, month: scope.month || null, photoIds: ids };
  }

  /** Back to the automatic cover. */
  async clear(userId: string, body: any) {
    const scope = parseCoverScope(body);
    await this.prisma.photoCover.deleteMany({ where: this.where(userId, scope) });
    return { kind: scope.kind, year: scope.year, month: scope.month || null, photoIds: [] };
  }

  private where(userId: string, scope: CoverScope) {
    return { userId, kind: scope.kind, year: scope.year, month: scope.month };
  }
}
