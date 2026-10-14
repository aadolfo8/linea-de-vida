import { DriveAdapter, isFolder } from './drive';

export class FolderAncestryUnavailable extends Error {
  constructor() {
    super('Drive folder ancestry could not be verified.');
  }
}

const MAX_ANCESTRY_DEPTH = 100;

/** Returns an existing root ID when either selected folder contains the other. */
export async function findOverlappingFolderSource(
  connection: { refreshTokenCiphertext: string | null },
  candidateFolderId: string,
  existingFolderIds: readonly string[],
  drive: DriveAdapter,
) {
  const ancestryCache = new Map<string, Promise<Set<string>>>();
  const ancestors = (folderId: string): Promise<Set<string>> => {
    const cached = ancestryCache.get(folderId);
    if (cached) return cached;
    const pending = (async () => {
      const result = new Set<string>();
      let currentId: string | undefined = folderId;
      while (currentId && !result.has(currentId)) {
        if (result.size >= MAX_ANCESTRY_DEPTH) throw new FolderAncestryUnavailable();
        result.add(currentId);
        let current;
        try {
          current = await drive.getFolder(connection, currentId);
        } catch {
          throw new FolderAncestryUnavailable();
        }
        if (!current || !isFolder(current)) throw new FolderAncestryUnavailable();
        currentId = current.parents[0];
      }
      return result;
    })();
    ancestryCache.set(folderId, pending);
    return pending;
  };

  const candidateAncestors = await ancestors(candidateFolderId);
  for (const existingFolderId of existingFolderIds) {
    if (candidateAncestors.has(existingFolderId)) return existingFolderId;
    if ((await ancestors(existingFolderId)).has(candidateFolderId)) return existingFolderId;
  }
  return null;
}
