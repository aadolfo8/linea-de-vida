/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TemporalCarousel } from './TemporalCarousel';
import { TimelinePhotoViewer } from './TimelinePhotoViewer';
import type { TimelinePhoto } from './timeline-model';

const embla = vi.hoisted(() => ({
  reduceMotion: false,
  options: [] as Array<Record<string, unknown>>,
  api: {
    selectedScrollSnap: vi.fn(() => 0),
    canScrollPrev: vi.fn(() => true),
    canScrollNext: vi.fn(() => true),
    on: vi.fn(),
    off: vi.fn(),
    scrollTo: vi.fn(),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
  },
}));

vi.mock('embla-carousel-react', () => ({
  default: (options: Record<string, unknown>) => {
    embla.options.push(options);
    return [() => undefined, embla.api];
  },
}));

vi.mock('motion/react', async () => {
  const React = await import('react');
  const motionComponent = (tag: 'button' | 'span') =>
    React.forwardRef<HTMLElement, Record<string, unknown>>(function MotionComponent(props, ref) {
      const elementProps = { ...props };
      delete elementProps.animate;
      delete elementProps.layoutId;
      delete elementProps.transition;
      return React.createElement(tag, { ...elementProps, ref });
    });
  return {
    LayoutGroup: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      button: motionComponent('button'),
      span: motionComponent('span'),
    },
    useReducedMotion: () => embla.reduceMotion,
  };
});

const photos: TimelinePhoto[] = [
  {
    id: 'photo-1',
    fileName: 'First photo.jpg',
    mimeType: 'image/jpeg',
    thumbnailUrl: '/v1/photos/photo-1/thumbnail',
    effectiveDate: { value: '2026-01-01T00:00:00.000Z', precision: 'DAY' },
  },
  {
    id: 'photo-2',
    fileName: 'Second photo.jpg',
    mimeType: 'image/jpeg',
    thumbnailUrl: '/v1/photos/photo-2/thumbnail',
    effectiveDate: { value: '2026-01-02T00:00:00.000Z', precision: 'DAY' },
  },
];

describe('TimelinePhotoViewer effects', () => {
  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let returnTarget: HTMLButtonElement;
  let root: Root | null;

  beforeEach(() => {
    embla.reduceMotion = false;
    embla.options = [];
    Object.values(embla.api).forEach((mock) => mock.mockClear());
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
  });

  it('contains focus and restores background, body, and prior focus on close', async () => {
    await act(async () =>
      root?.render(<TimelinePhotoViewer photos={photos} initialIndex={0} onClose={vi.fn()} />),
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button')];
    expect(document.body.style.overflow).toBe('hidden');
    expect(returnTarget.inert).toBe(true);
    expect(returnTarget.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0].className).toContain('min-w-11');
    expect(buttons[0].className).toContain('min-h-11');

    buttons.at(-1)!.focus();
    buttons.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    buttons[0].focus();
    buttons[0].dispatchEvent(
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

  it('keeps drag available while removing transition duration under reduced motion', async () => {
    embla.reduceMotion = true;
    await act(async () =>
      root?.render(<TimelinePhotoViewer photos={photos} initialIndex={0} onClose={vi.fn()} />),
    );

    expect(embla.options.at(-1)).toMatchObject({ loop: false, duration: 0, watchDrag: true });
    const next = container.querySelector<HTMLButtonElement>('[aria-label="Foto siguiente"]')!;
    next.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(embla.api.scrollNext).toHaveBeenCalledWith(true);
  });

  it('shows HEIC through its thumbnail and offers the original download', async () => {
    const heicPhoto = { ...photos[0], mimeType: 'image/heic', fileName: 'Memory.heic' };
    await act(async () =>
      root?.render(<TimelinePhotoViewer photos={[heicPhoto]} initialIndex={0} onClose={vi.fn()} />),
    );

    expect(container.querySelector('img')?.getAttribute('src')).toContain('/thumbnail');
    expect(container.querySelector<HTMLAnchorElement>('footer a')?.getAttribute('href')).toContain(
      '/content',
    );
    expect(container.textContent).toContain('Descargar original');
    expect(container.textContent).toContain('1 de enero de 2026');
  });

  it('opens the selected photo at original quality while preserving a preview underneath', async () => {
    await act(async () =>
      root?.render(<TimelinePhotoViewer photos={photos} initialIndex={0} onClose={vi.fn()} />),
    );

    const images = [...container.querySelectorAll<HTMLImageElement>('img')];
    expect(images.some((image) => image.getAttribute('src')?.includes('/photo-1/content'))).toBe(
      true,
    );
    expect(images.some((image) => image.getAttribute('src')?.includes('/photo-1/thumbnail'))).toBe(
      true,
    );
    expect(images.some((image) => image.getAttribute('src')?.includes('/photo-2/thumbnail'))).toBe(
      true,
    );
    expect(
      images
        .find((image) => image.getAttribute('src')?.includes('/photo-2/thumbnail'))
        ?.getAttribute('src'),
    ).toContain('width=1280');
    expect(
      [...container.querySelectorAll('button')].some((item) =>
        item.textContent?.includes('Ver original'),
      ),
    ).toBe(false);
  });

  it('falls back from a failed original to its thumbnail and offers a bounded retry', async () => {
    await act(async () =>
      root?.render(<TimelinePhotoViewer photos={photos} initialIndex={0} onClose={vi.fn()} />),
    );

    const original = [...container.querySelectorAll<HTMLImageElement>('img')].find((image) =>
      image.getAttribute('src')?.includes('/photo-1/content'),
    )!;
    await act(async () => original.dispatchEvent(new Event('error')));
    expect(
      [...container.querySelectorAll<HTMLImageElement>('img')].some((image) =>
        image.getAttribute('src')?.includes('/photo-1/thumbnail'),
      ),
    ).toBe(true);

    const preview = [...container.querySelectorAll<HTMLImageElement>('img')].find((image) =>
      image.getAttribute('src')?.includes('/photo-1/thumbnail'),
    )!;
    await act(async () => preview.dispatchEvent(new Event('load')));
    expect(container.textContent).toContain(
      'El original no se pudo cargar; se muestra la miniatura.',
    );
    await act(async () => preview.dispatchEvent(new Event('error')));
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
    await act(async () =>
      root?.render(
        <TimelinePhotoViewer photos={[photos[0]!]} initialIndex={0} onClose={vi.fn()} />,
      ),
    );

    expect(embla.options.at(-1)).toMatchObject({ loop: false });
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Foto anterior"]')?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Foto siguiente"]')?.disabled,
    ).toBe(true);
    container
      .querySelector('[role="dialog"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(embla.api.scrollNext).not.toHaveBeenCalled();
  });

  it('loads the next gallery page at the end and then advances without wrapping', async () => {
    const nextPhoto = { ...photos[0], id: 'photo-3', fileName: 'Third photo.jpg' };
    const loadMore = vi.fn().mockResolvedValue({ items: [nextPhoto], nextCursor: null });
    await act(async () =>
      root?.render(
        <TimelinePhotoViewer
          photos={photos}
          initialIndex={1}
          loadMore={loadMore}
          onClose={vi.fn()}
        />,
      ),
    );

    await act(async () => button('Cargar siguientes fotografías').click());
    expect(loadMore).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('2 de 3');

    await act(async () => button('Foto siguiente').click());
    expect(embla.api.scrollNext).toHaveBeenCalledWith(false);
  });

  function button(label: string) {
    const match = [...container.querySelectorAll('button')].find(
      (element) =>
        element.textContent?.includes(label) || element.getAttribute('aria-label')?.includes(label),
    );
    if (!match) throw new Error(`Button not found: ${label}`);
    return match;
  }

  it('renders carousel arrows with a 44px minimum target', async () => {
    await act(async () =>
      root?.render(
        <TemporalCarousel
          items={[
            { key: '2025', primary: '2025', secondary: '2 fotos', ariaLabel: '2025' },
            { key: '2026', primary: '2026', secondary: '4 fotos', ariaLabel: '2026' },
          ]}
          selectedKey="2026"
          label="Años"
          variant="year"
          onTransientSelect={vi.fn()}
          onSettle={vi.fn()}
        />,
      ),
    );

    const arrows = [
      container.querySelector<HTMLButtonElement>('[aria-label="Ir al año anterior"]')!,
      container.querySelector<HTMLButtonElement>('[aria-label="Ir al año siguiente"]')!,
    ];
    arrows.forEach((arrow) => {
      expect(arrow.className).toContain('min-w-11');
      expect(arrow.className).toContain('min-h-11');
    });
  });
});
