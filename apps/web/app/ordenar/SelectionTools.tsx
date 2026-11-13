/** "Select all loaded" and, when more of the pile is still on the server, "select the whole pile". */
export function SelectionTools({
  loadedCount,
  allLoadedSelected,
  onSelectAll,
  canSelectRest,
  pileTotal,
  selectingRest,
  onSelectRest,
}: {
  loadedCount: number;
  allLoadedSelected: boolean;
  onSelectAll: () => void;
  canSelectRest: boolean;
  pileTotal: number;
  /** Ids read so far while selecting the rest, or null when idle. */
  selectingRest: number | null;
  onSelectRest: () => void;
}) {
  return (
    <div className="ord-tools">
      {loadedCount > 0 && (
        <button type="button" className="sp-btn ghost" onClick={onSelectAll}>
          {allLoadedSelected ? 'Quitar selección' : 'Seleccionar todas'}
        </button>
      )}
      {canSelectRest && (
        <button
          type="button"
          className="sp-btn ghost"
          disabled={selectingRest !== null}
          onClick={onSelectRest}
        >
          {selectingRest === null
            ? `Seleccionar las ${pileTotal.toLocaleString('es-ES')} del montón`
            : `Seleccionando… ${selectingRest.toLocaleString('es-ES')}`}
        </button>
      )}
    </div>
  );
}
