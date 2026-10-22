/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelinePhoto } from '../timeline-model';
import { notifyArchiveIndexUpdated } from '../../../lib/archive-index-events';
import { SkyStage } from './SkyStage';
import { YearDepth } from './YearDepth';
import { YearsDepth } from './YearsDepth';
import { resetTravel } from './travel';

const cache = vi.hoisted(() => ({
  getCachedTimelineYears: vi.fn(),
  loadTimelineYears: vi.fn(),
  getCachedYearSummary: vi.fn(),
  loadYearSummary: vi.fn(),
  getCachedMonthPreviews: vi.fn(),
  loadMonthPreviews: vi.fn(),
}));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock('../timeline-cache', () => cache);
vi.mock('next/navigation', () => ({
  usePathname: () => '/timeline',
  useRouter: () => router,
}));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href: String(href), ...props }, children),
  };
});

const photo = (id: string): TimelinePhoto => ({
  id,
  fileName: `${id}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/${id}/thumbnail`,
  dimensions: { width: 1500, height: 1000 },
  effectiveDate: { value: '2004-08-01T00:00:00.000Z', precision: 'DAY' },
});

const RETURN = '/organizar?folder=abc';
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 60)));
/** Previews are requested after the scroll rests for a moment, then queued nearest-first. */
const settleLoads = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 500)));

describe('sky depths', () => {
  let container: HTMLDivElement;
  let root: Root;
  const travel = vi.fn();
  const mount = async (depth: React.ReactNode) => {
    await act(async () =>
      root.render(
        <SkyStage
          orientation="vertical"
          onOrientationChange={() => undefined}
          label="Línea de vida"
        >
          {depth}
        </SkyStage>,
      ),
    );
    await settle();
  };
  const links = () => [...container.querySelectorAll<HTMLAnchorElement>('a.sky-grp')];
  const railButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.sky-rail button')];

  beforeEach(() => {
    resetTravel();
    Object.values(cache).forEach((mock) => mock.mockReset());
    cache.getCachedTimelineYears.mockReturnValue(null);
    cache.getCachedYearSummary.mockReturnValue(null);
    cache.getCachedMonthPreviews.mockReturnValue(null);
    router.replace.mockClear();
    travel.mockClear();
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

  describe('years', () => {
    const years = {
      firstYear: 1998,
      lastYear: 2023,
      latestYear: 2023,
      items: [
        { year: 1998, photoCount: 12 },
        { year: 2000, photoCount: 0 },
        { year: 2004, photoCount: 1248 },
      ],
    };
    const depth = (
      <YearsDepth returnTo={RETURN} returnLabel="Verano" travel={travel} onLanded={vi.fn()} />
    );

    it('renders one named link per year with photos, oldest first, keeping the way back', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockImplementation(async (year: number) => ({
        year,
        total: year === 2004 ? 1248 : 12,
        months: [
          { month: 1, photoCount: 5 },
          { month: 2, photoCount: 0 },
          { month: 8, photoCount: 7 },
        ],
        unknownMonthCount: 0,
        previews: [photo(`p${year}a`), photo(`p${year}b`)],
      }));
      await mount(depth);

      expect(links().map((link) => link.getAttribute('aria-label'))).toEqual([
        'Entrar en 1998: 12 fotos',
        'Entrar en 2004: 1248 fotos',
      ]);
      const href = links()[1]!.getAttribute('href')!;
      expect(href.startsWith('/timeline/2004?')).toBe(true);
      expect(new URL(href, 'http://x').searchParams.get('returnTo')).toBe(RETURN);
      expect(new URL(href, 'http://x').searchParams.get('returnLabel')).toBe('Verano');
      expect(cache.loadYearSummary).not.toHaveBeenCalledWith(2000);
    });

    it('fills a year with its previews, month count and remaining photos once it is near', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockImplementation(async (year: number) => ({
        year,
        total: 1248,
        months: [
          { month: 1, photoCount: 5 },
          { month: 2, photoCount: 0 },
          { month: 8, photoCount: 7 },
        ],
        unknownMonthCount: 0,
        previews: [photo(`p${year}a`), photo(`p${year}b`)],
      }));
      await mount(depth);
      await settleLoads();

      const year2004 = links()[1]!;
      expect(year2004.querySelectorAll('img')).toHaveLength(2);
      expect(year2004.textContent).toContain('2 meses');
      expect(year2004.textContent).toContain('+1246 más');
      expect(year2004.querySelector('img')?.getAttribute('src')).toContain('width=640');
      expect(railButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
        'Ir a 1998',
        'Ir a 2004',
      ]);
    });

    it('waits for the scroll to rest before asking for previews, and ranks them for the centre', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockImplementation(async (year: number) => ({
        year,
        total: 12,
        months: [{ month: 1, photoCount: 5 }],
        unknownMonthCount: 0,
        previews: [photo(`p${year}a`)],
      }));
      await mount(depth);
      expect(cache.loadYearSummary).not.toHaveBeenCalled();

      await settleLoads();
      expect(cache.loadYearSummary).toHaveBeenCalledTimes(2);
      const image = links()[1]!.querySelector('img')!;
      expect(image.getAttribute('fetchpriority')).toBe('high');
    });

    it('asks again for the previews of near groups after the archive index changes', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockImplementation(async (year: number) => ({
        year,
        total: 12,
        months: [{ month: 1, photoCount: 5 }],
        unknownMonthCount: 0,
        previews: [photo(`p${year}a`)],
      }));
      await mount(depth);
      await settleLoads();
      expect(cache.loadYearSummary.mock.calls.map((call) => call[0])).toEqual([1998, 2004]);

      await act(async () => notifyArchiveIndexUpdated());
      await settleLoads();
      expect(cache.loadYearSummary.mock.calls.map((call) => call[0])).toEqual([
        1998, 2004, 1998, 2004,
      ]);
      expect(links()[0]!.querySelectorAll('img')).toHaveLength(1);
    });

    it('labels the slim rail with the short year so it reads without the month counts', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
      await mount(depth);

      expect(
        railButtons().map((button) => button.querySelector('.sky-short')?.textContent),
      ).toEqual(['’98', '’04']);
      expect(railButtons().every((button) => button.dataset.short === 'true')).toBe(true);
      expect(railButtons()[0]!.getAttribute('aria-label')).toBe('Ir a 1998');
    });

    it('shows stars, not photos, while a summary is still on its way', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
      await mount(depth);

      expect(links()).toHaveLength(2);
      expect(links()[0]!.querySelectorAll('img')).toHaveLength(0);
      expect(links()[0]!.querySelectorAll('.sky-tile[data-star="true"]').length).toBeGreaterThan(0);
    });

    it('keeps placeholder tiles visible at full size and shimmering until a photo arrives', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
      await mount(depth);

      const tiles = [...links()[0]!.querySelectorAll<HTMLElement>('.sky-tile[data-star="true"]')];
      expect(tiles.every((tile) => !tile.style.transform.includes('scale'))).toBe(true);
      expect(tiles.every((tile) => tile.dataset.loaded === undefined)).toBe(true);
    });

    it('stops the shimmer of a tile once its image loads or fails', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockImplementation(async (year: number) => ({
        year,
        total: 12,
        months: [{ month: 1, photoCount: 5 }],
        unknownMonthCount: 0,
        previews: [photo(`p${year}a`), photo(`p${year}b`)],
      }));
      await mount(depth);
      await settleLoads();

      const [first, second] = [...links()[0]!.querySelectorAll('img')];
      expect(first!.parentElement!.dataset.loaded).toBeUndefined();
      await act(async () => first!.dispatchEvent(new Event('load')));
      await act(async () => second!.dispatchEvent(new Event('error')));
      expect(first!.parentElement!.dataset.loaded).toBe('true');
      expect(second!.parentElement!.dataset.loaded).toBe('true');
    });

    it('shows a skeleton of constellations with a polite status while the years load', async () => {
      cache.loadTimelineYears.mockReturnValue(new Promise(() => undefined));
      await mount(depth);

      const skeleton = container.querySelector('.sky-skeleton');
      expect(skeleton?.getAttribute('aria-hidden')).toBe('true');
      expect(skeleton?.querySelectorAll('.sky-skel-grp').length).toBeGreaterThan(1);
      expect(skeleton?.querySelectorAll('.sky-skel-tile').length).toBeGreaterThan(4);
      const status = container.querySelector('[role="status"]');
      expect(status?.textContent).toBe('Cargando años…');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    it('travels in through the group instead of following the plain link', async () => {
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
      await mount(depth);

      const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      await act(async () => links()[1]!.dispatchEvent(click));
      expect(click.defaultPrevented).toBe(true);
      expect(travel).toHaveBeenCalledWith(
        links()[1]!.getAttribute('href'),
        'in',
        expect.anything(),
        null,
        expect.any(String),
      );
    });

    describe('touch taps', () => {
      const pointer = (type: string, x: number, y: number, at: number, pointerType = 'touch') => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        });
        Object.defineProperties(event, {
          pointerType: { value: pointerType },
          pointerId: { value: 1 },
          isPrimary: { value: true },
          timeStamp: { value: at },
        });
        return event;
      };
      const tap = async (link: HTMLElement, upAt: number, dx = 2) => {
        await act(async () => link.dispatchEvent(pointer('pointerdown', 10, 10, 1000)));
        await act(async () => link.dispatchEvent(pointer('pointerup', 10 + dx, 10, upAt)));
      };

      beforeEach(async () => {
        cache.loadTimelineYears.mockResolvedValue(years);
        cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
        await mount(depth);
      });

      it('enters on a short, still touch even without a click, and only once with its click', async () => {
        await tap(links()[1]!, 1120);
        expect(travel).toHaveBeenCalledOnce();

        await act(async () =>
          links()[1]!.dispatchEvent(
            Object.defineProperty(
              new MouseEvent('click', { bubbles: true, cancelable: true }),
              'timeStamp',
              { value: 1130 },
            ),
          ),
        );
        expect(travel).toHaveBeenCalledOnce();
      });

      it('treats a moving or slow touch as scrolling', async () => {
        await tap(links()[1]!, 1120, 40);
        await tap(links()[1]!, 1600);
        expect(travel).not.toHaveBeenCalled();
      });

      it('leaves mouse input to the click', async () => {
        await act(async () =>
          links()[1]!.dispatchEvent(pointer('pointerdown', 10, 10, 1000, 'mouse')),
        );
        await act(async () =>
          links()[1]!.dispatchEvent(pointer('pointerup', 10, 10, 1050, 'mouse')),
        );
        expect(travel).not.toHaveBeenCalled();
      });
    });

    it('explains an archive without dated photos and points to Ordenar', async () => {
      cache.loadTimelineYears.mockResolvedValue({ ...years, items: [] });
      await mount(depth);

      expect(container.textContent).toContain('Tu archivo todavía no tiene fechas disponibles.');
      const hrefs = [...container.querySelectorAll('.sky-state a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(hrefs).toEqual(['/ordenar', '/ordenar?pile=undated']);
    });

    it('reports a failure as an alert and retries', async () => {
      cache.loadTimelineYears.mockRejectedValueOnce(new Error('offline'));
      await mount(depth);

      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'No se pudieron cargar',
      );
      cache.loadTimelineYears.mockResolvedValue(years);
      cache.loadYearSummary.mockReturnValue(new Promise(() => undefined));
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
      );
      await settle();
      expect(links()).toHaveLength(2);
    });
  });

  describe('year', () => {
    const previews = {
      year: 2004,
      items: [
        { month: 3, kind: 'MONTH', label: null, photoCount: 40, previews: [photo('m3')] },
        {
          month: 8,
          kind: 'MONTH',
          label: null,
          photoCount: 312,
          previews: [photo('m8a'), photo('m8b')],
        },
        {
          month: null,
          kind: 'YEAR',
          label: 'Fecha sin concretar',
          photoCount: 1,
          previews: [photo('u')],
        },
      ],
    };
    const depth = (
      <YearDepth
        year={2004}
        returnTo={RETURN}
        returnLabel={null}
        travel={travel}
        onLanded={vi.fn()}
      />
    );

    it('draws a constellation per month plus the undated group, with a header and counts', async () => {
      cache.loadMonthPreviews.mockResolvedValue(previews);
      await mount(depth);

      expect(links().map((link) => link.getAttribute('aria-label'))).toEqual([
        'Ver Marzo: 40 fotos',
        'Ver Agosto: 312 fotos',
        'Ver las fotos de 2004 sin mes: 1 foto',
      ]);
      const hrefs = links().map((link) => new URL(link.getAttribute('href')!, 'http://x'));
      expect(hrefs.map((url) => url.pathname)).toEqual([
        '/timeline/2004/3',
        '/timeline/2004/8',
        '/timeline/2004/sin-mes',
      ]);
      hrefs.forEach((url) => expect(url.searchParams.get('returnTo')).toBe(RETURN));
      expect(container.querySelector('h1')?.textContent).toBe('2004');
      expect(container.querySelector('.sky-head p')?.textContent).toBe(
        '353 fotos · 2 meses con fotos',
      );
      expect(links()[2]!.getAttribute('data-undated')).toBe('true');
      expect(links()[1]!.textContent).toContain('+310 más');
    });

    it('lists twelve months and the undated group in the rail, disabling empty months', async () => {
      cache.loadMonthPreviews.mockResolvedValue(previews);
      await mount(depth);

      const buttons = railButtons();
      expect(buttons).toHaveLength(13);
      const enabled = buttons
        .filter((button) => !button.disabled)
        .map((b) => b.getAttribute('aria-label'));
      expect(enabled).toEqual(['Ir a marzo', 'Ir a agosto', 'Ir a las fotos sin mes']);
      expect(buttons[0]!.disabled).toBe(true);
      expect(buttons[0]!.getAttribute('aria-label')).toBe('Enero: sin fotos');
      expect(buttons.at(-1)!.textContent).toContain('S/M');
    });

    it('sends people back to the years when the year has no photos', async () => {
      cache.loadMonthPreviews.mockResolvedValue({ year: 2004, items: [] });
      await mount(depth);

      expect(router.replace).toHaveBeenCalledWith(
        `/timeline?returnTo=${encodeURIComponent(RETURN)}`,
        { scroll: false },
      );
    });

    it('reports a failure as an alert and retries', async () => {
      cache.loadMonthPreviews.mockRejectedValueOnce(new Error('offline'));
      await mount(depth);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();

      cache.loadMonthPreviews.mockResolvedValue(previews);
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click(),
      );
      await settle();
      expect(links()).toHaveLength(3);
    });
  });
});
