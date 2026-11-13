import { CalendarCheck, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ruleShortLabel } from '../../lib/ordering/dates';
import { flattenTree, toDateText, treeKey } from '../../lib/ordering/tree';
import type { FolderTree as FolderTreeData } from '../../lib/ordering/types';

/**
 * The Drive folders of the source as a WAI-ARIA tree: arrows move and open, Home and End jump,
 * Enter or Space chooses the folder as the filter of the grid.
 */
export function FolderTree({
  tree,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  tree: FolderTreeData;
  selectedId: string | null;
  expanded: ReadonlySet<string>;
  onToggle: (id: string, open: boolean) => void;
  onSelect: (id: string | null) => void;
}) {
  const rows = useMemo(() => flattenTree(tree.items, expanded), [tree.items, expanded]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const wantFocus = useRef(false);

  const tabStop =
    rows.find((row) => row.node.id === focusId)?.node.id ??
    rows.find((row) => row.node.id === selectedId)?.node.id ??
    rows[0]?.node.id ??
    null;

  useEffect(() => {
    if (wantFocus.current && focusId) refs.current.get(focusId)?.focus();
    wantFocus.current = false;
  }, [focusId, rows]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const outcome = treeKey(rows, id, event.key);
    if (outcome.kind === 'none') return;
    event.preventDefault();
    wantFocus.current = true;
    if (outcome.kind === 'focus') setFocusId(outcome.id);
    else if (outcome.kind === 'expand') onToggle(outcome.id, true);
    else if (outcome.kind === 'collapse') onToggle(outcome.id, false);
    else onSelect(outcome.id);
  };

  if (!rows.length) return <p className="ord-hint">Esta fuente aún no tiene carpetas leídas.</p>;

  return (
    <div role="tree" aria-label="Carpetas de Drive" className="ord-tree">
      {rows.map(({ node, level, hasChildren, expanded: open, position, setSize }) => {
        const rule = node.dateRule ? ruleShortLabel(node.dateRule) : null;
        return (
          <div
            key={node.id}
            ref={(element) => {
              if (element) refs.current.set(node.id, element);
              else refs.current.delete(node.id);
            }}
            role="treeitem"
            tabIndex={node.id === tabStop ? 0 : -1}
            aria-level={level}
            aria-posinset={position}
            aria-setsize={setSize}
            aria-selected={node.id === selectedId}
            aria-expanded={hasChildren ? open : undefined}
            className="ord-node"
            style={{ paddingLeft: 8 + (level - 1) * 12 }}
            title={node.name}
            onFocus={() => setFocusId(node.id)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget) onKeyDown(event, node.id);
            }}
            onClick={() => onSelect(node.id)}
          >
            <span
              className={`ord-chevron${open ? ' open' : ''}${hasChildren ? '' : ' leaf'}`}
              aria-hidden="true"
              onClick={(event) => {
                if (!hasChildren) return;
                event.stopPropagation();
                onToggle(node.id, !open);
              }}
            >
              <ChevronRight />
            </span>
            <span className="ord-node-name">{node.name}</span>
            {rule && (
              <span className="ord-rule" title={`Fecha de la carpeta: ${rule}`}>
                <CalendarCheck aria-hidden="true" />
                <span className="sp-sr">Fecha de la carpeta: </span>
                {rule}
              </span>
            )}
            <span className={`ord-count${node.subtreeToDateCount === 0 ? ' ok' : ''}`}>
              {toDateText(node.subtreeToDateCount)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
