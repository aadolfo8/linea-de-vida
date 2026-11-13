/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelinePhotoViewer, type ViewerSource } from './TimelinePhotoViewer';
import type { TimelinePhoto } from './timeline-model';
import { fitSize } from './viewer-zoom';

const env = vi.hoisted(() => ({ reduceMotion: false }));

vi.mock('../../lib/use-reduced-motion', () => ({ useReducedMotion: () => env.reduceMotion }));

const photo = (
  number: number,
  extra: Partial<TimelinePhoto> = {},
  precision: TimelinePhoto['effectiveDate']['precision'] = 'DAY',
): TimelinePhoto => ({
  id: `photo-${number}`,
  fileName: `Photo ${number}.jpg`,
  mimeType: 'image/jpeg',
  thumbnailUrl: `/v1/photos/photo-${number}/thumbnail`,
  dimensions: { width: 1500, height: 1000 },
  effectiveDate: { value: `2026-01-0${number}T00:00:00.000Z`, precision },
  ...extra,
});
const photos = [photo(1), photo(2), photo(3)];

describe('TimelinePhotoViewer effects', () => {
  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let returnTarget: HTMLButtonElement;
  let root: Root | null;
  let preloaded: string[];

  beforeEach(() => {
    env.reduceMotion = false;
    document.body.innerHTML = '';
    document.body.style.overflow = 'auto';
    document.body.style.paddingRight = '7px';
    host = document.createElement('div');
    returnTarget = document.createElement('button');
    returnTarget.textContent = 'Open viewer';
    container = document.createElement('div');
    host.append(returnTarget, container);
    document.body.append(host);
    returnTarget.focus();
    root = createRoot(container);
    preloaded = [];
    vi.stubGlobal(
      'Image',
      class {
        decoding = '';
        set src(value: string) {
          preloaded.push(value);
        }
      },
    );
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    host.remove();
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  const render = (props: Partial<React.ComponentProps<typeof TimelinePhotoViewer>> = {}) =>
    act(async () =>
      root?.render(
        <TimelinePhotoViewer photos={photos} initialIndex={0} onClose={vi.fn()} {...props} />,
      ),
    );
  const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')!;
  const stage = () => container.querySelector<HTMLElement>('.pv-stage')!;
  const frame = () => container.querySelector<HTMLElement>('.pv-frame')!;
  const zoomLabel = () => container.querySelector('.pv-zoom')?.textContent;
  const counter = () => container.querySelector('.pv-count')?.textContent;
  const press = (key: string, init: KeyboardEventInit = {}) =>
    act(async () => {
      dialog().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );
    });
  const wheel = (init: WheelEventInit) =>
    act(async () => {
      stage().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }));
    });
  const pointer = (type: string, init: PointerEventInit & { target?: Element } = {}) => {
    const { target, ...rest } = init;
    return act(async () => {
      (target ?? stage()).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'touch',
          ...rest,
        }),
      );
    });
  };
  const drag = async (from: [number, number], to: [number, number], pointerId = 1) => {
    await pointer('pointerdown', { clientX: from[0], clientY: from[1], pointerId });
    await pointer('pointermove', { clientX: to[0], clientY: to[1], pointerId });
    await pointer('pointerup', { clientX: to[0], clientY: to[1], pointerId });
  };
  const translation = () => {
    const match = /translate3d\((-?[\d.]+)px, ?(-?[\d.]+)px/.exec(frame().style.transform);
    return { x: Number(match?.[1]), y: Number(match?.[2]) };
  };
  function button(label: string) {
    const match = [...container.querySelectorAll('button')].find(
      (element) =>
        element.textContent?.includes(label) || element.getAttribute('aria-label')?.includes(label),
    );
    if (!match) throw new Error(`Button not found: ${label}`);
    return match;
  }

  it('reports the photo on display when it changes, but not the one it opened on', async () => {
    const onPhotoChange = vi.fn();
    await render({ onPhotoChange });
    expect(onPhotoChange).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Foto siguiente"]')!.click();
    });
    expect(onPhotoChange).toHaveBeenCalledExactlyOnceWith('photo-2');
  });

  it('keeps the stage band between the meta block and the filmstrip when they are measured', async () => {
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, left: 0, right: 1024, width: 1024, height: bottom - top }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('pv-meta')) return rect(18, 96);
        if (this.classList.contains('pv-tools')) return rect(18, 62);
        if (this.classList.contains('pv-strip')) return rect(660, 768);
        return rect(0, 0);
      },
    );
    await render();

    const style = stage().style;
    expect(Number.parseFloat(style.top)).toBe(104);
    // The strip starts at 660 with no padding in jsdom; the band ends 10px above it.
    expect(Number.parseFloat(style.height)).toBe(660 - 10 - 104);
    vi.restoreAllMocks();
  });
  it('contains focus and restores background, body, and prior focus on close', async () => {
    await render();

    const buttons = [...dialog().querySelectorAll<HTMLButtonElement>('button')].filter(
      (element) => element.tabIndex >= 0 && !element.disabled,
    );
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Vista ampliada de Photo 1.jpg');
    expect(document.body.style.overflow).toBe('hidden');
    expect(returnTarget.inert).toBe(true);
    expect(returnTarget.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(button('Cerrar visor'));
    ['Alejar', 'Acercar', 'Cerrar visor', 'Foto siguiente'].forEach((label) => {
      const style = window.getComputedStyle(button(label));
      expect(style.minWidth, label).toBe('44px');
      expect(style.minHeight, label).toBe('44px');
    });

    buttons.at(-1)!.focus();
    buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0]!.focus();
    buttons[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons.at(-1));

    await act(async () => root?.unmount());
    root = null;
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.paddingRight).toBe('7px');
    expect(returnTarget.inert).toBeFalsy();
    expect(returnTarget.hasAttribute('aria-hidden')).toBe(false);
    expect(document.activeElement).toBe(returnTarget);
  });

  it('keeps the filmstrip out of the tab order except for the current photo', async () => {
    await render({ initialIndex: 1 });

    const items = [
      ...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Fotos"] button'),
    ];
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('shows HEIC through its thumbnail and offers the original download', async () => {
    const heicPhoto = photo(1, { mimeType: 'image/heic', fileName: 'Memory.heic' });
    await render({ photos: [heicPhoto] });

    expect(container.querySelector('.pv-img')?.getAttribute('src')).toContain('/thumbnail');
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="/content"]')?.getAttribute('href'),
    ).toContain('/photo-1/content');
    expect(container.textContent).toContain('Descargar original');
    expect(container.textContent).toContain('1 de enero de 2026');
  });

  it('opens the selected photo at original quality while preserving a preview underneath', async () => {
    await render();

    const images = [...container.querySelectorAll<HTMLImageElement>('.pv-frame img')];
    expect(images.some((image) => image.getAttribute('src')?.includes('/photo-1/content'))).toBe(
      true,
    );
    expect(images.some((image) => image.getAttribute('src')?.includes('/photo-1/thumbnail'))).toBe(
      true,
    );
    expect(
      [...container.querySelectorAll('button')].some((item) =>
        item.textContent?.includes('Ver original'),
      ),
    ).toBe(false);
  });

  it('makes the original the displayed source once it has loaded', async () => {
    await render();

    const original = container.querySelector<HTMLImageElement>('.pv-img[data-source="original"]')!;
    expect(original.getAttribute('data-ready')).toBe('false');
    await act(async () => original.dispatchEvent(new Event('load')));
    expect(original.getAttribute('data-ready')).toBe('true');
    expect(container.querySelector('.pv-under')).toBeNull();
    expect(container.querySelector('.pv-img')?.getAttribute('src')).toContain('/photo-1/content');
  });

  it('falls back from a failed original to its thumbnail and offers a bounded retry', async () => {
    await render();

    const original = [...container.querySelectorAll<HTMLImageElement>('img')].find((image) =>
      image.getAttribute('src')?.includes('/photo-1/content'),
    )!;
    await act(async () => original.dispatchEvent(new Event('error')));
    expect(
      [...container.querySelectorAll<HTMLImageElement>('img')].some((image) =>
        image.getAttribute('src')?.includes('/photo-1/thumbnail'),
      ),
    ).toBe(true);

    const preview = container.querySelector<HTMLImageElement>('.pv-img')!;
    await act(async () => preview.dispatchEvent(new Event('load')));
    expect(container.textContent).toContain(
      'El original no se pudo cargar; se muestra la miniatura.',
    );
    await act(async () =>
      container.querySelector<HTMLImageElement>('.pv-img')!.dispatchEvent(new Event('error')),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo cargar la fotografía.',
    );
    await act(async () => button('Reintentar miniatura').click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Cargando fotografía',
    );
  });

  it('does not wrap navigation at the edges of the loaded photos', async () => {
    await render({ photos: [photos[0]!] });

    expect(button('Foto anterior').hasAttribute('disabled')).toBe(true);
    expect(button('Foto siguiente').hasAttribute('disabled')).toBe(true);
    await press('ArrowRight');
    await press('ArrowLeft');
    expect(counter()).toBe('1 / 1');

    await render({ photos });
    await press('ArrowLeft');
    expect(counter()).toBe('1 / 3');
    await press('ArrowRight');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(counter()).toBe('3 / 3');
    expect(dialog().getAttribute('aria-label')).toBe('Vista ampliada de Photo 3.jpg');
  });

  it('anticipates the next gallery page near the end and then advances without wrapping', async () => {
    const nextPhoto = photo(4, { fileName: 'Fourth photo.jpg' });
    const loadMore = vi.fn().mockResolvedValue({ items: [nextPhoto], nextCursor: null });
    await render({ photos: photos.slice(0, 2), initialIndex: 1, loadMore });

    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(counter()).toBe('2 / 3');

    await act(async () => button('Foto siguiente').click());
    expect(counter()).toBe('3 / 3');
    expect(dialog().getAttribute('aria-label')).toBe('Vista ampliada de Fourth photo.jpg');
    expect(button('Foto siguiente').hasAttribute('disabled')).toBe(true);
  });

  it('stops offering a next photo when the caller has nothing more to load', async () => {
    const loadMore = vi.fn().mockResolvedValue({ items: [], nextCursor: 'more' });
    await render({ photos, initialIndex: 2, loadMore });
    expect(button('Foto siguiente').hasAttribute('disabled')).toBe(false);

    // The month paged to its end on its own: the viewer is handed no way to load more.
    await render({ photos, initialIndex: 2, loadMore: undefined });
    expect(button('Foto siguiente').hasAttribute('disabled')).toBe(true);
  });

  it('drops a waiting advance when the end is reached, instead of jumping later', async () => {
    const loadMore = vi.fn().mockReturnValue(new Promise(() => undefined));
    await render({ photos, initialIndex: 2, loadMore });
    await act(async () => button('Foto siguiente').click());
    expect(counter()).toBe('3 / 3');

    await render({ photos, initialIndex: 2, loadMore: undefined });
    const later = photo(4, { fileName: 'Fourth photo.jpg' });
    await render({ photos: [...photos, later], initialIndex: 2, loadMore: undefined });
    expect(counter()).toBe('3 / 4');
  });

  describe('meta', () => {
    it('states the date precision honestly and counts against the known total', async () => {
      await render({
        photos: [photo(1), photo(2, {}, 'MONTH'), photo(3, {}, 'YEAR')],
        total: 214,
      });

      expect(container.querySelector('.pv-date')?.textContent).toBe('1 de enero de 2026');
      expect(container.querySelector('.pv-chip')?.textContent).toBe('Día exacto');
      expect(counter()).toBe('1 / 214');
      await press('ArrowRight');
      expect(container.querySelector('.pv-date')?.textContent).toBe('enero de 2026');
      expect(container.querySelector('.pv-chip')?.textContent).toBe('Día sin concretar');
      await press('ArrowRight');
      expect(container.querySelector('.pv-chip')?.textContent).toBe('Mes sin concretar');
    });
  });

  describe('zoom', () => {
    it('zooms with the wheel around the pointer and with ctrl+wheel for a pinch', async () => {
      await render();

      await wheel({ deltaY: -400, clientX: 700, clientY: 300 });
      const afterWheel = Number.parseInt(zoomLabel()!, 10);
      expect(afterWheel).toBeGreaterThan(100);
      // The pointer is right of and above the centre: that point stays put, so the photo
      // moves left and down.
      expect(translation().x).toBeLessThan(0);
      expect(translation().y).toBeGreaterThan(0);

      await wheel({ deltaY: -40, ctrlKey: true, clientX: 700, clientY: 300 });
      expect(Number.parseInt(zoomLabel()!, 10)).toBeGreaterThan(afterWheel);
      await wheel({ deltaY: -100000, clientX: 700, clientY: 300 });
      expect(zoomLabel()).toBe('600%');
    });

    it('toggles between fit and 2.5x on double click, at the clicked point', async () => {
      await render();

      await act(async () => {
        stage().dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 800, clientY: 400 }),
        );
      });
      expect(zoomLabel()).toBe('250%');
      expect(translation().x).toBeLessThan(0);
      await act(async () => {
        stage().dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, clientX: 800, clientY: 400 }),
        );
      });
      expect(zoomLabel()).toBe('100%');
      expect(translation()).toEqual({ x: 0, y: 0 });
    });

    it('zooms with + − 0 and with the buttons, showing a live percentage', async () => {
      await render();

      await press('+');
      expect(zoomLabel()).toBe('140%');
      await press('=');
      expect(zoomLabel()).toBe('196%');
      await press('-');
      expect(zoomLabel()).toBe('140%');
      await press('0');
      expect(zoomLabel()).toBe('100%');
      expect(button('Alejar').hasAttribute('disabled')).toBe(true);

      await act(async () => button('Acercar').click());
      expect(zoomLabel()).toBe('160%');
      await act(async () => button('Alejar').click());
      expect(zoomLabel()).toBe('100%');
    });

    it('resets the zoom first on Escape and only then closes', async () => {
      const onClose = vi.fn();
      await render({ onClose });

      await press('+');
      await press('Escape');
      expect(zoomLabel()).toBe('100%');
      expect(onClose).not.toHaveBeenCalled();
      await press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('starts every photo at fit', async () => {
      await render();

      await press('+');
      expect(zoomLabel()).toBe('140%');
      await act(async () => button('Foto siguiente').click());
      expect(counter()).toBe('2 / 3');
      expect(zoomLabel()).toBe('100%');
      expect(translation()).toEqual({ x: 0, y: 0 });

      await act(async () => button('Acercar').click());
      await act(async () =>
        container.querySelector<HTMLButtonElement>('nav[aria-label="Fotos"] button')!.click(),
      );
      expect(counter()).toBe('1 / 3');
      expect(zoomLabel()).toBe('100%');
    });

    it('pans a zoomed photo with the arrows and stops at its edges', async () => {
      await render();

      await press('+');
      await press('+');
      await press('+');
      const before = translation().x;
      await press('ArrowLeft');
      expect(counter()).toBe('1 / 3');
      expect(translation().x).toBe(before + 80);

      for (let step = 0; step < 40; step += 1) await press('ArrowLeft');
      const limit = translation().x;
      // At 1.4^3 the photo overflows the 1024px stage by half the difference on each side.
      const fitted = fitSize({ width: 1500, height: 1000 }, { width: 1024, height: 768 });
      expect(limit).toBeCloseTo((fitted.width * 1.4 ** 3 - 1024) / 2, 0);
      await press('ArrowLeft');
      expect(translation().x).toBe(limit);

      for (let step = 0; step < 40; step += 1) await press('ArrowRight');
      expect(translation().x).toBeCloseTo(-limit, 0);
      expect(counter()).toBe('1 / 3');
    });

    it('pans by dragging when zoomed instead of swiping to another photo', async () => {
      await render();

      await press('+');
      await press('+');
      await drag([500, 300], [440, 280]);
      expect(counter()).toBe('1 / 3');
      expect(translation().x).toBeCloseTo(-60, 0);
      expect(translation().y).toBeCloseTo(-20, 0);
    });

    it('zooms with a two-finger pinch', async () => {
      await render();

      await pointer('pointerdown', { clientX: 450, clientY: 384, pointerId: 1 });
      await pointer('pointerdown', { clientX: 550, clientY: 384, pointerId: 2 });
      await pointer('pointermove', { clientX: 350, clientY: 384, pointerId: 1 });
      await pointer('pointermove', { clientX: 650, clientY: 384, pointerId: 2 });
      expect(Number.parseInt(zoomLabel()!, 10)).toBe(300);
      await pointer('pointerup', { clientX: 350, clientY: 384, pointerId: 1 });
      await pointer('pointerup', { clientX: 650, clientY: 384, pointerId: 2 });
      expect(counter()).toBe('1 / 3');
    });

    it('zooms on a double tap with touch', async () => {
      await render();

      const tap = async () => {
        await pointer('pointerdown', { clientX: 600, clientY: 300 });
        await pointer('pointerup', { clientX: 600, clientY: 300 });
      };
      await tap();
      expect(zoomLabel()).toBe('100%');
      await tap();
      expect(zoomLabel()).toBe('250%');
    });
  });

  describe('swipe', () => {
    it('changes photo with a horizontal swipe and ignores short ones', async () => {
      await render({ initialIndex: 1 });

      await drag([500, 300], [450, 300]);
      expect(counter()).toBe('2 / 3');
      await drag([500, 300], [380, 300]);
      expect(counter()).toBe('3 / 3');
      await drag([500, 300], [640, 300]);
      expect(counter()).toBe('2 / 3');
    });

    it('does not swipe past the first or last photo', async () => {
      await render();

      await drag([500, 300], [640, 300]);
      expect(counter()).toBe('1 / 3');
    });

    it('closes with a swipe down while fit, and stays open for a short one', async () => {
      const onClose = vi.fn();
      await render({ onClose });

      await drag([500, 300], [500, 360]);
      expect(onClose).not.toHaveBeenCalled();
      await drag([500, 300], [510, 460]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('filmstrip', () => {
    it('marks the current photo and selects another when pressed', async () => {
      await render({ initialIndex: 1 });

      const items = () => [
        ...container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Fotos"] button'),
      ];
      expect(items()).toHaveLength(3);
      expect(items().map((item) => item.getAttribute('aria-current'))).toEqual([
        null,
        'true',
        null,
      ]);
      expect(items()[0]!.querySelector('img')?.getAttribute('src')).toContain('width=640');

      await act(async () => items()[2]!.click());
      expect(items().map((item) => item.getAttribute('aria-current'))).toEqual([
        null,
        null,
        'true',
      ]);
      expect(counter()).toBe('3 / 3');
    });

    it('scrolls the current photo into view', async () => {
      const scrollTo = vi.fn();
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
        configurable: true,
        value: scrollTo,
      });
      try {
        await render();
        await act(async () => button('Foto siguiente').click());
        expect(scrollTo).toHaveBeenCalled();
      } finally {
        delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
      }
    });
  });

  describe('chrome', () => {
    it('fades after a still moment and comes back with activity', async () => {
      vi.useFakeTimers();
      await render();
      const root = () => container.querySelector<HTMLElement>('.pv')!;

      expect(root().getAttribute('data-idle')).toBe('false');
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });
      expect(root().getAttribute('data-idle')).toBe('true');

      await pointer('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse' });
      expect(root().getAttribute('data-idle')).toBe('false');
      await act(async () => {
        vi.advanceTimersByTime(2700);
      });
      expect(root().getAttribute('data-idle')).toBe('true');
      await press('ArrowRight');
      expect(root().getAttribute('data-idle')).toBe('false');
    });

    it('never fades while a control has focus from the keyboard', async () => {
      vi.useFakeTimers();
      await render();
      const root = () => container.querySelector<HTMLElement>('.pv')!;

      button('Acercar').focus();
      await press('Tab');
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(root().getAttribute('data-idle')).toBe('false');
    });
  });

  describe('motion', () => {
    it('grows from the tile and shrinks back to it, then hands focus to that tile', async () => {
      const animate = vi.fn(() => ({ finished: Promise.resolve() }));
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const tile = document.createElement('button');
      document.body.append(tile);
      const rect = { left: 100, top: 60, right: 300, bottom: 190, width: 200, height: 130 };
      const source: ViewerSource = {
        rectOf: vi.fn(() => rect),
        focusTile: vi.fn(() => {
          tile.focus();
          return true;
        }),
      };
      const onClose = vi.fn();
      await render({ source, onClose });

      expect(source.rectOf).toHaveBeenCalledWith('photo-1');
      expect(animate).toHaveBeenCalledTimes(1);
      const opening = (animate.mock.calls[0] as unknown as [Keyframe[]])[0]!;
      expect(String(opening[0]!.transform)).toMatch(/scale\(0\.\d+\)/);
      expect(opening[1]!.transform).toContain('scale(1)');

      await press('Escape');
      await act(async () => undefined);
      expect(animate).toHaveBeenCalledTimes(2);
      expect(container.querySelector('.pv')?.getAttribute('data-closing')).toBe('true');
      expect(onClose).toHaveBeenCalledTimes(1);

      await act(async () => root?.unmount());
      root = null;
      expect(source.focusTile).toHaveBeenCalledWith('photo-1');
      expect(document.activeElement).toBe(tile);
      tile.remove();
    });

    it('closes without flying when the tile is not on screen', async () => {
      const animate = vi.fn(() => ({ finished: Promise.resolve() }));
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const onClose = vi.fn();
      await render({ source: { rectOf: () => null }, onClose });

      expect(animate).not.toHaveBeenCalled();
      await press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(animate).not.toHaveBeenCalled();
    });

    it('respects reduced motion: no flight, no slide, immediate close', async () => {
      env.reduceMotion = true;
      const animate = vi.fn(() => ({ finished: Promise.resolve() }));
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const rect = { left: 100, top: 60, right: 300, bottom: 190, width: 200, height: 130 };
      const onClose = vi.fn();
      await render({ source: { rectOf: () => rect }, onClose });

      await press('ArrowRight');
      expect(animate).not.toHaveBeenCalled();
      await press('Escape');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(animate).not.toHaveBeenCalled();
    });
  });

  it('preloads the originals and previews of the neighbours', async () => {
    await render({ initialIndex: 1 });

    expect(preloaded.some((url) => url.includes('/photo-3/content'))).toBe(true);
    expect(preloaded.some((url) => url.includes('/photo-1/content'))).toBe(true);
    expect(
      preloaded.some((url) => url.includes('/photo-3/thumbnail') && url.includes('width=1280')),
    ).toBe(true);
    expect(preloaded.some((url) => url.includes('/photo-2/'))).toBe(false);
  });
});
