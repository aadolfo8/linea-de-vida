import { useReducedMotion } from '../../lib/use-reduced-motion';
import { Link } from '../../lib/link';
import { useMemo, useState } from 'react';
import { activeDriveConnection, type Session } from '../../lib/api';
import { emptyCopy, headline, pileCopy } from '../../lib/ordering/copy';
import { photoCountLabel } from '../components/timeline-model';
import { withManualDate } from '../../lib/ordering/results';
import { findFolder } from '../../lib/ordering/tree';
import type { OrderingPhoto, Pile } from '../../lib/ordering/types';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { ToastHost } from '../components/ToastHost';
import { OrderingDialogs, type Dialog } from './OrderingDialogs';
import { GridSkeleton, LoadMore, PhotoGrid } from './PhotoGrid';
import { ActionBar, FolderBar, Peek, SuggestionBanner } from './Panels';
import { Sidebar } from './Sidebar';
import { usePhotoSelection } from './use-photo-selection';
import { useTreeExpansion } from './use-tree-expansion';
import { SelectionTools } from './SelectionTools';
import { RetryAlert } from '../components/RetryAlert';
import { useOrderingActions } from './use-ordering-actions';
import { useOrderingData } from './use-ordering-data';
import './ordenar.css';

/** Ordenar: put dates on photos in piles, by folder or in batches. */
export function OrdenarScreen({ session }: { session: Session }) {
  const reduced = useReducedMotion() ?? false;
  const data = useOrderingData({ reduced });
  const { location, list, piles, pile, tree, folder, source, suggestions } = data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  const folderId = location?.folderId ?? null;
  const items = list.items;
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  const selection = usePhotoSelection({
    ids,
    viewKey: `${data.scopeKey}|${pile}`,
    blocked: dialog !== null || peekId !== null,
    fetchRemainingIds: data.fetchRemainingIds,
    onSelectFailed: () =>
      actions.show({
        tone: 'error',
        message: 'No se pudieron seleccionar todas las fotos del montón. Inténtalo de nuevo.',
      }),
  });
  const { selected, clearSelection, selectingRest, everyLoadedSelected, selectAll } = selection;
  const actions = useOrderingActions(data, selection.removeSelected);

  const { expanded, toggleFolder } = useTreeExpansion(tree, folderId);
  const pileTotal = pile && piles ? piles[pile] : 0;

  const selectedPhotos = useMemo(
    () =>
      [...selected]
        .map((id) => data.catalog.current.get(id))
        .filter((photo): photo is OrderingPhoto => Boolean(photo)),
    // The catalog is a ref; the list changing is what makes it worth recomputing.
    [selected, list.items],
  );
  const canClear = withManualDate(selectedPhotos).length > 0;

  const node = tree && folderId ? findFolder(tree.items, folderId) : null;
  const folderRule = node?.dateRule ?? folder?.dateRule ?? null;
  const peekIndex = peekId ? items.findIndex((item) => item.id === peekId) : -1;
  const hiddenPile = pile === 'hidden';
  const toDo = (piles?.undated ?? 0) + (piles?.yearOnly ?? 0);
  const title = folder && folderId ? folder.name : pile ? pileCopy[pile].title : '';
  const empty = pile ? emptyCopy[pile] : null;
  const sourceName = source?.name ?? 'Tus fotos';

  const body = () => {
    if (data.sources.status === 'loading' || !location)
      return <p className="ord-hint">Cargando tu archivo…</p>;
    if (data.sources.status === 'error')
      return <RetryAlert message="No se pudo cargar tu archivo." onRetry={data.reloadSources} />;
    if (!source)
      return (
        <div className="sp-empty">
          <b>Aún no hay fotos</b>
          Añade una exportación de Google Fotos o una carpeta de Drive para empezar a ordenarlas.
          <p>
            <Link className="sp-btn primary" href="/ajustes">
              Añadir fotos
            </Link>
          </p>
        </div>
      );
    return (
      <div className="ord-desk">
        <Sidebar
          piles={piles}
          pile={pile}
          folderSelected={Boolean(folderId)}
          onPile={(next: Pile) => data.patchLocation({ pile: next })}
          sources={data.sources.items}
          sourceId={source.id}
          onSource={(id) => data.patchLocation({ sourceId: id, folderId: null, pile: null })}
          tree={tree}
          folderId={folderId}
          expanded={expanded}
          onToggleFolder={toggleFolder}
          onFolder={(id) => data.patchLocation({ folderId: id })}
        />
        <section className="ord-content" aria-label="Fotos de la vista">
          <div className="ord-toolbar">
            <div>
              <h2>{title}</h2>
              <p className="ord-sub">
                {pile ? pileCopy[pile].sub : ''}
                {piles && pile ? ` ${photoCountLabel(piles[pile])}.` : ''}
              </p>
            </div>
            <SelectionTools
              loadedCount={items.length}
              allLoadedSelected={everyLoadedSelected}
              onSelectAll={selectAll}
              canSelectRest={Boolean(list.nextCursor) && pileTotal > ids.length}
              pileTotal={pileTotal}
              selectingRest={selectingRest}
              onSelectRest={() => void selection.selectWholePile()}
            />
          </div>

          {folder && folderId && (
            <FolderBar
              sourceName={sourceName}
              folder={folder}
              node={node}
              includeSubfolders={location.includeSubfolders}
              busy={actions.busy}
              onGoTo={(id) => data.patchLocation({ folderId: id })}
              onIncludeSubfolders={(value) => data.patchLocation({ includeSubfolders: value })}
              onSetDate={() => setDialog('folder')}
              onRemoveDate={() =>
                void actions.removeFolderDate({ id: folder.id, name: folder.name }, folderRule)
              }
            />
          )}
          {data.folderFailed && (
            <RetryAlert message="No se pudo cargar esta carpeta." onRetry={data.reloadFolder} />
          )}
          {suggestions && suggestions.totalCount > 0 && (
            <SuggestionBanner
              suggestions={suggestions}
              busy={actions.busy}
              onAccept={() => void actions.acceptSuggestions()}
            />
          )}
          {source.type === 'GOOGLE_TAKEOUT' && !folderId && pile !== 'dated' && (
            <p className="ord-hint">
              Las fotos de una exportación de Google Fotos suelen traer su fecha; aquí solo aparecen
              las que no la trajeron.
            </p>
          )}

          {list.status === 'loading' && <GridSkeleton />}
          {list.status === 'error' && (
            <RetryAlert
              message="No se pudieron cargar las fotos. Tu archivo sigue intacto."
              onRetry={data.reloadList}
            />
          )}
          {list.status === 'ready' && items.length === 0 && empty && (
            <div className="sp-empty">
              <b>{empty.title}</b>
              {empty.text}
            </div>
          )}
          {items.length > 0 && (
            <PhotoGrid
              photos={items}
              selected={selected}
              leaving={data.leaving}
              onToggle={selection.onTile}
              onPeek={setPeekId}
            />
          )}
          {list.nextCursor && (
            <LoadMore loading={list.loadingMore} failed={list.moreFailed} onLoad={data.loadMore} />
          )}
        </section>
      </div>
    );
  };

  return (
    <SkyPage name={session.user.displayName} mainId="ordenar-main">
      <div className="sp-head">
        <div>
          <h1>Ordenar</h1>
          <p>{piles ? headline(piles) : 'Poner fecha a tus fotos, a mano o por montones.'}</p>
        </div>
        {source && (
          <button
            type="button"
            className="sp-btn primary"
            disabled={toDo === 0}
            onClick={() => setDialog('quick')}
          >
            Fechar una a una
          </button>
        )}
      </div>
      <DriveBanner connected={activeDriveConnection(session) !== null} />
      {body()}

      {selected.size > 0 && (
        <ActionBar
          count={selected.size}
          canClear={canClear}
          hiddenPile={hiddenPile}
          busy={actions.busy}
          onDate={() => setDialog('date')}
          onClear={() => void actions.clearDates([...selected])}
          onToggleHidden={() => void actions.setHidden([...selected], !hiddenPile)}
          onCancel={clearSelection}
        />
      )}

      <ToastHost toast={actions.toast} busy={actions.busy} onDismiss={actions.dismiss} />
      <p className="sp-sr" role="status" aria-live="polite">
        {actions.announcement}
      </p>

      <OrderingDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        data={data}
        actions={actions}
        selected={selected}
        selectedPhotos={selectedPhotos}
        folder={folder}
        folderRule={folderRule}
      />
      {peekId && peekIndex >= 0 && (
        <Peek
          photos={items}
          index={peekIndex}
          onChange={(index) => setPeekId(items[index]?.id ?? null)}
          onClose={() => setPeekId(null)}
        />
      )}
    </SkyPage>
  );
}
