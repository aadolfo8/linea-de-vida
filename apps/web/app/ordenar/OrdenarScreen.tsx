'use client';

import { useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { activeDriveConnection, api, type Session } from '../../lib/api';
import { orderingApi } from '../../lib/ordering/client';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { emptyCopy, headline, pileCopy } from '../../lib/ordering/copy';
import { draftFromStored, draftToPayload } from '../../lib/ordering/dates';
import { photoCountLabel } from '../components/timeline-model';
import { withManualDate } from '../../lib/ordering/results';
import {
  addAll,
  allSelected,
  removeAll,
  selectRange,
  toggleId,
} from '../../lib/ordering/selection';
import { findFolder, initialExpanded, pathToFolder } from '../../lib/ordering/tree';
import type { DateDraft, OrderingPhoto, Pile } from '../../lib/ordering/types';
import { thumbnailVariantUrl } from '../../lib/media';
import { DriveBanner } from '../components/DriveBanner';
import { SkyPage } from '../components/SkyPage';
import { SkyToast } from '../components/SkyToast';
import { DateSheet } from './DateSheet';
import { GridSkeleton, LoadMore, PhotoGrid } from './PhotoGrid';
import { ActionBar, FolderBar, Peek, SuggestionBanner } from './Panels';
import { QuickMode, type QuickResult } from './QuickMode';
import { Sidebar } from './Sidebar';
import { useOrderingActions } from './use-ordering-actions';
import { useOrderingData } from './use-ordering-data';
import './ordenar.css';

type Dialog = 'date' | 'folder' | 'quick' | null;
const NO_SELECTION: ReadonlySet<string> = new Set();

/** Ordenar: put dates on photos in piles, by folder or in batches. */
export function OrdenarScreen({ session }: { session: Session }) {
  const reduced = useReducedMotion() ?? false;
  const data = useOrderingData({ reduced });
  const { location, list, piles, pile, tree, folder, source, suggestions } = data;
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [selectingRest, setSelectingRest] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const lastYear = useRef<number | null>(null);
  const expandedFor = useRef<string | null>(null);

  const onChanged = useCallback((ids: readonly string[]) => {
    setSelected((current) => removeAll(current, ids));
  }, []);
  const actions = useOrderingActions(data, onChanged);

  const folderId = location?.folderId ?? null;
  const items = list.items;
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  // A different view starts with nothing selected.
  useEffect(() => {
    setSelected(NO_SELECTION);
    anchor.current = null;
  }, [data.scopeKey, pile]);

  // The tree opens its top level and the way to the selected folder.
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

  // Escape drops the selection (dialogs take it first).
  useEffect(() => {
    if (!selected.size || dialog || peekId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setSelected(NO_SELECTION);
      anchor.current = null;
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected.size, dialog, peekId]);

  const onTile = (id: string, event: MouseEvent) => {
    const from = anchor.current;
    if (event.shiftKey && from) setSelected((current) => selectRange(current, ids, from, id));
    else setSelected((current) => toggleId(current, id));
    anchor.current = id;
  };

  const everyLoadedSelected = allSelected(selected, ids);
  const selectAll = () => {
    if (everyLoadedSelected) {
      setSelected(NO_SELECTION);
      return;
    }
    setSelected((current) => addAll(current, ids));
  };
  const pileTotal = pile && piles ? piles[pile] : 0;
  const selectWholePile = async () => {
    setSelectingRest(0);
    try {
      const rest = await data.fetchRemainingIds(setSelectingRest);
      setSelected((current) => addAll(current, [...ids, ...rest]));
    } catch {
      actions.show({
        tone: 'error',
        message: 'No se pudieron seleccionar todas las fotos del montón. Inténtalo de nuevo.',
      });
    } finally {
      setSelectingRest(null);
    }
  };

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
          onToggleFolder={(id, open) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (open) next.add(id);
              else next.delete(id);
              return next;
            })
          }
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

  const toast = actions.toast;
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
          onCancel={() => setSelected(NO_SELECTION)}
        />
      )}

      {toast && (
        <SkyToast
          key={toast.key}
          message={toast.message}
          tone={toast.tone}
          link={toast.link}
          busy={actions.busy}
          onUndo={
            toast.undo
              ? () => {
                  const undo = toast.undo;
                  actions.dismiss();
                  void undo?.();
                }
              : undefined
          }
          onRetry={
            toast.retry
              ? () => {
                  const retry = toast.retry;
                  actions.dismiss();
                  void retry?.();
                }
              : undefined
          }
          onDismiss={actions.dismiss}
        />
      )}
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
        <DateSheet
          title={`Fecha para «${folder.name}»`}
          subtitle="Se aplica a todas sus fotos. Si alguna la corriges luego a mano, tu corrección manda."
          previewUrls={[]}
          extraPhotos={0}
          initial={
            (folderRule && draftFromStored(folderRule.dateValue, folderRule.precision)) || {
              year: lastYear.current,
              month: null,
              day: null,
            }
          }
          applyText="Poner fecha a la carpeta"
          folder={{
            initial: {
              includeSubfolders:
                folderRule?.includeSubfolders ?? location?.includeSubfolders ?? true,
              overrideCameraDates: folderRule?.overrideCameraDates ?? false,
            },
            loadPreview: (draft, options) =>
              orderingApi.previewFolderDate(folderId, { ...draftToPayload(draft), ...options }),
          }}
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
