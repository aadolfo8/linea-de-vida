/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSkyStage } from './sky-registry';
import { SkyStage, useSky, useSkyItem } from './SkyStage';
import { peekPendingTravel, resetTravel, setPendingTravel } from './travel';
import { useTravel, useTravelEntry, type TravelTo } from './use-travel';

const env = vi.hoisted(() => ({ reduced: false }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('motion/react', () => ({ useReducedMotion: () => env.reduced }));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await act(async () => {
    await frame();
    await frame();
    await Promise.resolve();
  });
};

const animate = vi.fn(() => ({ finished: Promise.resolve() }));

function Travel({ onTravel }: { onTravel: (travel: TravelTo) => void }) {
  onTravel(useTravel());
  return null;
}

describe('useTravel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let travel: TravelTo;

  beforeEach(async () => {
    env.reduced = false;
    resetTravel();
    navigation.push.mockClear();
    animate.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<Travel onTravel={(value) => (travel = value)} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  const fakeStage = (reduced: boolean) => {
    const world = document.createElement('div');
    const engine = { reduced, busy: false, startWarp: vi.fn() };
    const unregister = registerSkyStage({
      engine: engine as unknown as Parameters<typeof registerSkyStage>[0]['engine'],
      world,
    });
    return { world, engine, unregister };
  };

  it('stores the pending travel for the next depth and navigates without moving the scroll', async () => {
    const origin = document.createElement('div');
    origin.getBoundingClientRect = () => ({ left: 100, top: 40, width: 60, height: 20 }) as DOMRect;

    await act(async () => travel('/timeline/2004', 'in', origin, null));

    expect(peekPendingTravel()).toEqual({
      mode: 'in',
      origin: { x: 130, y: 50 },
      landKey: null,
    });
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/timeline/2004', { scroll: false });
  });

  it('remembers the group to land on when travelling out', async () => {
    await act(async () => travel('/timeline/2004', 'out', null, '8'));
    expect(peekPendingTravel()).toMatchObject({ mode: 'out', landKey: '8' });
  });

  it('does nothing when the destination is the page already open', async () => {
    await act(async () => travel(window.location.pathname, 'in', null, null));
    expect(peekPendingTravel()).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('plays the exit zoom and warp before navigating', async () => {
    const stage = fakeStage(false);
    await act(async () => travel('/timeline/2004', 'in', null, null));

    expect(stage.engine.startWarp).toHaveBeenCalledWith(1);
    expect(animate).toHaveBeenCalledOnce();
    expect(stage.world.style.transformOrigin).not.toBe('');
    expect(navigation.push).toHaveBeenCalledOnce();
    stage.unregister();
  });

  it('navigates immediately, without zoom or warp, with reduced motion', async () => {
    const stage = fakeStage(true);
    await act(async () => travel('/timeline/2004', 'in', null, null));

    expect(stage.engine.startWarp).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(navigation.push).toHaveBeenCalledOnce();
    stage.unregister();
  });

  it('ignores a second travel while one is still leaving', async () => {
    const stage = fakeStage(false);
    let release: () => void = () => undefined;
    animate.mockReturnValueOnce({
      finished: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await act(async () => travel('/timeline/2004', 'in', null, null));
    await act(async () => travel('/timeline/2005', 'in', null, null));
    expect(navigation.push).not.toHaveBeenCalled();

    await act(async () => release());
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/timeline/2004', { scroll: false });
    stage.unregister();
  });
});

function Star({ itemKey }: { itemKey: string }) {
  const { ref } = useSkyItem<HTMLDivElement>(itemKey);
  return <div ref={ref} data-star={itemKey} />;
}

function Entry({
  ready,
  location,
  onLanded,
  onSky,
}: {
  ready: boolean;
  location: Parameters<typeof useTravelEntry>[0]['location'];
  onLanded: () => void;
  onSky: (sky: ReturnType<typeof useSky>) => void;
}) {
  onSky(useSky());
  useTravelEntry({ ready, location, onLanded });
  return null;
}

describe('useTravelEntry', () => {
  let container: HTMLDivElement;
  let root: Root;
  let sky: ReturnType<typeof useSky> | undefined;
  const onLanded = vi.fn();
  const year: { year: number | null; month: number | null; unknown: boolean } = {
    year: 2004,
    month: null,
    unknown: false,
  };

  // A depth mounts inside a stage that is already on screen, as when travelling between depths.
  const tree = (entry: React.ReactNode) => (
    <SkyStage orientation="vertical" onOrientationChange={() => undefined} label="Línea">
      <Star itemKey="8" />
      <Star itemKey="9" />
      {entry}
    </SkyStage>
  );
  const render = async (ready: boolean, location = year) => {
    const entry = (
      <Entry
        ready={ready}
        location={location}
        onLanded={onLanded}
        onSky={(value) => (sky = value)}
      />
    );
    if (!sky) await act(async () => root.render(tree(null)));
    await act(async () => root.render(tree(entry)));
  };
  const world = () => container.querySelector<HTMLElement>('.sky-world')!;

  beforeEach(() => {
    env.reduced = false;
    resetTravel();
    sky = undefined;
    onLanded.mockClear();
    animate.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
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
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it('keeps the world hidden until the data is ready, then plays the entry and lands', async () => {
    setPendingTravel({ mode: 'in', origin: { x: 10, y: 20 }, landKey: null });
    await render(false);
    expect(world().style.opacity).toBe('0');
    expect(animate).not.toHaveBeenCalled();

    await render(true);
    await settle();

    expect(world().style.opacity).toBe('');
    expect(animate).toHaveBeenCalledOnce();
    expect(onLanded).toHaveBeenCalledOnce();
  });

  it('consumes the pending travel once: a later depth does not replay it', async () => {
    setPendingTravel({ mode: 'in', origin: { x: 10, y: 20 }, landKey: null });
    await render(true);
    await settle();
    expect(peekPendingTravel()).toBeNull();
    expect(animate).toHaveBeenCalledOnce();

    // A re-render of the same depth, and a new one at the same depth, find nothing to play.
    await render(true);
    await settle();
    expect(animate).toHaveBeenCalledOnce();
  });

  it('lands on the group it came from when travelling out', async () => {
    setPendingTravel({ mode: 'out', origin: { x: 0, y: 0 }, landKey: '9' });
    await render(false);
    const scrollToItem = vi.spyOn(sky!.engine, 'scrollToItem');
    await render(true);
    await settle();

    expect(scrollToItem).toHaveBeenCalledOnce();
    expect(scrollToItem.mock.calls[0]![0]).toBe(sky!.engine.itemByKey('9'));
    expect(scrollToItem.mock.calls[0]![1]).toBe(true);
    expect(onLanded).toHaveBeenCalledOnce();
  });

  it('does not move to another group when the landing key is not on the list', async () => {
    setPendingTravel({ mode: 'out', origin: { x: 0, y: 0 }, landKey: 'gone' });
    await render(false);
    const scrollToItem = vi.spyOn(sky!.engine, 'scrollToItem');
    await render(true);
    await settle();

    expect(scrollToItem).not.toHaveBeenCalled();
    expect(onLanded).toHaveBeenCalledOnce();
  });

  it('lands immediately, without animating or hiding the world, with reduced motion', async () => {
    env.reduced = true;
    setPendingTravel({ mode: 'in', origin: { x: 10, y: 20 }, landKey: null });
    await render(false);
    expect(world().style.opacity).toBe('');

    await render(true);
    await settle();

    expect(animate).not.toHaveBeenCalled();
    expect(onLanded).toHaveBeenCalledOnce();
  });

  it('plays nothing when the depth is opened directly', async () => {
    await render(true);
    await settle();
    expect(animate).not.toHaveBeenCalled();
    expect(onLanded).not.toHaveBeenCalled();
    expect(world().style.opacity).toBe('');
  });

  it('infers the travel of browser back and forward from the depth change', async () => {
    await render(true, { year: 2004, month: 8, unknown: false });
    await settle();
    expect(animate).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render(true, year);
    await settle();
    // Back to the year from a month: an entry zoom out, landing on the month that was left.
    expect(animate).toHaveBeenCalledOnce();
    expect(onLanded).toHaveBeenCalledOnce();
  });
});
