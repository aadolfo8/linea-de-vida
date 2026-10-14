export type FolderTreeItem = { id: string; parentId: string | null };

/** Flattens a folder tree while keeping collapsed descendants hidden. */
export function visibleFolderTree<T extends FolderTreeItem>(
  folders: readonly T[],
  collapsedFolderIds: ReadonlySet<string>,
): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenById = new Map<string, T[]>();
  const roots: T[] = [];

  for (const folder of folders) {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (!parent) {
      roots.push(folder);
      continue;
    }
    const children = childrenById.get(parent.id) ?? [];
    children.push(folder);
    childrenById.set(parent.id, children);
  }

  const visible: T[] = [];
  const visited = new Set<string>();
  const append = (folder: T) => {
    if (visited.has(folder.id)) return;
    visited.add(folder.id);
    visible.push(folder);
    if (collapsedFolderIds.has(folder.id)) return;
    for (const child of childrenById.get(folder.id) ?? []) append(child);
  };

  for (const root of roots) append(root);
  // Malformed cycles have no root. Visit each remaining component once without
  // bypassing collapse for descendants of already-rendered folders.
  for (const folder of folders) {
    if (!visited.has(folder.id) && isUnrootedCycle(folder, byId, visited)) {
      append(folder);
    }
  }
  return visible;
}

function isUnrootedCycle<T extends FolderTreeItem>(
  folder: T,
  byId: ReadonlyMap<string, T>,
  visibleIds: ReadonlySet<string>,
) {
  const path = new Set<string>();
  let current: T | undefined = folder;
  while (current && !path.has(current.id)) {
    path.add(current.id);
    if (!current.parentId) return false;
    const parent = byId.get(current.parentId);
    if (!parent || visibleIds.has(parent.id)) return false;
    current = parent;
  }
  return Boolean(current && path.has(current.id));
}
