/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkyLoading } from './SkyStates';

describe('SkyLoading', () => {
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

  it('draws a decorative skeleton for a year or month and announces only the label', async () => {
    await act(async () => root.render(<SkyLoading label="Cargando 2022…" />));

    const skeleton = container.querySelector<HTMLElement>('.sky-skeleton')!;
    expect(skeleton.dataset.variant).toBe('depth');
    expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    expect(skeleton.querySelectorAll('.sky-skel-grp')).toHaveLength(2);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Cargando 2022…');
    expect(container.querySelector('.sky-state')?.getAttribute('aria-busy')).toBe('true');
  });

  it('draws more constellations for the years depth', async () => {
    await act(async () => root.render(<SkyLoading label="Cargando años…" variant="years" />));
    expect(container.querySelectorAll('.sky-skel-grp')).toHaveLength(3);
  });
});
