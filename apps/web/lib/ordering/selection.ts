/** Selection helpers: pure, so click, shift-click and "select all" behave the same everywhere. */

export function toggleId(selected: ReadonlySet<string>, id: string) {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Every id from `anchor` to `target` (inclusive, either direction); just `target` without anchor. */
export function rangeIds(ids: readonly string[], anchor: string | null, target: string) {
  const to = ids.indexOf(target);
  if (to < 0) return [];
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  if (from < 0) return [target];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export function selectRange(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  anchor: string | null,
  target: string,
) {
  const next = new Set(selected);
  for (const id of rangeIds(ids, anchor, target)) next.add(id);
  return next;
}

export function addAll(selected: ReadonlySet<string>, ids: readonly string[]) {
  const next = new Set(selected);
  for (const id of ids) next.add(id);
  return next;
}

export function removeAll(selected: ReadonlySet<string>, ids: Iterable<string>) {
  const next = new Set(selected);
  for (const id of ids) next.delete(id);
  return next;
}

/** True when every loaded id is selected (and there is at least one). */
export const allSelected = (selected: ReadonlySet<string>, ids: readonly string[]) =>
  ids.length > 0 && ids.every((id) => selected.has(id));

export function chunk<T>(items: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
}
