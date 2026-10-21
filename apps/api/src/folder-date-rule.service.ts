import { Injectable, NotFoundException } from '@nestjs/common';
import { DatePrecision, DateSource, FolderDateRuleScope } from '@prisma/client';
import { effectiveDate } from './manual-date.service';
import { PrismaService } from './prisma.service';
import {
  applicableRule,
  FolderRuleFlags,
  flagsFromScope,
  scopeFromFlags,
} from './folder-rule-scope';
import { chunk } from './photo-ids';

type RuleInput = {
  dateValue: Date;
  precision: DatePrecision;
  scope: FolderDateRuleScope;
};

export type SimpleRuleInput = Omit<RuleInput, 'scope'> & FolderRuleFlags;

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
    hiddenAt?: Date | null;
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
    // Hidden photos are updated like any other but never counted: the user does not see them.
    const scoped = records.filter((record) => record.inPreviewScope && !record.photo.hiddenAt);
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

  /** The simplified form used by the Ordenar screen: two yes/no choices instead of a scope. */
  async setSimple(userId: string, folderId: string, input: SimpleRuleInput) {
    const { includeSubfolders, overrideCameraDates, ...date } = input;
    const { rule, affectedCount } = await this.set(userId, folderId, {
      ...date,
      scope: scopeFromFlags({ includeSubfolders, overrideCameraDates }),
    });
    return { rule: { ...rule, ...flagsFromScope(rule.scope) }, affectedCount };
  }

  previewSimple(userId: string, folderId: string, input: SimpleRuleInput) {
    const { includeSubfolders, overrideCameraDates, ...date } = input;
    return this.preview(userId, folderId, {
      ...date,
      scope: scopeFromFlags({ includeSubfolders, overrideCameraDates }),
    });
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
    const changed = (await this.evaluate(userId, sourceId)).filter((record) => record.changed);
    // Photos that end up with the same date are written together.
    const groups = new Map<string, { ids: string[]; record: EvaluatedPhoto }>();
    for (const record of changed) {
      const key = `${record.value?.toISOString() ?? ''}|${record.precision}|${record.origin}`;
      const group = groups.get(key) ?? { ids: [], record };
      group.ids.push(record.photo.id);
      groups.set(key, group);
    }
    for (const { ids, record } of groups.values())
      for (const batch of chunk(ids, 500))
        await this.prisma.photo.updateMany({
          where: { id: { in: batch }, userId },
          data: {
            effectiveDateValue: record.value,
            effectiveDatePrecision: record.precision,
            effectiveDateSource: record.origin,
          },
        });
    return changed.filter((record) => !record.photo.hiddenAt).length;
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
    // Overlay the previewed rule on the folder tree; the shared walk is cycle-safe.
    const tree = new Map(
      folders.map((folder) => [
        folder.id,
        {
          id: folder.id,
          parentId: folder.parentId,
          dateRule: folder.id === replacementFolderId ? (replacementRule ?? null) : folder.dateRule,
        },
      ]),
    );
    return photos.map((photo) => {
      const rule = applicableRule(tree, photo.folderId);
      const result = effectiveDate({
        detectedDate: photo.detectedDate,
        detectedPrecision: photo.detectedPrecision,
        detectedSource: photo.detectedSource,
        folderRule: rule,
        override: photo.override,
      });
      const current = {
        value: photo.effectiveDateValue,
        precision: photo.effectiveDatePrecision,
        origin: photo.effectiveDateSource,
      };
      const inPreviewScope = !!replacementRule && rule === replacementRule;
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
