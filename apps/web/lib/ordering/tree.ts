import type { FolderNode } from './types';

export type TreeRow = {
  node: FolderNode;
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
  /** 1-based position among its siblings, and how many siblings there are (for `aria-posinset`). */
  position: number;
  setSize: number;
};

/** The rows that are visible: a collapsed folder hides everything below it. */
export function flattenTree(items: readonly FolderNode[], expanded: ReadonlySet<string>) {
  const rows: TreeRow[] = [];
  const visit = (nodes: readonly FolderNode[], level: number, parentId: string | null) => {
    nodes.forEach((node, index) => {
      const hasChildren = node.children.length > 0;
      const isExpanded = hasChildren && expanded.has(node.id);
      rows.push({
        node,
        level,
        parentId,
        hasChildren,
        expanded: isExpanded,
        position: index + 1,
        setSize: nodes.length,
      });
      if (isExpanded) visit(node.children, level + 1, node.id);
    });
  };
  visit(items, 1, null);
  return rows;
}

/** Ids from the root down to `id`, or `[]` when the folder is not in the tree. */
export function pathToFolder(items: readonly FolderNode[], id: string): string[] {
  for (const node of items) {
    if (node.id === id) return [node.id];
    const below = pathToFolder(node.children, id);
    if (below.length) return [node.id, ...below];
  }
  return [];
}

export function findFolder(items: readonly FolderNode[], id: string): FolderNode | null {
  for (const node of items) {
    if (node.id === id) return node;
    const below = findFolder(node.children, id);
    if (below) return below;
  }
  return null;
}

/** Folders that start expanded: the top level, plus whatever leads to the selected folder. */
export function initialExpanded(items: readonly FolderNode[], selectedId: string | null) {
  const open = new Set(items.map((node) => node.id));
  if (selectedId) for (const id of pathToFolder(items, selectedId)) open.add(id);
  return open;
}

export type TreeKeyOutcome =
  | { kind: 'focus'; id: string }
  | { kind: 'expand'; id: string }
  | { kind: 'collapse'; id: string }
  | { kind: 'select'; id: string }
  | { kind: 'none' };

/** The WAI-ARIA tree keys: arrows, Home, End, and Enter or Space to choose. */
export function treeKey(rows: readonly TreeRow[], currentId: string, key: string): TreeKeyOutcome {
  const index = rows.findIndex((row) => row.node.id === currentId);
  const row = rows[index];
  if (!row) return { kind: 'none' };
  switch (key) {
    case 'ArrowDown':
      return rows[index + 1] ? { kind: 'focus', id: rows[index + 1]!.node.id } : { kind: 'none' };
    case 'ArrowUp':
      return rows[index - 1] ? { kind: 'focus', id: rows[index - 1]!.node.id } : { kind: 'none' };
    case 'Home':
      return { kind: 'focus', id: rows[0]!.node.id };
    case 'End':
      return { kind: 'focus', id: rows[rows.length - 1]!.node.id };
    case 'ArrowRight':
      if (!row.hasChildren) return { kind: 'none' };
      return row.expanded
        ? { kind: 'focus', id: row.node.children[0]!.id }
        : { kind: 'expand', id: row.node.id };
    case 'ArrowLeft':
      if (row.hasChildren && row.expanded) return { kind: 'collapse', id: row.node.id };
      return row.parentId ? { kind: 'focus', id: row.parentId } : { kind: 'none' };
    case 'Enter':
    case ' ':
      return { kind: 'select', id: row.node.id };
    default:
      return { kind: 'none' };
  }
}

/** "12 por fechar" or a check when the whole subtree already has a date. */
export const toDateText = (count: number) =>
  count > 0 ? `${count.toLocaleString('es-ES')} por fechar` : '✓';
