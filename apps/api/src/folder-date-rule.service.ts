import { Injectable, NotFoundException } from '@nestjs/common';
import { DatePrecision, DateSource, FolderDateRuleScope } from '@prisma/client';
import { effectiveDate } from './manual-date.service';
import { PrismaService } from './prisma.service';

type RuleInput = {
  dateValue: Date;
  precision: DatePrecision;
  scope: FolderDateRuleScope;
};

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
        if (folder.dateRule && (direct || folder.dateRule.scope !== 'DIRECT_ONLY'))
          return folder.dateRule;
        direct = false;
        currentId = folder.parentId;
      }
      return null;
    };

    for (let offset = 0; offset < photos.length; offset += 250) {
      await this.prisma.$transaction(
        photos.slice(offset, offset + 250).map((photo) => {
          const result = effectiveDate({
            detectedDate: photo.detectedDate,
            detectedPrecision: photo.detectedPrecision,
            detectedSource: photo.detectedSource,
            folderRule: ruleFor(photo.folderId),
            override: photo.override,
          });
          return this.prisma.photo.update({
            where: { id: photo.id },
            data: {
              effectiveDateValue: result.value,
              effectiveDatePrecision: result.precision as DatePrecision,
              effectiveDateSource: result.origin as DateSource,
            },
          });
        }),
      );
    }
    return photos.length;
  }
}
