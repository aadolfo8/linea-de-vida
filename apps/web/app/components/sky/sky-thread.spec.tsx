/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkyOrientation } from './orientation';
import { SkyStage, useSkyItem } from './SkyStage';
import { SkyThread } from './SkyThread';

vi.mock('../../../lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));

/** A group whose node sits at known offsets inside the section. */
function Group({
  itemKey,
  left,
  top,
  undated = false,
}: {
  itemKey: string;
  left: number;
  top: number;
  undated?: boolean;
}) {
  const { ref } = useSkyItem<HTMLDivElement>(itemKey);
  return (
    <div
      ref={ref}
      data-node-x="12"
      data-node-y="8"
      data-undated={undated ? 'true' : undefined}
      style={{ position: 'absolute', left, top }}
    />
  );
}

describe('SkyThread', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    // jsdom has no layout: offsets come from the inline position of each group.
    for (const property of ['offsetLeft', 'offsetTop'] as const)
      Object.defineProperty(HTMLElement.prototype, property, {
        configurable: true,
        get(this: HTMLElement) {
          return (
            Number.parseFloat(property === 'offsetLeft' ? this.style.left : this.style.top) || 0
          );
        },
      });
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
    delete (HTMLElement.prototype as { offsetLeft?: unknown }).offsetLeft;
    delete (HTMLElement.prototype as { offsetTop?: unknown }).offsetTop;
  });

  // The groups are on the track and measured before the thread mounts, as when data arrives.
  const render = async (orientation: SkyOrientation, keys: string[]) => {
    const tree = (withThread: boolean) => (
      <SkyStage orientation={orientation} onOrientationChange={() => undefined} label="Línea">
        <Group itemKey="1" left={100} top={200} />
        <Group itemKey="2" left={300} top={600} />
        <Group itemKey="sin-mes" left={500} top={1000} undated />
        {withThread && <SkyThread keys={keys} />}
      </SkyStage>
    );
    await act(async () => root.render(tree(false)));
    await act(async () => root.render(tree(true)));
  };

  it('draws one node per group at its anchor and a path through them, vertically', async () => {
    await render('vertical', ['1', '2', 'sin-mes']);

    const nodes = [...container.querySelectorAll<HTMLElement>('.sky-node')];
    expect(nodes.map((node) => [node.style.left, node.style.top])).toEqual([
      ['112px', '208px'],
      ['312px', '608px'],
      ['512px', '1008px'],
    ]);
    expect(nodes.map((node) => node.dataset.undated)).toEqual(['false', 'false', 'true']);

    const path = container.querySelector('.sky-thread path')!;
    expect(path.getAttribute('d')).toBe(
      'M112,208 C112,408 312,408 312,608 C312,808 512,808 512,1008',
    );
    expect(container.querySelector('.sky-thread')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('bends sideways when travelling horizontally', async () => {
    await render('horizontal', ['1', '2']);

    expect(container.querySelector('.sky-thread path')?.getAttribute('d')).toBe(
      'M112,208 C212,208 212,608 312,608',
    );
  });

  it('skips keys that are not on the track', async () => {
    await render('vertical', ['1', 'missing', '2']);
    expect(container.querySelectorAll('.sky-node')).toHaveLength(2);
  });

  it('draws nothing for fewer than two groups', async () => {
    await render('vertical', ['1']);
    expect(container.querySelector('.sky-thread')).toBeNull();
    expect(container.querySelector('.sky-node')).toBeNull();
  });
});
