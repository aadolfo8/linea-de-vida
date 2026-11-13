import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addAll,
  allSelected,
  removeAll,
  selectRange,
  toggleId,
} from '../../lib/ordering/selection';

const NO_SELECTION: ReadonlySet<string> = new Set();

/**
 * The photos ticked in the grid: click toggles, shift-click selects a range, Escape clears (unless a
 * dialog is open), and a different view starts empty. "Select the whole pile" reads the rest of
 * the ids from the server a page at a time.
 */
export function usePhotoSelection({
  ids,
  viewKey,
  blocked,
  fetchRemainingIds,
  onSelectFailed,
}: {
  ids: readonly string[];
  viewKey: string;
  /** A dialog or the peek is open: Escape belongs to it. */
  blocked: boolean;
  fetchRemainingIds: (onProgress?: (count: number) => void) => Promise<string[]>;
  onSelectFailed: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [selectingRest, setSelectingRest] = useState<number | null>(null);
  const anchor = useRef<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelected(NO_SELECTION);
    anchor.current = null;
  }, []);

  useEffect(clearSelection, [viewKey, clearSelection]);

  useEffect(() => {
    if (!selected.size || blocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      clearSelection();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected.size, blocked, clearSelection]);

  const onTile = (id: string, event: { shiftKey: boolean }) => {
    const from = anchor.current;
    if (event.shiftKey && from) setSelected((current) => selectRange(current, ids, from, id));
    else setSelected((current) => toggleId(current, id));
    anchor.current = id;
  };

  const everyLoadedSelected = allSelected(selected, ids);
  const selectAll = () => {
    if (everyLoadedSelected) setSelected(NO_SELECTION);
    else setSelected((current) => addAll(current, ids));
  };

  const selectWholePile = async () => {
    setSelectingRest(0);
    try {
      const rest = await fetchRemainingIds(setSelectingRest);
      setSelected((current) => addAll(current, [...ids, ...rest]));
    } catch {
      onSelectFailed();
    } finally {
      setSelectingRest(null);
    }
  };

  /** Photos that changed pile are no longer selected. */
  const removeSelected = useCallback((gone: readonly string[]) => {
    setSelected((current) => removeAll(current, gone));
  }, []);

  return {
    selected,
    setSelected,
    clearSelection,
    selectingRest,
    onTile,
    everyLoadedSelected,
    selectAll,
    selectWholePile,
    removeSelected,
  };
}
