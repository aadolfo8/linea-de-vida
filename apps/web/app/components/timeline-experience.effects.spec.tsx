/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineExperience } from './TimelineExperience';
import type { TimelineYearsPage } from './timeline-model';

const mocks = vi.hoisted(() => ({
  pathname: '/timeline',
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  apiJson: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, apiJson: mocks.apiJson };
});

vi.mock('./TimelinePhotoViewer', () => ({
  TimelinePhotoViewer: () => null,
  galleryOriginalIndexes: () => new Set<number>(),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type YearsRequest = {
  deferred: Deferred<TimelineYearsPage>;
  signal: AbortSignal;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function yearsPage(latestYear: number, otherYear = latestYear - 1): TimelineYearsPage {
  return {
    firstYear: otherYear,
    lastYear: latestYear,
    latestYear,
    items: [
      { year: otherYear, photoCount: 2 },
      { year: latestYear, photoCount: 4 },
    ],
  };
}

describe('TimelineExperience effects', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let requests: YearsRequest[];

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.pathname = '/timeline';
    mocks.router.push.mockReset();
    mocks.router.replace.mockReset();
    requests = [];
    mocks.apiJson.mockReset();
    mocks.apiJson.mockImplementation((path: string, init?: RequestInit) => {
      if (path !== '/timeline/years') return new Promise(() => undefined);
      const signal = init?.signal;
      if (!signal) throw new Error('Timeline years requests must be abortable.');
      const request = { deferred: deferred<TimelineYearsPage>(), signal };
      requests.push(request);
      return request.deferred.promise;
    });
    container = document.createElement('div');
    document.body.append(container);
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
    container.remove();
    vi.useRealTimers();
  });

  async function render(view: 'immersive' | 'editorial' = 'editorial') {
    await act(async () => root?.render(<TimelineExperience view={view} />));
  }

  it('aborts a root request before a newer route can accept its data or redirect', async () => {
    await render();
    expect(requests).toHaveLength(1);

    mocks.pathname = '/timeline/2024';
    await render();
    expect(requests).toHaveLength(2);
    expect(requests[0].signal.aborted).toBe(true);

    await act(async () => {
      requests[0].deferred.resolve(yearsPage(2026));
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('2026');
    expect(mocks.router.replace).not.toHaveBeenCalled();

    await act(async () => {
      requests[1].deferred.resolve(yearsPage(2025, 2024));
      await Promise.resolve();
    });
    expect(container.textContent).toContain('2025');
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });

  it('redirects only from the current root effect and preserves Editorial mode', async () => {
    await render();

    await act(async () => {
      requests[0].deferred.resolve(yearsPage(2026));
      await Promise.resolve();
    });

    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledWith('/timeline/2026?view=editorial', {
      scroll: false,
    });
  });

  it('invalidates an Editorial request when the mode changes', async () => {
    await render('editorial');
    const editorialRequest = requests[0];

    await render('immersive');
    expect(editorialRequest.signal.aborted).toBe(true);
    expect(requests).toHaveLength(2);

    await act(async () => {
      editorialRequest.deferred.resolve(yearsPage(2025));
      await Promise.resolve();
    });
    expect(mocks.router.replace).not.toHaveBeenCalled();

    await act(async () => {
      requests[1].deferred.resolve(yearsPage(2026));
      await Promise.resolve();
    });
    expect(mocks.router.replace).toHaveBeenCalledWith('/timeline/2026', { scroll: false });
  });

  it('aborts and invalidates the active years request on unmount', async () => {
    await render();
    const request = requests[0];

    await act(async () => root?.unmount());
    root = null;
    expect(request.signal.aborted).toBe(true);

    await act(async () => {
      request.deferred.resolve(yearsPage(2026));
      await Promise.resolve();
    });
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
});
