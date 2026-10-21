import { DriveItem } from './drive';

/**
 * Content identity of a Drive file, per user.
 *
 * Drive's `md5Checksum` plus `size` identify the bytes regardless of the file id, folder, source or
 * Takeout export they came from. When Drive reports no checksum the file can only be identified by
 * its own id, so such a key never matches another file.
 */
export const contentKeyFor = (item: Pick<DriveItem, 'id' | 'md5Checksum' | 'size'>) =>
  item.md5Checksum
    ? `md5:${item.md5Checksum.toLowerCase()}:${item.size ?? ''}`
    : provisionalContentKey(item.id);

/** Key used by the migration backfill and by files without a checksum. */
export const provisionalContentKey = (driveFileId: string) => `drive:${driveFileId}`;

export const isProvisionalContentKey = (key: string) => key.startsWith('drive:');

/** Drive sends `size` as a decimal string; anything else is treated as unknown. */
export const parseSizeBytes = (size?: string | null) => {
  if (!size || !/^\d{1,18}$/.test(size)) return null;
  return BigInt(size);
};

type CopyLike = { status: string; createdAt?: Date; id: string };

/** The copy that feeds thumbnails and content: an ACTIVE one first, then the oldest, then by id. */
export const compareCopies = (a: CopyLike, b: CopyLike) => {
  if ((a.status === 'ACTIVE') !== (b.status === 'ACTIVE')) return a.status === 'ACTIVE' ? -1 : 1;
  const left = a.createdAt?.getTime() ?? 0;
  const right = b.createdAt?.getTime() ?? 0;
  return left - right || a.id.localeCompare(b.id);
};

export const pickPreferredCopy = <T extends CopyLike>(copies: T[]): T | undefined =>
  [...copies].sort(compareCopies)[0];
