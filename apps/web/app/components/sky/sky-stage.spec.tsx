/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkyChrome } from './SkyChrome';
import { SkyRail } from './SkyRail';
import { SkyStage, useSky, useSkyItem } from './SkyStage';

vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href: String(href), ...props }, children),
  };
});

function Star({ itemKey }: { itemKey: string }) {
  const { ref } = useSkyItem<HTMLDivElement>(itemKey);
  return <div ref={ref} data-star={itemKey} />;
}

function Probe({ onEngine }: { onEngine: (engine: ReturnType<typeof useSky>['engine']) => void }) {
  onEngine(useSky().engine);
  return null;
}

describe('sky stage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('renders a labelled stage with the travel axis and registers items by key', async () => {
    let engine: ReturnType<typeof useSky>['engine'] | undefined;
    await act(async () =>
      root.render(
        <SkyStage
          orientation="horizontal"
          onOrientationChange={() => undefined}
          label="Línea de vida"
        >
          <Star itemKey="2004" />
          <Probe onEngine={(value) => (engine = value)} />
        </SkyStage>,
      ),
    );

    const stage = container.querySelector<HTMLElement>('.sky');
    expect(stage?.dataset.orientation).toBe('horizontal');
    expect(container.querySelector('main')?.getAttribute('aria-label')).toBe('Línea de vida');
    expect(container.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true');
    expect(engine?.itemByKey('2004')?.el.dataset.star).toBe('2004');
    expect(engine?.itemByKey('1999')).toBeNull();
  });

  it('forgets items that unmount', async () => {
    let engine: ReturnType<typeof useSky>['engine'] | undefined;
    const render = (withStar: boolean) =>
      root.render(
        <SkyStage
          orientation="vertical"
          onOrientationChange={() => undefined}
          label="Línea de vida"
        >
          {withStar && <Star itemKey="2004" />}
          <Probe onEngine={(value) => (engine = value)} />
        </SkyStage>,
      );
    await act(async () => render(true));
    expect(engine?.itemByKey('2004')).not.toBeNull();
    await act(async () => render(false));
    expect(engine?.itemByKey('2004')).toBeNull();
  });

  it('jumps the rail to a registered item and marks the current entry', async () => {
    await act(async () =>
      root.render(
        <SkyStage
          orientation="vertical"
          onOrientationChange={() => undefined}
          label="Línea de vida"
          overlay={
            <SkyRail
              entries={[
                { key: '1', label: 'ENE', small: '4', aria: 'Ir a enero' },
                { key: '2', label: 'FEB', aria: 'Febrero: sin fotos', disabled: true },
                { key: '3', label: 'MAR', small: '9', aria: 'Ir a marzo' },
              ]}
            />
          }
        >
          <Star itemKey="1" />
          <Star itemKey="3" />
        </SkyStage>,
      ),
    );
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.sky-rail button')];
    expect(buttons.map((button) => button.disabled)).toEqual([false, true, false]);
    expect(buttons.filter((button) => button.getAttribute('aria-current') === 'true')).toHaveLength(
      1,
    );
    await act(async () => buttons[2]!.click());
    expect(window.scrollTo).toHaveBeenCalled();
  });
});

describe('sky chrome', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
  });

  const crumbs = [
    { label: 'Años', href: '/timeline', landKey: '2004' },
    { label: '2004', href: '/timeline/2004', landKey: '8' },
    { label: 'Agosto' },
  ];

  it('marks the current crumb, keeps ancestors as real links and labels the back button', async () => {
    await act(async () => root.render(<SkyChrome crumbs={crumbs} onTravel={vi.fn()} />));

    const links = [...container.querySelectorAll('nav[aria-label="Dónde estás"] a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Años', '/timeline'],
      ['2004', '/timeline/2004'],
    ]);
    expect(
      container.querySelector('nav[aria-label="Dónde estás"] [aria-current="location"]')
        ?.textContent,
    ).toBe('Agosto');
    expect(container.querySelector('button[aria-label="Volver a 2004"]')).not.toBeNull();
  });

  it('travels out on a plain click but leaves modified clicks to the browser', async () => {
    const onTravel = vi.fn();
    await act(async () => root.render(<SkyChrome crumbs={crumbs} onTravel={onTravel} />));

    const year = container.querySelector<HTMLAnchorElement>('a[href="/timeline/2004"]')!;
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    await act(async () => year.dispatchEvent(plain));
    expect(plain.defaultPrevented).toBe(true);
    expect(onTravel).toHaveBeenCalledWith('/timeline/2004', 'out', null, '8');

    onTravel.mockClear();
    // Observe at the window, then cancel the browser default so jsdom does not navigate.
    let handledByChrome = true;
    const observe = (event: MouseEvent) => {
      handledByChrome = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener('click', observe, { once: true });
    const modified = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    await act(async () => year.dispatchEvent(modified));
    expect(handledByChrome).toBe(false);
    expect(onTravel).not.toHaveBeenCalled();

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Volver a 2004"]')!.click(),
    );
    expect(onTravel).toHaveBeenCalledWith('/timeline/2004', 'out', null, '8');
  });

  it('has no back button at the top level and toggles the orientation', async () => {
    const onOrientationChange = vi.fn();
    await act(async () =>
      root.render(
        <SkyChrome
          crumbs={[{ label: 'Años' }]}
          onTravel={vi.fn()}
          orientation="vertical"
          onOrientationChange={onOrientationChange}
        />,
      ),
    );

    expect(container.querySelector('button[aria-label^="Volver"]')).toBeNull();
    const [vertical, horizontal] = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Orientación de la línea"] button',
      ),
    ];
    expect(vertical!.getAttribute('aria-pressed')).toBe('true');
    expect(horizontal!.getAttribute('aria-pressed')).toBe('false');
    await act(async () => horizontal!.click());
    expect(onOrientationChange).toHaveBeenCalledWith('horizontal');
  });
});
