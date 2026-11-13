import { useCallback, useEffect, useRef, useState } from 'react';
import { initialExpanded, pathToFolder } from '../../lib/ordering/tree';
import type { FolderTree } from '../../lib/ordering/types';

/**
 * Which folders of the tree are open. A new source opens its top level and the way to the
 * selected folder; selecting a folder later opens the path to it without closing anything else.
 */
export function useTreeExpansion(tree: FolderTree | null, folderId: string | null) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expandedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!tree) return;
    if (expandedFor.current !== tree.sourceId) {
      expandedFor.current = tree.sourceId;
      setExpanded(initialExpanded(tree.items, folderId));
      return;
    }
    if (folderId) {
      const path = pathToFolder(tree.items, folderId).slice(0, -1);
      if (path.length) setExpanded((current) => new Set([...current, ...path]));
    }
  }, [tree, folderId]);

  const toggleFolder = useCallback((id: string, open: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return { expanded, toggleFolder };
}
