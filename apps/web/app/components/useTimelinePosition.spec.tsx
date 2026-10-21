/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelinePosition } from './useTimelinePosition';

function Probe({
  path,
  variant,
  restore = true,
}: {
  path: string;
  variant: string;
  restore?: boolean;
}) {
  useTimelinePosition(path, { restorePosition: restore, variant });
  return null;
}

describe('useTimelinePosition', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollY: number;
  let scrollTo: ReturnType<typeof vi.fn>;
  const scrollTo_ = (top: number) => {
    scrollY = top;
    window.dispatchEvent(new Event('scroll'));
  };
  const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 40)));
  const render = (props: React.ComponentProps<typeof Probe>) =>
    act(async () => root.render(<Probe {...props} />));

  beforeEach(() => {
    scrollY = 0;
    scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      scrollY = top ?? 0;
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as unknown as typeof window.scrollTo);
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(10_000);
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

  it('restores what it saved for the same path and variant', async () => {
    await render({ path: 'sky:/a', variant: 'vertical' });
    await act(async () => scrollTo_(700));
    await act(async () => root.unmount());

    root = createRoot(container);
    scrollTo.mockClear();
    await render({ path: 'sky:/a', variant: 'vertical' });
    await settle();
    expect(scrollTo).toHaveBeenCalledWith({ top: 700, behavior: 'instant' });
  });

  it('keeps the position the engine chose when the variant changes, and the other slot intact', async () => {
    await render({ path: 'sky:/b', variant: 'vertical' });
    await act(async () => scrollTo_(900));

    scrollTo.mockClear();
    await render({ path: 'sky:/b', variant: 'horizontal' });
    // The engine jumps to the same relative progress; the hook must not reset or restore.
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => scrollTo_(300));
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();

    // Leaving stores the new position under the new variant only.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ path: 'sky:/b', variant: 'vertical' });
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: 'instant' });

    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ path: 'sky:/b', variant: 'horizontal' });
    await settle();
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: 'instant' });
  });

  it('does not restore when something else decides the position', async () => {
    await render({ path: 'sky:/c', variant: 'vertical' });
    await act(async () => scrollTo_(500));
    await act(async () => root.unmount());

    root = createRoot(container);
    scrollTo.mockClear();
    await render({ path: 'sky:/c', variant: 'vertical', restore: false });
    await settle();
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
  });
});
