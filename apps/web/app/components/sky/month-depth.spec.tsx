/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Precision, TimelinePhoto, TimelinePhotoPage } from '../timeline-model';
import { MonthDepth } from './MonthDepth';
import { SkyStage } from './SkyStage';
import { peekPendingTravel, resetTravel, setPendingTravel } from './travel';

const cache = vi.hoisted(() => ({
  getCachedGallery: vi.fn(),
  loadGalleryPage: vi.fn(),
  getCachedMonthPreviews: vi.fn(),
  loadMonthPreviews: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const viewer = vi.hoisted(() => ({
  props: null as null | {
    photos: { id: string }[];
    initialIndex: number;
    loadMore?: () => Promise<{ items: { id: string }[]; nextCursor: string | null } | null>;
    total?: number | null;
    source?: {
      rectOf: (id: string) => { left: number; width: number } | null;
      focusTile?: (id: string) => boolean;
    };
    onClose: () => void;
  },
}));

vi.mock('../timeline-cache', () => cache);
vi.mock('../../../lib/navigation', () => ({
  usePathname: () => '/timeline',
  useRouter: () => router,
}));
vi.mock('../TimelinePhotoViewer', () => ({
  TimelinePhotoViewer: (props: NonNullable<typeof viewer.props>) => {
    viewer.props = props;
    return <div role="dialog">Visor {props.initialIndex}</div>;
  },
}));

const photo = (
  id: string,
  value: string | null,
  precision: Precision,
  width = 1500,
  height = 1000,
): TimelinePhoto => ({
  id,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  dimensions: { width, height },
  effectiveDate: { value, precision },
});
const day = (id: string, date: number, width = 1500, height = 1000) =>
  photo(id, `2004-08-${String(date).padStart(2, '0')}T00:00:00.000Z`, 'DAY', width, height);

const RETURN = '/organizar?folder=abc';
const settle = (ms = 60) =>
  act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const page = (items: TimelinePhoto[], nextCursor: string | null): TimelinePhotoPage => ({
  items,
  nextCursor,
});

describe('MonthDepth', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollHeight: number;
  const mount = async (month: number | 'sin-mes' = 8) => {
    await act(async () =>
      root.render(
        <SkyStage
          orientation="vertical"
          onOrientationChange={() => undefined}
          label="Línea de vida"
        >
          <MonthDepth
            year={2004}
            month={month}
            returnTo={RETURN}
            returnLabel={null}
            onLanded={vi.fn()}
          />
        </SkyStage>,
      ),
    );
    await settle();
  };
  const tiles = () => [...container.querySelectorAll<HTMLButtonElement>('button.sky-ph')];
  const sections = () => [...container.querySelectorAll<HTMLElement>('.sky-day')];
  const railButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.sky-rail button')];

  beforeEach(() => {
    resetTravel();
    viewer.props = null;
    Object.values(cache).forEach((mock) => mock.mockReset());
    cache.getCachedGallery.mockReturnValue(null);
    cache.getCachedMonthPreviews.mockReturnValue(null);
    cache.loadMonthPreviews.mockResolvedValue({
      year: 2004,
      items: [
        { month: 8, kind: 'MONTH', label: null, photoCount: 214, previews: [] },
        { month: null, kind: 'YEAR', label: 'Fecha sin concretar', photoCount: 9, previews: [] },
      ],
    });
    router.replace.mockClear();
    // A long track keeps the end of the content out of reach unless a test moves closer.
    scrollHeight = 100_000;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('draws the month with its total, a section per day and an honest undated group', async () => {
    cache.loadGalleryPage.mockResolvedValue(
      page(
        [day('a', 14), day('b', 14), day('c', 9), photo('d', '2004-08-01T00:00:00.000Z', 'MONTH')],
        'c1',
      ),
    );
    await mount();

    expect(container.querySelector('h1')?.textContent).toBe('Agosto 2004');
    expect(container.querySelector('.sky-head p')?.textContent).toBe('214 fotos');
    expect(sections().map((section) => section.getAttribute('aria-label'))).toEqual([
      '14 de agosto: 2 fotos',
      '9 de agosto: 1 foto',
      'Día sin concretar: 1 foto',
    ]);
    expect(sections()[2]!.getAttribute('data-undated')).toBe('true');
    expect(cache.loadGalleryPage).toHaveBeenCalledWith(2004, 8, null, 60);
  });

  it('names every tile by its date and serves the 640 and 1280 variants lazily', async () => {
    cache.loadGalleryPage.mockResolvedValue(
      page([day('a', 14, 3000, 2000), photo('d', '2004-08-01T00:00:00.000Z', 'MONTH')], null),
    );
    await mount();

    expect(tiles().map((tile) => tile.getAttribute('aria-label'))).toEqual([
      '14 de agosto de 2004',
      'agosto de 2004',
    ]);
    const image = tiles()[0]!.querySelector('img')!;
    expect(image.getAttribute('src')).toContain('/v1/photos/a/thumbnail');
    expect(image.getAttribute('src')).toContain('width=640');
    expect(image.getAttribute('srcset')).toMatch(/width=640 640w, .*width=1280 1280w/);
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('width')).toBe('3000');
    expect(image.getAttribute('height')).toBe('2000');
  });

  it('lays tiles out with their real aspect ratios, clamped, inside lanes', async () => {
    cache.loadGalleryPage.mockResolvedValue(
      page([day('wide', 14, 4000, 1000), day('tall', 14, 1000, 4000), day('std', 14)], null),
    );
    await mount();

    const [wide, tall, standard] = tiles();
    const ratio = (tile: HTMLElement) =>
      parseFloat(tile.style.width) / parseFloat(tile.style.height);
    expect(ratio(wide!)).toBeCloseTo(2);
    expect(ratio(tall!)).toBeCloseTo(0.6);
    expect(ratio(standard!)).toBeCloseTo(1.5);
    expect(wide!.style.width).toBe(tall!.style.width);
  });

  it('shows the photos that only know their year under a single undated section', async () => {
    cache.loadGalleryPage.mockResolvedValue(
      page(
        [
          photo('y1', '2004-01-01T00:00:00.000Z', 'YEAR'),
          photo('y2', '2004-01-01T00:00:00.000Z', 'YEAR'),
        ],
        null,
      ),
    );
    await mount('sin-mes');

    expect(cache.loadGalleryPage).toHaveBeenCalledWith(2004, 'sin-mes', null, 60);
    expect(container.querySelector('h1')?.textContent).toBe('2004, sin mes');
    expect(sections().map((section) => section.getAttribute('aria-label'))).toEqual([
      'Fecha sin concretar: 2 fotos',
    ]);
    expect(container.querySelector('.sky-head p')?.textContent).toBe('9 fotos');
    expect(railButtons().map((button) => button.textContent)).toEqual(['S/F2']);
  });

  it('lists the loaded days in the rail and updates it as pages arrive', async () => {
    cache.loadGalleryPage
      .mockResolvedValueOnce(page([day('a', 14), day('b', 9)], 'c1'))
      .mockResolvedValueOnce(
        page([day('c', 9), day('d', 5), photo('e', '2004-08-01T00:00:00.000Z', 'MONTH')], null),
      );
    scrollHeight = 100;
    await mount();

    expect(railButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Ir a 14 de agosto',
      'Ir a 9 de agosto',
      'Ir a 5 de agosto',
      'Ir a Día sin concretar',
    ]);
    expect(railButtons().map((button) => button.textContent)).toEqual([
      '141',
      '092',
      '051',
      'S/D1',
    ]);
  });

  describe('paging', () => {
    it('does not ask for more while the end of the content is far away', async () => {
      cache.loadGalleryPage.mockResolvedValue(page([day('a', 14)], 'c1'));
      await mount();

      expect(cache.loadGalleryPage).toHaveBeenCalledTimes(1);
      expect(tiles()).toHaveLength(1);
    });

    it('keeps paging while a cursor exists and the end is near, even if the track does not grow', async () => {
      cache.loadGalleryPage
        .mockResolvedValueOnce(page([day('a', 14), day('b', 14), day('c', 13)], 'c1'))
        .mockResolvedValueOnce(page([day('d', 13), day('e', 12)], 'c2'))
        .mockResolvedValueOnce(page([day('f', 12)], null));
      scrollHeight = 100;
      await mount();
      await settle(250);

      // The jsdom track never changes length: a settled request must not stall the next one.
      expect(cache.loadGalleryPage.mock.calls.map((call) => [call[2], call[3]])).toEqual([
        [null, 60],
        ['c1', 60],
        ['c2', 60],
      ]);
      expect(tiles()).toHaveLength(6);
      expect(sections().map((section) => section.getAttribute('aria-label'))).toEqual([
        '14 de agosto: 2 fotos',
        '13 de agosto: 2 fotos',
        '12 de agosto: 2 fotos',
      ]);
    });

    it('goes past a page made only of photos it already has', async () => {
      cache.loadGalleryPage
        .mockResolvedValueOnce(page([day('a', 14), day('b', 14)], 'c1'))
        .mockResolvedValueOnce(page([day('a', 14), day('b', 14)], 'c2'))
        .mockResolvedValueOnce(page([day('c', 13)], null));
      scrollHeight = 100;
      await mount();
      await settle(250);

      expect(cache.loadGalleryPage.mock.calls.map((call) => call[2])).toEqual([null, 'c1', 'c2']);
      expect(tiles()).toHaveLength(3);
    });

    it('asks for one page at a time', async () => {
      let release: (value: TimelinePhotoPage) => void = () => undefined;
      cache.loadGalleryPage
        .mockResolvedValueOnce(page([day('a', 14)], 'c1'))
        .mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
      scrollHeight = 100;
      await mount();
      await settle(200);

      expect(cache.loadGalleryPage).toHaveBeenCalledTimes(2);
      await act(async () => release(page([day('b', 13)], null)));
      await settle();
      expect(cache.loadGalleryPage).toHaveBeenCalledTimes(2);
      expect(tiles()).toHaveLength(2);
    });

    it('extends the lanes without moving the tiles that were already placed', async () => {
      const first = Array.from({ length: 6 }, (_, index) =>
        day(`a${index}`, 14, 1000 + index * 300, 1000),
      );
      let deliver: (value: TimelinePhotoPage) => void = () => undefined;
      cache.loadGalleryPage.mockResolvedValueOnce(page(first, 'c1')).mockReturnValueOnce(
        new Promise<TimelinePhotoPage>((resolve) => {
          deliver = resolve;
        }),
      );
      scrollHeight = 100;
      await mount();
      const geometryOf = () =>
        tiles().map((tile) => [tile.style.left, tile.style.top, tile.style.height]);
      const placed = geometryOf();
      expect(placed).toHaveLength(6);

      await act(async () =>
        deliver(
          page(
            Array.from({ length: 6 }, (_, index) => day(`b${index}`, 14, 1500, 1000 + index * 200)),
            null,
          ),
        ),
      );
      await settle();

      expect(tiles()).toHaveLength(12);
      expect(geometryOf().slice(0, 6)).toEqual(placed);
      expect(sections()).toHaveLength(1);
    });

    it('shows a quiet status while a page loads and an inline alert with retry when it fails', async () => {
      let rejectNext: (reason: Error) => void = () => undefined;
      cache.loadGalleryPage.mockResolvedValueOnce(page([day('a', 14)], 'c1')).mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectNext = reject;
        }),
      );
      scrollHeight = 100;
      await mount();

      expect(container.querySelector('.sky-tail [role="status"]')?.textContent).toContain(
        'Cargando más fotos',
      );
      await act(async () => rejectNext(new Error('offline')));
      await settle();
      const alert = container.querySelector('.sky-tail [role="alert"]')!;
      expect(alert.textContent).toContain('No se pudieron cargar más fotos');
      expect(tiles()).toHaveLength(1);

      cache.loadGalleryPage.mockResolvedValueOnce(page([day('b', 13)], null));
      await act(async () => alert.querySelector('button')!.click());
      await settle();
      expect(cache.loadGalleryPage).toHaveBeenLastCalledWith(2004, 8, 'c1', 60);
      expect(tiles()).toHaveLength(2);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });
  });

  it('reports a first-page failure as an alert and retries', async () => {
    cache.loadGalleryPage.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron');

    cache.loadGalleryPage.mockResolvedValue(page([day('a', 14)], null));
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
    );
    await settle();
    expect(tiles()).toHaveLength(1);
    expect(cache.loadGalleryPage).toHaveBeenLastCalledWith(2004, 8, null, 60);
  });

  it('sends people back up to the year when the period has no photos', async () => {
    cache.loadGalleryPage.mockResolvedValue(page([], null));
    await mount();

    expect(router.replace).toHaveBeenCalledWith(
      `/timeline/2004?returnTo=${encodeURIComponent(RETURN)}`,
    );
    expect(tiles()).toHaveLength(0);
  });

  it('starts from the pages already cached instead of asking again', async () => {
    cache.getCachedGallery.mockReturnValue({
      photos: [day('a', 14), day('b', 9)],
      nextCursor: null,
    });
    await mount();

    expect(cache.loadGalleryPage).not.toHaveBeenCalled();
    expect(tiles()).toHaveLength(2);
  });

  it('opens the viewer with the loaded photos, the clicked index and a way to load more', async () => {
    cache.loadGalleryPage
      .mockResolvedValueOnce(page([day('a', 14), day('b', 14), day('c', 9)], 'c1'))
      .mockResolvedValueOnce(page([day('d', 5)], null));
    await mount();

    await act(async () => tiles()[2]!.click());
    expect(container.ownerDocument.querySelector('[role="dialog"]')).not.toBeNull();
    expect(viewer.props!.initialIndex).toBe(2);
    expect(viewer.props!.photos.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(viewer.props!.loadMore).toBeTypeOf('function');

    let result: Awaited<ReturnType<NonNullable<typeof viewer.props>['loadMore'] & (() => unknown)>>;
    await act(async () => {
      result = await viewer.props!.loadMore!();
    });
    expect(result!).toEqual(page([day('d', 5)], null));
    await settle();
    expect(tiles()).toHaveLength(4);
    expect(viewer.props!.photos).toHaveLength(4);
    expect(viewer.props!.loadMore).toBeUndefined();

    await act(async () => viewer.props!.onClose());
    expect(container.ownerDocument.querySelector('[role="dialog"]')).toBeNull();
  });

  it('lets the viewer find the tile of a photo to grow from and to give focus back to', async () => {
    cache.loadGalleryPage.mockResolvedValue(page([day('a', 14), day('b', 14)], null));
    await mount();
    await act(async () => tiles()[1]!.click());

    expect(viewer.props!.total).toBe(214);
    const tile = tiles()[1]!;
    vi.spyOn(tile, 'getBoundingClientRect').mockReturnValue({
      left: 120,
      top: 40,
      right: 320,
      bottom: 170,
      width: 200,
      height: 130,
      x: 120,
      y: 40,
      toJSON: () => ({}),
    });
    expect(viewer.props!.source!.rectOf('b')).toMatchObject({ left: 120, width: 200 });
    expect(viewer.props!.source!.rectOf('missing')).toBeNull();
    expect(viewer.props!.source!.focusTile!('b')).toBe(true);
    expect(document.activeElement).toBe(tile);
    expect(viewer.props!.source!.focusTile!('missing')).toBe(false);
  });

  it('plays the pending travel into this depth and consumes it', async () => {
    setPendingTravel({ mode: 'in', origin: { x: 10, y: 10 }, landKey: null });
    cache.loadGalleryPage.mockResolvedValue(page([day('a', 14)], null));
    await mount();

    expect(peekPendingTravel()).toBeNull();
    expect(tiles()).toHaveLength(1);
  });
});
