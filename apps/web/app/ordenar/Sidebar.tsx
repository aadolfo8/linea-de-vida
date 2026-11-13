import { useId, useState } from 'react';
import { pileCopy } from '../../lib/ordering/copy';
import { toDateText } from '../../lib/ordering/tree';
import {
  PILES,
  type FolderTree as FolderTreeData,
  type Pile,
  type PileCounts,
  type Source,
} from '../../lib/ordering/types';
import { FolderTree } from './FolderTree';

/** The piles with live counts, the source choice (when there is more than one) and the folders. */
export function Sidebar({
  piles,
  pile,
  folderSelected,
  onPile,
  sources,
  sourceId,
  onSource,
  tree,
  folderId,
  expanded,
  onToggleFolder,
  onFolder,
}: {
  piles: PileCounts | null;
  pile: Pile | null;
  folderSelected: boolean;
  onPile: (pile: Pile) => void;
  sources: readonly Source[];
  sourceId: string | null;
  onSource: (id: string) => void;
  tree: FolderTreeData | null;
  folderId: string | null;
  expanded: ReadonlySet<string>;
  onToggleFolder: (id: string, open: boolean) => void;
  onFolder: (id: string | null) => void;
}) {
  const sourceSelectId = useId();
  const foldersId = useId();
  const [foldersOpen, setFoldersOpen] = useState(false);

  return (
    <aside className="ord-side" aria-label="Montones y carpetas">
      {sources.length > 1 && (
        <div className="ord-source">
          <label className="sp-label" htmlFor={sourceSelectId}>
            Fuente de fotos
          </label>
          <select
            id={sourceSelectId}
            value={sourceId ?? ''}
            onChange={(event) => onSource(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav aria-label="Montones" className="ord-piles">
        <h2 className="sp-label">Montones</h2>
        {PILES.map((key) => (
          <button
            key={key}
            type="button"
            className="ord-pile"
            data-pile={key}
            aria-pressed={pile === key}
            onClick={() => onPile(key)}
          >
            <b>
              <i aria-hidden="true" />
              {pileCopy[key].title}
            </b>
            <span>{piles ? piles[key].toLocaleString('es-ES') : '–'}</span>
          </button>
        ))}
      </nav>

      <div className="ord-folders">
        <button
          type="button"
          className="ord-folders-toggle sp-btn"
          aria-expanded={foldersOpen}
          aria-controls={foldersId}
          onClick={() => setFoldersOpen((open) => !open)}
        >
          Carpetas de Drive
        </button>
        <div id={foldersId} className="ord-folders-body" data-open={foldersOpen}>
          <h2 className="sp-label">Por carpeta de Drive</h2>
          <button
            type="button"
            className="ord-pile ord-all"
            aria-pressed={!folderSelected}
            onClick={() => onFolder(null)}
          >
            <b>Todas las carpetas</b>
            {tree && <span>{toDateText(tree.totals.toDateCount)}</span>}
          </button>
          {tree ? (
            <FolderTree
              tree={tree}
              selectedId={folderId}
              expanded={expanded}
              onToggle={onToggleFolder}
              onSelect={(id) => {
                onFolder(id);
                setFoldersOpen(false);
              }}
            />
          ) : (
            <p className="ord-hint">Cargando carpetas…</p>
          )}
          <p className="ord-hint">
            Las carpetas son solo un filtro. Puedes poner fecha a una carpeta entera si sus fotos
            son del mismo momento.
          </p>
        </div>
      </div>
    </aside>
  );
}
