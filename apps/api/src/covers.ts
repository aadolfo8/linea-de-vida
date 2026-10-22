import { PrismaService } from './prisma.service';

export type CoverKind = 'YEAR' | 'MONTH' | 'UNKNOWN_MONTH';
export type DropReason = 'NOT_ACTIVE' | 'HIDDEN' | 'OUT_OF_SCOPE';

/** How many photos a cover can hold: the same number the automatic mosaic shows. */
export const COVER_LIMITS: Record<CoverKind, number> = { YEAR: 8, MONTH: 6, UNKNOWN_MONTH: 6 };

export type CoverScope = { kind: CoverKind; year: number; month: number };

/** Why a photo cannot be on a cover right now, or `null` when it can. */
export function coverDropReason(photo: any, scope: CoverScope): DropReason | null {
  if (photo.status !== 'ACTIVE') return 'NOT_ACTIVE';
  if (photo.hiddenAt) return 'HIDDEN';
  const date: Date | null = photo.effectiveDateValue;
  if (!date || date.getUTCFullYear() !== scope.year) return 'OUT_OF_SCOPE';
  const precision = photo.effectiveDatePrecision;
  if (scope.kind === 'YEAR') return precision === 'UNKNOWN' ? 'OUT_OF_SCOPE' : null;
  if (scope.kind === 'UNKNOWN_MONTH') return precision === 'YEAR' ? null : 'OUT_OF_SCOPE';
  return (precision === 'MONTH' || precision === 'DAY') && date.getUTCMonth() + 1 === scope.month
    ? null
    : 'OUT_OF_SCOPE';
}

export type ScopeCovers = {
  /** Chosen photos that still belong to the scope, in the chosen order. */
  valid: any[];
  dropped: { photoId: string; reason: DropReason }[];
};

export type YearCovers = {
  year: ScopeCovers;
  months: Map<number, ScopeCovers>;
  unknownMonth: ScopeCovers;
};

const empty = (): ScopeCovers => ({ valid: [], dropped: [] });

/** The chosen covers of a year, with every photo that stopped qualifying separated at read time. */
export async function readYearCovers(
  prisma: PrismaService,
  userId: string,
  year: number,
): Promise<YearCovers> {
  const rows: any[] = await prisma.photoCover.findMany({
    where: { userId, year },
    orderBy: { position: 'asc' },
    include: { photo: true },
  });
  const covers: YearCovers = { year: empty(), months: new Map(), unknownMonth: empty() };
  for (const row of rows) {
    const target =
      row.kind === 'YEAR'
        ? covers.year
        : row.kind === 'UNKNOWN_MONTH'
          ? covers.unknownMonth
          : (covers.months.get(row.month) ?? covers.months.set(row.month, empty()).get(row.month)!);
    const reason = row.photo
      ? coverDropReason(row.photo, { kind: row.kind, year, month: row.month })
      : 'NOT_ACTIVE';
    if (reason) target.dropped.push({ photoId: row.photoId, reason });
    else target.valid.push(row.photo);
  }
  return covers;
}

/** `count` evenly spread items, so trimming an automatic pick keeps it representative. */
export function spread<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_, index) => items[Math.floor((index * items.length) / count)],
  );
}
