import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { chunk, parsePhotoIds } from './photo-ids';

export type HideResult = {
  id: string;
  status: 'HIDDEN' | 'ALREADY_HIDDEN' | 'NOT_FOUND' | 'FAILED';
};
export type UnhideResult = {
  id: string;
  status: 'VISIBLE' | 'ALREADY_VISIBLE' | 'NOT_FOUND' | 'FAILED';
};

/**
 * Soft hide. A hidden photo keeps its row, copies and dates, so showing it again is immediate and
 * the hidden state follows its content to any new copy. IDs the user does not own are reported as
 * `NOT_FOUND`, never as another user's photo.
 */
@Injectable()
export class PhotoVisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async hide(userId: string, rawIds: unknown) {
    return this.change(userId, parsePhotoIds(rawIds), true);
  }

  async unhide(userId: string, rawIds: unknown) {
    return this.change(userId, parsePhotoIds(rawIds), false);
  }

  private async change(userId: string, ids: string[], hide: boolean) {
    const results: Array<HideResult | UnhideResult> = [];
    for (const batch of chunk(ids, 500)) {
      try {
        const owned = await this.prisma.photo.findMany({
          where: { id: { in: batch }, userId },
          select: { id: true, hiddenAt: true },
        });
        const byId = new Map(owned.map((photo) => [photo.id, photo]));
        const changing = owned.filter((photo) => (photo.hiddenAt === null) === hide);
        if (changing.length)
          await this.prisma.photo.updateMany({
            where: { id: { in: changing.map((photo) => photo.id) }, userId },
            data: { hiddenAt: hide ? new Date() : null },
          });
        for (const id of batch) {
          const photo = byId.get(id);
          const already = photo ? (photo.hiddenAt === null) !== hide : false;
          results.push({
            id,
            status: !photo
              ? 'NOT_FOUND'
              : hide
                ? already
                  ? 'ALREADY_HIDDEN'
                  : 'HIDDEN'
                : already
                  ? 'ALREADY_VISIBLE'
                  : 'VISIBLE',
          } as HideResult | UnhideResult);
        }
      } catch {
        for (const id of batch) results.push({ id, status: 'FAILED' });
      }
    }
    const changedCount = results.filter(
      (result) => result.status === 'HIDDEN' || result.status === 'VISIBLE',
    ).length;
    return { results, changedCount };
  }
}
