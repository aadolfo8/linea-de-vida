import type { OriginKind, DatePrecision } from '../../lib/ordering/types';

/**
 * A small in-memory archive that answers the Ordenar API, for the screen tests. It keeps the
 * rules that matter to the screen: a manual date moves a photo between piles, clearing it brings
 * the detected date back, and hidden photos only show in their own pile.
 */
type FakePhoto = {
  id: string;
  fileName: string;
  folderId: string | null;
  hidden: boolean;
  value: string | null;
  precision: DatePrecision;
  originKind: OriginKind;
  /** What clearing a manual date goes back to. */
  detected: { value: string | null; precision: DatePrecision; originKind: OriginKind };
};

export type FakeCall = { method: string; path: string; body: unknown };

const NONE = {
  value: null,
  precision: 'UNKNOWN' as DatePrecision,
  originKind: 'none' as OriginKind,
};

export function fakePhoto(
  id: string,
  options: Partial<Pick<FakePhoto, 'folderId' | 'hidden' | 'fileName'>> & {
    date?: { value: string; precision: DatePrecision; originKind: OriginKind };
  } = {},
): FakePhoto {
  const date = options.date ?? NONE;
  return {
    id,
    fileName: options.fileName ?? `${id}.jpg`,
    folderId: options.folderId ?? null,
    hidden: options.hidden ?? false,
    ...date,
    detected: options.date && options.date.originKind !== 'manual' ? options.date : NONE,
  };
}

const pileOf = (photo: FakePhoto) =>
  photo.hidden
    ? 'hidden'
    : photo.precision === 'UNKNOWN'
      ? 'undated'
      : photo.precision === 'YEAR'
        ? 'yearOnly'
        : 'dated';

export const tree = (overrides: { rule?: boolean } = {}) => ({
  sourceId: 's1',
  folderCount: 3,
  items: [
    {
      id: 'f1',
      name: 'Escaneos',
      path: ['Escaneos'],
      parentId: null,
      depth: 0,
      photoCount: 1,
      toDateCount: 1,
      subtreePhotoCount: 4,
      subtreeToDateCount: 3,
      dateRule: null,
      children: [
        {
          id: 'f2',
          name: '1998',
          path: ['Escaneos', '1998'],
          parentId: 'f1',
          depth: 1,
          photoCount: 3,
          toDateCount: 2,
          subtreePhotoCount: 3,
          subtreeToDateCount: 2,
          dateRule: overrides.rule
            ? {
                dateValue: '1998-01-01T00:00:00.000Z',
                precision: 'YEAR',
                scope: 'DIRECT_OVERRIDE',
                includeSubfolders: true,
                overrideCameraDates: false,
              }
            : null,
          children: [],
        },
      ],
    },
    {
      id: 'f3',
      name: 'Móvil',
      path: ['Móvil'],
      parentId: null,
      depth: 0,
      photoCount: 0,
      toDateCount: 0,
      subtreePhotoCount: 0,
      subtreeToDateCount: 0,
      dateRule: null,
      children: [],
    },
  ],
  unfiled: { photoCount: 0, toDateCount: 0 },
  totals: { photoCount: 4, toDateCount: 3 },
});

export function createFakeArchive(
  initial: FakePhoto[],
  options: {
    failIds?: string[];
    suggestions?: number;
    rule?: boolean;
    pageSize?: number;
    sources?: Array<{ id: string; name: string; type: 'GENERIC' | 'GOOGLE_TAKEOUT' }>;
  } = {},
) {
  const photos = initial.map((photo) => ({ ...photo }));
  const calls: FakeCall[] = [];
  const failing = new Set(options.failIds ?? []);
  let suggestions = options.suggestions ?? 0;
  const parentOf: Record<string, string | null> = { f1: null, f2: 'f1', f3: null };
  const inFolder = (photo: FakePhoto, folderId: string, subfolders: boolean) => {
    for (let id = photo.folderId; id; id = parentOf[id] ?? null) {
      if (id === folderId) return true;
      if (!subfolders) return false;
    }
    return false;
  };
  const scoped = (params: URLSearchParams) => {
    const folderId = params.get('folderId');
    const subfolders = params.get('includeSubfolders') !== 'false';
    return photos.filter((photo) => !folderId || inFolder(photo, folderId, subfolders));
  };
  const json = (photo: FakePhoto) => ({
    id: photo.id,
    fileName: photo.fileName,
    thumbnailUrl: `/v1/photos/${photo.id}/thumbnail`,
    effectiveDate: {
      value: photo.value,
      precision: photo.precision,
      origin: photo.originKind.toUpperCase(),
      originKind: photo.originKind,
    },
    hidden: photo.hidden,
    folderId: photo.folderId,
  });

  const handler = async (path: string, init?: RequestInit): Promise<unknown> => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const url = new URL(path, 'http://api.test');
    const route = url.pathname;
    const params = url.searchParams;

    if (route === '/photo-sources')
      return {
        items: (
          options.sources ?? [{ id: 's1', name: 'Fotos de la familia', type: 'GENERIC' }]
        ).map((source) => ({ ...source, driveFolderId: 'd1', status: 'ACTIVE' })),
        nextCursor: null,
      };
    if (route === '/ordering/piles') {
      const list = scoped(params);
      const count = (pile: string) => list.filter((photo) => pileOf(photo) === pile).length;
      return {
        undated: count('undated'),
        yearOnly: count('yearOnly'),
        dated: count('dated'),
        hidden: count('hidden'),
        total: list.filter((photo) => !photo.hidden).length,
      };
    }
    if (route === '/ordering/photos') {
      const pile = params.get('pile');
      const list = scoped(params)
        .filter((photo) => pileOf(photo) === pile)
        .sort((a, b) => a.id.localeCompare(b.id));
      const size = Number(params.get('limit') ?? 60);
      const limit = options.pageSize && size > options.pageSize ? options.pageSize : size;
      const start = Number(params.get('cursor') ?? 0);
      const page = list.slice(start, start + limit);
      return {
        items: page.map(json),
        nextCursor: start + limit < list.length ? String(start + limit) : null,
      };
    }
    if (route === '/photo-sources/s1/folder-tree') return tree({ rule: options.rule });
    if (route.startsWith('/indexed-folders/') && route.endsWith('/date/preview'))
      return {
        scopePhotoCount: 10,
        willChangeCount: 6,
        unchangedCount: 4,
        preservesManualCount: 2,
        replacesAutomaticCount: body?.overrideCameraDates ? 2 : 0,
        replacesFolderNameDateCount: 0,
      };
    if (route.startsWith('/indexed-folders/') && route.endsWith('/date'))
      return method === 'PUT'
        ? {
            rule: {
              dateValue: '1998-01-01T00:00:00.000Z',
              precision: body.precision,
              scope: 'DIRECT_OVERRIDE',
              includeSubfolders: body.includeSubfolders,
              overrideCameraDates: body.overrideCameraDates,
            },
            affectedCount: 6,
          }
        : { affectedCount: 6 };
    if (route.startsWith('/indexed-folders/')) {
      const id = route.split('/')[2]!;
      const node = tree({ rule: options.rule })
        .items.flatMap((item) => [item, ...item.children])
        .find((item) => item.id === id)!;
      const { children, ...own } = node;
      void children;
      return {
        ...own,
        sourceId: 's1',
        breadcrumb: own.parentId
          ? [
              { id: 'f1', name: 'Escaneos' },
              { id: own.id, name: own.name },
            ]
          : [{ id: own.id, name: own.name }],
        childFolders: [],
      };
    }
    if (route === '/ordering/filename-suggestions')
      return {
        totalCount: suggestions,
        groups: suggestions
          ? [
              {
                kind: 'whatsapp',
                photoCount: suggestions,
                earliest: '2019-03-12T00:00:00.000Z',
                latest: '2020-01-01T00:00:00.000Z',
                examples: [
                  {
                    id: 'p1',
                    fileName: 'IMG-20190312-WA0001.jpg',
                    date: '2019-03-12T00:00:00.000Z',
                  },
                ],
              },
            ]
          : [],
      };
    if (route === '/ordering/filename-suggestions/accept') {
      const applied = suggestions;
      suggestions = 0;
      return { appliedCount: applied };
    }
    if (route === '/photos/dates' && method === 'PUT') {
      const results = body.photoIds.map((id: string) => {
        const photo = photos.find((item) => item.id === id);
        if (!photo) return { id, status: 'NOT_FOUND' };
        if (failing.has(id)) return { id, status: 'FAILED' };
        photo.value = new Date(
          Date.UTC(body.year, (body.month ?? 1) - 1, body.day ?? 1),
        ).toISOString();
        photo.precision = body.precision;
        photo.originKind = 'manual';
        return { id, status: 'UPDATED' };
      });
      return {
        results,
        updatedCount: results.filter((r: { status: string }) => r.status === 'UPDATED').length,
      };
    }
    if (route === '/photos/dates/clear') {
      const results = body.photoIds.map((id: string) => {
        const photo = photos.find((item) => item.id === id);
        if (!photo) return { id, status: 'NOT_FOUND' };
        if (photo.originKind !== 'manual') return { id, status: 'NO_MANUAL_DATE' };
        Object.assign(photo, photo.detected);
        return { id, status: 'CLEARED' };
      });
      return { results, clearedCount: 0 };
    }
    if (route === '/photos/hide' || route === '/photos/unhide') {
      const hide = route === '/photos/hide';
      const results = body.photoIds.map((id: string) => {
        const photo = photos.find((item) => item.id === id);
        if (!photo) return { id, status: 'NOT_FOUND' };
        if (failing.has(id)) return { id, status: 'FAILED' };
        photo.hidden = hide;
        return { id, status: hide ? 'HIDDEN' : 'VISIBLE' };
      });
      return { results, changedCount: results.length };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  return { handler, calls, photos, failing };
}
