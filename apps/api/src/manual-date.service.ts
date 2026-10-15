import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatePrecision, DateSource, FolderDateRuleScope } from '@prisma/client';
import { PrismaService } from './prisma.service';

export const MANUAL_DATE_BULK_LIMIT = 50;

export type ManualDateInput = {
  year: unknown;
  month?: unknown;
  day?: unknown;
  precision: unknown;
  reason?: unknown;
};

export type ValidManualDate = {
  dateValue: Date;
  precision: Extract<DatePrecision, 'YEAR' | 'MONTH' | 'DAY'>;
  reason: string | null;
};

type DateEvidence = {
  detectedDate: Date | null;
  detectedPrecision: DatePrecision;
  detectedSource: DateSource;
  effectiveDateValue?: Date | null;
  effectiveDatePrecision?: DatePrecision;
  effectiveDateSource?: DateSource;
  override?: { dateValue: Date; precision: DatePrecision } | null;
  folderRule?: {
    dateValue: Date;
    precision: DatePrecision;
    scope: FolderDateRuleScope;
  } | null;
};

const invalid = (code: string, message: string): never => {
  throw new BadRequestException({ code, message });
};

const number = (value: unknown) => (typeof value === 'number' ? value : Number(value));

/** Validates calendar parts before creating the technical date anchor used by partial precisions. */
export function validateManualDate(input: ManualDateInput): ValidManualDate {
  const year = number(input?.year);
  const month = input.month === undefined || input.month === null ? undefined : number(input.month);
  const day = input.day === undefined || input.day === null ? undefined : number(input.day);
  const precision = input?.precision;

  if (!Number.isInteger(year) || year < 1900 || year > 2100)
    return invalid('INVALID_YEAR', 'A year between 1900 and 2100 is required.');
  if (precision !== 'YEAR' && precision !== 'MONTH' && precision !== 'DAY')
    return invalid('INVALID_PRECISION', 'Precision must be YEAR, MONTH, or DAY.');
  if (precision === 'YEAR' && (month !== undefined || day !== undefined))
    return invalid('INVALID_PRECISION', 'YEAR precision cannot include a month or day.');
  if (precision === 'MONTH' && (month === undefined || day !== undefined))
    return invalid(
      'INVALID_PRECISION',
      'MONTH precision requires a month and cannot include a day.',
    );
  if (precision === 'DAY' && (month === undefined || day === undefined))
    return invalid('INVALID_PRECISION', 'DAY precision requires both month and day.');
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))
    return invalid('INVALID_MONTH', 'A valid month is required.');
  if (day !== undefined) {
    const maximum = new Date(Date.UTC(year, month!, 0)).getUTCDate();
    if (!Number.isInteger(day) || day < 1 || day > maximum)
      return invalid('INVALID_DAY', 'A valid calendar day is required.');
  }
  if (input.reason !== undefined && typeof input.reason !== 'string')
    return invalid('INVALID_REASON', 'Reason must be text.');
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500)
    return invalid('INVALID_REASON', 'Reason cannot exceed 500 characters.');

  return {
    dateValue: new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)),
    precision,
    reason,
  };
}

export function effectiveDate(evidence: DateEvidence) {
  if (evidence.override)
    return {
      value: evidence.override.dateValue,
      precision: evidence.override.precision,
      origin: 'MANUAL' as const,
    };
  if (
    evidence.folderRule &&
    (evidence.folderRule.scope === 'ALL_DESCENDANTS' ||
      !evidence.detectedDate ||
      evidence.detectedSource === 'FOLDER')
  )
    return {
      value: evidence.folderRule.dateValue,
      precision: evidence.folderRule.precision,
      origin: 'FOLDER_RULE' as const,
    };
  if (
    evidence.effectiveDateSource === 'FOLDER_RULE' &&
    evidence.effectiveDateValue &&
    evidence.effectiveDatePrecision
  )
    return {
      value: evidence.effectiveDateValue,
      precision: evidence.effectiveDatePrecision,
      origin: 'FOLDER_RULE' as const,
    };
  return {
    value: evidence.detectedDate,
    precision: evidence.detectedDate ? evidence.detectedPrecision : 'UNKNOWN',
    origin: evidence.detectedDate ? evidence.detectedSource : 'NONE',
  };
}

export function photoDateResponse<T extends DateEvidence & Record<string, unknown>>(photo: T) {
  const { override, ...base } = photo;
  return {
    ...base,
    effectiveDate: effectiveDate({ ...photo, override }),
    manualDateOverride: override
      ? { dateValue: override.dateValue, precision: override.precision }
      : null,
  };
}

@Injectable()
export class ManualDateService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(userId: string, photoIds: string[], input: ManualDateInput) {
    const manual = validateManualDate(input);
    const ids = [...new Set(photoIds)];
    if (!ids.length || ids.length !== photoIds.length)
      invalid('INVALID_PHOTO_IDS', 'Photo IDs must be a non-empty unique list.');
    if (ids.length > MANUAL_DATE_BULK_LIMIT)
      invalid(
        'BULK_LIMIT_EXCEEDED',
        `A maximum of ${MANUAL_DATE_BULK_LIMIT} photos can be edited at once.`,
      );
    const photos = await this.prisma.photo.findMany({
      where: { id: { in: ids }, userId },
      include: { override: true },
    });
    if (photos.length !== ids.length)
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    const projected = { value: manual.dateValue, precision: manual.precision, origin: 'MANUAL' };
    const alreadySame = photos.filter((photo) => {
      const current = effectiveDate({ ...photo, override: photo.override });
      return (
        current.value?.getTime() === projected.value.getTime() &&
        current.precision === projected.precision &&
        current.origin === projected.origin
      );
    }).length;
    const currentlyDated = photos.filter(
      (photo) => effectiveDate({ ...photo, override: photo.override }).value !== null,
    ).length;
    return {
      selectedCount: photos.length,
      willChangeCount: photos.length - alreadySame,
      alreadySameCount: alreadySame,
      alreadyDatedCount: currentlyDated,
    };
  }

  async set(userId: string, photoIds: string[], input: ManualDateInput) {
    const manual = validateManualDate(input);
    const ids = [...new Set(photoIds)];
    if (!ids.length || ids.length !== photoIds.length)
      invalid('INVALID_PHOTO_IDS', 'Photo IDs must be a non-empty unique list.');
    if (ids.length > MANUAL_DATE_BULK_LIMIT)
      invalid(
        'BULK_LIMIT_EXCEEDED',
        `A maximum of ${MANUAL_DATE_BULK_LIMIT} photos can be edited at once.`,
      );

    return this.prisma.$transaction(async (tx) => {
      const photos = await tx.photo.findMany({
        where: { id: { in: ids }, userId },
        include: { override: true },
      });
      if (photos.length !== ids.length)
        throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
      await Promise.all(
        photos.map((photo) =>
          Promise.all([
            tx.manualDateOverride.upsert({
              where: { photoId: photo.id },
              create: { photoId: photo.id, ...manual },
              update: manual,
            }),
            tx.photo.update({
              where: { id: photo.id },
              data: {
                effectiveDateValue: manual.dateValue,
                effectiveDatePrecision: manual.precision,
                effectiveDateSource: 'MANUAL',
              },
            }),
          ]),
        ),
      );
      return tx.photo.findMany({
        where: { id: { in: ids }, userId },
        include: { override: true },
      });
    });
  }

  async remove(userId: string, photoId: string) {
    return this.prisma.$transaction(async (tx) => {
      const photo = await tx.photo.findFirst({ where: { id: photoId, userId } });
      if (!photo)
        throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
      const folders = photo.folderId
        ? await tx.indexedFolder.findMany({
            where: { userId, sourceId: photo.sourceId },
            include: { dateRule: true },
          })
        : [];
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      let currentId = photo.folderId;
      let direct = true;
      let folderRule = null;
      while (currentId) {
        const folder = byId.get(currentId);
        if (!folder) break;
        if (folder.dateRule && (direct || folder.dateRule.scope !== 'DIRECT_ONLY')) {
          folderRule = folder.dateRule;
          break;
        }
        direct = false;
        currentId = folder.parentId;
      }
      const restored = effectiveDate({ ...photo, folderRule, override: null });
      await tx.manualDateOverride.deleteMany({ where: { photoId: photo.id } });
      return tx.photo.update({
        where: { id: photo.id },
        data: {
          effectiveDateValue: restored.value,
          effectiveDatePrecision: restored.precision,
          effectiveDateSource: restored.origin,
        },
        include: { override: true },
      });
    });
  }
}
