/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkyChrome } from './SkyChrome';
import { SkyEngine } from './sky-engine';
import { SkyRail } from './SkyRail';
import { SkyStage, useSky, useSkyItem } from './SkyStage';

vi.mock('../../../lib/link', async () => {
  const React = await import('react');
  return {
    Link: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
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

  it('puts the brand, breadcrumb and one control cluster in a single bar', async () => {
    await act(async () =>
      root.render(
        <SkyChrome
          crumbs={crumbs}
          onTravel={vi.fn()}
          orientation="vertical"
          onOrientationChange={vi.fn()}
          actions={<button type="button">Concentrar vista</button>}
          menu={<button type="button">Menú principal</button>}
        />,
      ),
    );

    const bar = container.querySelector('header.sky-bar')!;
    expect(bar.children).toHaveLength(2);
    expect(bar.querySelector('.sky-where a.sky-brand')?.getAttribute('aria-label')).toContain(
      'Línea de vida',
    );
    const controls = bar.querySelector('.sky-controls')!;
    expect([...controls.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Menú principal',
      'Concentrar vista',
      'Vertical',
      'Horizontal',
    ]);
    // Icon-only on narrow screens: the orientation buttons keep their accessible names.
    expect(
      [...controls.querySelectorAll('.sky-seg button')].map((b) => b.getAttribute('title')),
    ).toEqual(['Vertical', 'Horizontal']);
  });

  it('reserves the bar height so depths start below it', () => {
    const css = readFileSync(resolve(__dirname, 'sky.css'), 'utf8');
    expect(css).toMatch(/--sky-bar-h:\s*calc\(env\(safe-area-inset-top, 0px\) \+ \d+px\)/);
    expect(css).toMatch(/\.sky-bar \{[^}]*height: var\(--sky-bar-h\)/);
    expect(css).toMatch(
      /\.sky\[data-orientation='vertical'\] \.sky-track \{[^}]*padding-top: var\(--sky-bar-h\)/,
    );
  });

  it('is friendly to touch: manipulation gestures, pressed feedback, always-visible CTA, 44px targets', () => {
    const css = readFileSync(resolve(__dirname, 'sky.css'), 'utf8');
    const constellations = readFileSync(resolve(__dirname, 'constellation.css'), 'utf8');
    expect(css).toMatch(/\.sky-grp,[^{]*\{[^}]*touch-action: manipulation/);
    expect(css).toMatch(/-webkit-tap-highlight-color: transparent/);
    expect(css).toMatch(/\.sky-grp:active \.sky-num/);
    expect(css).toMatch(/html:has\(\.sky\),\s*body:has\(\.sky\) \{[^}]*overscroll-behavior: none/);
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.sky-go \{[^}]*opacity: 1/);
    // Rail buttons are small to look at but keep the shared 44px hit area.
    expect(css).toMatch(/\.sky :is\(a, button\),[^{]*\{[^}]*min-height: 44px/);
    expect(constellations).toMatch(/\.sky-go \{[^}]*opacity: 0/);
  });

  it('ignores the small height changes of a mobile URL bar but not width or big changes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // jsdom has no `matchMedia`, so it is stubbed rather than spied on.
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query === '(pointer: coarse)' }) as MediaQueryList,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const configure = vi.spyOn(SkyEngine.prototype, 'configure');
    const resizeTo = async (width: number, height: number) => {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      window.dispatchEvent(new Event('resize'));
      await act(async () => vi.advanceTimersByTimeAsync(200));
    };
    Object.assign(window, { innerWidth: 400, innerHeight: 800 });
    await act(async () =>
      root.render(
        <SkyStage orientation="vertical" onOrientationChange={() => undefined} label="Línea">
          <Star itemKey="1" />
        </SkyStage>,
      ),
    );
    const base = configure.mock.calls.length;

    await resizeTo(400, 740);
    expect(configure.mock.calls.length).toBe(base);
    await resizeTo(400, 800);
    expect(configure.mock.calls.length).toBe(base);

    await resizeTo(800, 400);
    expect(configure.mock.calls.length).toBeGreaterThan(base);
    const rotated = configure.mock.calls.length;
    await resizeTo(800, 200);
    expect(configure.mock.calls.length).toBeGreaterThan(rotated);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
