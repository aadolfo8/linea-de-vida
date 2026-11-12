'use client';

import { useReducedMotion } from '../../lib/use-reduced-motion';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { activeDriveConnection, api, type Session } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { emptyCopy, headline, pileCopy } from '../../lib/ordering/copy';
import { draftFromStored, draftToPayload } from '../../lib/ordering/dates';
import { photoCountLabel } from '../components/timeline-model';
import { withManualDate } from '../../lib/ordering/results';
import { findFolder } from '../../lib/ordering/tree';
import type { DateDraft, OrderingPhoto, Pile } from '../../lib/ordering/types';
import { thumbnailVariantUrl } from '../../lib/media';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { ToastHost } from '../components/ToastHost';
import { DateSheet } from './DateSheet';
import { GridSkeleton, LoadMore, PhotoGrid } from './PhotoGrid';
import { ActionBar, FolderBar, Peek, SuggestionBanner } from './Panels';
import { QuickMode, type QuickResult } from './QuickMode';
import { Sidebar } from './Sidebar';
import { usePhotoSelection } from './use-photo-selection';
import { useTreeExpansion } from './use-tree-expansion';
import { FolderDateDialog } from './FolderDateDialog';
import { useOrderingActions } from './use-ordering-actions';
import { useOrderingData } from './use-ordering-data';
import './ordenar.css';

type Dialog = 'date' | 'folder' | 'quick' | null;

/** Ordenar: put dates on photos in piles, by folder or in batches. */
export function OrdenarScreen({ session }: { session: Session }) {
  const reduced = useReducedMotion() ?? false;
  const data = useOrderingData({ reduced });
  const { location, list, piles, pile, tree, folder, source, suggestions } = data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const lastYear = useRef<number | null>(null);

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
  const { selected, clearSelection, selectingRest } = selection;
  const actions = useOrderingActions(data, selection.removeSelected);

  const { expanded, toggleFolder } = useTreeExpansion(tree, folderId);

  const onTile = selection.onTile;

  const everyLoadedSelected = selection.everyLoadedSelected;
  const selectAll = selection.selectAll;
  const selectWholePile = selection.selectWholePile;
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

  const initialDraft = (): { year: number | null; month: number | null; day: number | null } => {
    const only = selectedPhotos.length === 1 ? selectedPhotos[0]! : null;
    const stored = only
      ? draftFromStored(only.effectiveDate.value, only.effectiveDate.precision)
      : null;
    return stored ?? { year: lastYear.current, month: null, day: null };
  };

  const applyDate = (draft: DateDraft) => {
    lastYear.current = draft.year;
    setDialog(null);
    void actions.applyDate([...selected], draft);
  };

  const node = tree && folderId ? findFolder(tree.items, folderId) : null;
  const folderRule = node?.dateRule ?? folder?.dateRule ?? null;
  const closeQuick = (summary: QuickResult) => {
    setDialog(null);
    if (summary.empty) {
      actions.show({ tone: 'ok', message: 'No queda nada por fechar en esta vista.' });
      return;
    }
    if (summary.dated || summary.hidden) {
      notifyArchiveIndexUpdated();
      data.reloadList();
      void data.refreshCounts();
      actions.show({
        tone: 'ok',
        message: `Hecho: ${photoCountLabel(summary.dated)} fechadas${summary.hidden ? ` y ${photoCountLabel(summary.hidden)} ocultas` : ''}.`,
      });
    }
  };

  const peekIndex = peekId ? items.findIndex((item) => item.id === peekId) : -1;
  const hiddenPile = pile === 'hidden';
  const toDo = (piles?.undated ?? 0) + (piles?.yearOnly ?? 0);
  const title = folder && folderId ? folder.name : pile ? pileCopy[pile].title : '';
  const empty = pile ? emptyCopy[pile] : null;

  const selectPile = (next: Pile) => data.patchLocation({ pile: next });
  const sourceName = source?.name ?? 'Tus fotos';

  const body = () => {
    if (data.sources.status === 'loading' || !location)
      return <p className="ord-hint">Cargando tu archivo…</p>;
    if (data.sources.status === 'error')
      return (
        <div role="alert" className="sp-alert">
          No se pudo cargar tu archivo.{' '}
          <button type="button" className="sp-btn" onClick={data.reloadSources}>
            Reintentar
          </button>
        </div>
      );
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
          onPile={selectPile}
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
            <div className="ord-tools">
              {items.length > 0 && (
                <button type="button" className="sp-btn ghost" onClick={selectAll}>
                  {everyLoadedSelected ? 'Quitar selección' : 'Seleccionar todas'}
                </button>
              )}
              {list.nextCursor && pileTotal > ids.length && (
                <button
                  type="button"
                  className="sp-btn ghost"
                  disabled={selectingRest !== null}
                  onClick={() => void selectWholePile()}
                >
                  {selectingRest === null
                    ? `Seleccionar las ${pileTotal.toLocaleString('es-ES')} del montón`
                    : `Seleccionando… ${selectingRest.toLocaleString('es-ES')}`}
                </button>
              )}
            </div>
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
            <div role="alert" className="sp-alert">
              No se pudo cargar esta carpeta.{' '}
              <button type="button" className="sp-btn" onClick={data.reloadFolder}>
                Reintentar
              </button>
            </div>
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
            <div role="alert" className="sp-alert">
              No se pudieron cargar las fotos. Tu archivo sigue intacto.{' '}
              <button type="button" className="sp-btn" onClick={data.reloadList}>
                Reintentar
              </button>
            </div>
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
              onToggle={onTile}
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

      {dialog === 'date' && (
        <DateSheet
          title={`Poner fecha a ${photoCountLabel(selected.size)}`}
          subtitle="Basta con el año. Si sabes el mes o el día, mejor."
          previewUrls={selectedPhotos
            .slice(0, 12)
            .map((photo) => thumbnailVariantUrl(api, photo.thumbnailUrl, 640))}
          extraPhotos={Math.max(0, selected.size - 12)}
          initial={initialDraft()}
          applyText={`Poner a ${photoCountLabel(selected.size)}`}
          onApply={applyDate}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'folder' && folder && folderId && (
        <FolderDateDialog
          folder={folder}
          folderRule={folderRule}
          defaultIncludeSubfolders={location?.includeSubfolders ?? true}
          fallbackYear={lastYear.current}
          onApply={(draft, options) => {
            lastYear.current = draft.year;
            setDialog(null);
            void actions.applyFolderDate(
              { id: folder.id, name: folder.name },
              { ...draftToPayload(draft), ...options },
              folderRule,
            );
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'quick' && <QuickMode scope={data.scope} onClose={closeQuick} />}
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
