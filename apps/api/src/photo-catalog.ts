import { Prisma } from '@prisma/client';
import { pickPreferredCopy } from './photo-identity';

/** Prisma client or interactive-transaction client. */
export type CatalogDb = Pick<
  Prisma.TransactionClient,
  'photo' | 'photoFile' | 'manualDateOverride'
>;

export const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

/**
 * Folds `loser` into `survivor` when both turn out to be the same content: every Drive copy moves
 * to the survivor, the survivor's manual date wins, and the loser's is adopted only when the
 * survivor has none. A hidden photo stays hidden.
 */
export async function mergePhotos(
  db: CatalogDb,
  survivor: { id: string; override?: unknown | null; hiddenAt?: Date | null },
  loser: { id: string; override?: unknown | null; hiddenAt?: Date | null },
) {
  await db.photoFile.updateMany({ where: { photoId: loser.id }, data: { photoId: survivor.id } });
  if (loser.override && !survivor.override)
    await db.manualDateOverride.update({
      where: { photoId: loser.id },
      data: { photoId: survivor.id },
    });
  await db.photo.delete({ where: { id: loser.id } });
  if (loser.hiddenAt && !survivor.hiddenAt)
    await db.photo.update({ where: { id: survivor.id }, data: { hiddenAt: loser.hiddenAt } });
}

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

/**
 * Recomputes availability and the primary-copy projection of the given photos from their copies:
 * a photo is ACTIVE while at least one copy is ACTIVE, MISSING otherwise, and its denormalised
 * source/folder/file columns follow an ACTIVE copy. Returns how many photos became MISSING.
 */
export async function refreshPhotos(db: CatalogDb, photoIds: string[], concurrency = 25) {
  let becameMissing = 0;
  for (const ids of chunks([...new Set(photoIds)], 1_000)) {
    const photos = await db.photo.findMany({
      where: { id: { in: ids }, files: { some: {} } },
      select: { id: true, status: true, driveFileId: true, files: true },
    });
    const updates: Array<() => Promise<unknown>> = [];
    for (const photo of photos) {
      const available = photo.files.some((file) => file.status === 'ACTIVE');
      const current = photo.files.find((file) => file.driveFileId === photo.driveFileId);
      const target =
        current && (current.status === 'ACTIVE' || !available)
          ? current
          : pickPreferredCopy(photo.files)!;
      const status = available ? 'ACTIVE' : 'MISSING';
      if (status === 'MISSING' && photo.status === 'ACTIVE') becameMissing++;
      if (status === photo.status && target.driveFileId === photo.driveFileId) continue;
      updates.push(() =>
        db.photo.update({
          where: { id: photo.id },
          data: {
            status,
            driveFileId: target.driveFileId,
            sourceId: target.sourceId,
            folderId: target.folderId,
            fileName: target.fileName,
            mimeType: target.mimeType,
            lastSeenSyncRunId: target.lastSeenSyncRunId,
          },
        }),
      );
    }
    for (const batch of chunks(updates, concurrency)) await Promise.all(batch.map((run) => run()));
  }
  return becameMissing;
}
