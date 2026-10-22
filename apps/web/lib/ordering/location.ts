import type { Pile } from './types';
import { PILES } from './types';

/** What the address of /ordenar remembers, so a link or a reload lands on the same view. */
export type OrderLocation = {
  sourceId: string | null;
  folderId: string | null;
  pile: Pile | null;
  includeSubfolders: boolean;
};

// Short names the early prototype and old links used for the piles.
const PILE_ALIASES: Record<string, Pile> = {
  none: 'undated',
  undated: 'undated',
  year: 'yearOnly',
  yearOnly: 'yearOnly',
  done: 'dated',
  dated: 'dated',
  hidden: 'hidden',
};

const pileFrom = (value: string | null): Pile | null =>
  value && Object.hasOwn(PILE_ALIASES, value) ? PILE_ALIASES[value]! : null;

export function parseOrderLocation(search: string): OrderLocation {
  const params = new URLSearchParams(search);
  return {
    sourceId: params.get('source') || null,
    folderId: params.get('folder') || null,
    pile: pileFrom(params.get('pile')),
    includeSubfolders: params.get('subfolders') !== '0',
  };
}

export function orderLocationSearch(location: OrderLocation) {
  const params = new URLSearchParams();
  if (location.sourceId) params.set('source', location.sourceId);
  if (location.folderId) params.set('folder', location.folderId);
  if (location.pile) params.set('pile', location.pile);
  if (!location.includeSubfolders) params.set('subfolders', '0');
  const text = params.toString();
  return text ? `?${text}` : '';
}

type RawParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Where the old /organizar address goes: the same source and folder, and "undated" if it asked. */
export function legacyOrganizarHref(params: RawParams) {
  const location: OrderLocation = {
    sourceId: first(params.source) || null,
    folderId: first(params.folder) || null,
    pile: first(params.filter) === 'undated' ? 'undated' : pileFrom(first(params.pile) ?? null),
    includeSubfolders: true,
  };
  return `/ordenar${orderLocationSearch(location)}`;
}

/** /settings keeps every parameter (the Drive consent returns there with `?oauth=`). */
export function legacySettingsHref(params: RawParams) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
      next.append(key, item);
  const text = next.toString();
  return `/ajustes${text ? `?${text}` : ''}`;
}

/** The pile to open first: the first one that still has work, so the screen never starts empty. */
export function defaultPile(counts: Record<Pile, number> & { total?: number }): Pile {
  return PILES.find((pile) => pile !== 'hidden' && counts[pile] > 0) ?? 'dated';
}
