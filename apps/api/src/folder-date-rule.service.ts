import { Injectable, NotFoundException } from '@nestjs/common';
import { DatePrecision, DateSource, FolderDateRuleScope } from '@prisma/client';
import { effectiveDate } from './manual-date.service';
import { PrismaService } from './prisma.service';

type RuleInput = {
  dateValue: Date;
  precision: DatePrecision;
  scope: FolderDateRuleScope;
};

type EvaluatedPhoto = {
  photo: {
    id: string;
    folderId: string | null;
    effectiveDateValue: Date | null;
    effectiveDatePrecision: DatePrecision;
    effectiveDateSource: DateSource;
    detectedDate: Date | null;
    detectedPrecision: DatePrecision;
    detectedSource: DateSource;
    override: { dateValue: Date; precision: DatePrecision } | null;
  };
  value: Date | null;
  precision: DatePrecision;
  origin: DateSource;
  changed: boolean;
  inPreviewScope: boolean;
};

const sameDate = (
  current: { value: Date | null; precision: DatePrecision; origin: DateSource },
  next: { value: Date | null; precision: DatePrecision; origin: DateSource },
) =>
  current.value?.getTime() === next.value?.getTime() &&
  current.precision === next.precision &&
  current.origin === next.origin;

@Injectable()
export class FolderDateRuleService {
  constructor(private readonly prisma: PrismaService) {}

  async set(userId: string, folderId: string, input: RuleInput) {
    const folder = await this.ownedFolder(userId, folderId);
    const rule = await this.prisma.folderDateRule.upsert({
      where: { folderId },
      create: { folderId, ...input },
      update: input,
    });
    const affectedCount = await this.recalculate(userId, folder.sourceId);
    return { rule, affectedCount };
  }

  async preview(userId: string, folderId: string, input: RuleInput) {
    const folder = await this.ownedFolder(userId, folderId);
    const records = await this.evaluate(userId, folder.sourceId, folderId, input);
    const scoped = records.filter((record) => record.inPreviewScope);
    const willChange = scoped.filter((record) => record.changed);
    return {
      scopePhotoCount: scoped.length,
      willChangeCount: willChange.length,
      unchangedCount: scoped.length - willChange.length,
      preservesManualCount: scoped.filter((record) => record.photo.override).length,
      replacesAutomaticCount: willChange.filter(
        (record) =>
          record.photo.effectiveDateValue && record.photo.effectiveDateSource !== DateSource.MANUAL,
      ).length,
      replacesFolderNameDateCount: willChange.filter(
        (record) => record.photo.effectiveDateSource === DateSource.FOLDER,
      ).length,
    };
  }

  async remove(userId: string, folderId: string) {
    const folder = await this.ownedFolder(userId, folderId);
    await this.prisma.folderDateRule.deleteMany({ where: { folderId } });
    const affectedCount = await this.recalculate(userId, folder.sourceId);
    return { affectedCount };
  }

  private async ownedFolder(userId: string, folderId: string) {
    const folder = await this.prisma.indexedFolder.findFirst({ where: { id: folderId, userId } });
    if (!folder)
      throw new NotFoundException({
        code: 'FOLDER_NOT_FOUND',
        message: 'Indexed folder not found.',
      });
    return folder;
  }

  private async recalculate(userId: string, sourceId: string) {
    const records = await this.evaluate(userId, sourceId);
    for (let offset = 0; offset < records.length; offset += 250) {
      const batch = records.slice(offset, offset + 250);
      await this.prisma.$transaction(
        batch.map(({ photo, value, precision, origin }) =>
          this.prisma.photo.update({
            where: { id: photo.id },
            data: {
              effectiveDateValue: value,
              effectiveDatePrecision: precision,
              effectiveDateSource: origin,
            },
          }),
        ),
      );
    }
    return records.filter((record) => record.changed).length;
  }

  private async evaluate(
    userId: string,
    sourceId: string,
    replacementFolderId?: string,
    replacementRule?: RuleInput,
  ): Promise<EvaluatedPhoto[]> {
    const [folders, photos] = await Promise.all([
      this.prisma.indexedFolder.findMany({
        where: { userId, sourceId },
        include: { dateRule: true },
      }),
      this.prisma.photo.findMany({
        where: { userId, sourceId, status: 'ACTIVE' },
        include: { override: true },
      }),
    ]);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ruleFor = (folderId: string | null) => {
      let currentId = folderId;
      let direct = true;
      while (currentId) {
        const folder = byId.get(currentId);
        if (!folder) return null;
        const rule =
          folder.id === replacementFolderId ? (replacementRule ?? null) : folder.dateRule;
        if (rule && (direct || rule.scope !== 'DIRECT_ONLY')) return { rule, folderId: folder.id };
        direct = false;
        currentId = folder.parentId;
      }
      return null;
    };
    return photos.map((photo) => {
      const selectedRule = ruleFor(photo.folderId);
      const result = effectiveDate({
        detectedDate: photo.detectedDate,
        detectedPrecision: photo.detectedPrecision,
        detectedSource: photo.detectedSource,
        folderRule: selectedRule?.rule,
        override: photo.override,
      });
      const current = {
        value: photo.effectiveDateValue,
        precision: photo.effectiveDatePrecision,
        origin: photo.effectiveDateSource,
      };
      const inPreviewScope = selectedRule?.folderId === replacementFolderId;
      return {
        photo,
        value: result.value,
        precision: result.precision as DatePrecision,
        origin: result.origin as DateSource,
        changed: !sameDate(current, {
          value: result.value,
          precision: result.precision as DatePrecision,
          origin: result.origin as DateSource,
        }),
        inPreviewScope,
      };
    });
  }
}
