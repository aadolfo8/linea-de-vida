// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TimelineNavigation } from './TimelineNavigation';

it('jumps directly to a distant year and month and exposes context and undated photographs', async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  const onYear = vi.fn();
  const onMonth = vi.fn();
  try {
    await act(async () =>
      root.render(
        <TimelineNavigation
          years={[
            { year: 1960, photoCount: 4 },
            { year: 1998, photoCount: 42 },
            { year: 2026, photoCount: 2 },
          ]}
          year={1998}
          month={8}
          view="editorial"
          onYear={onYear}
          onMonth={onMonth}
        />,
      ),
    );
    const [year, month] = container.querySelectorAll('select');
    await act(async () => {
      year.value = '1960';
      year.dispatchEvent(new Event('change', { bubbles: true }));
      month.value = '12';
      month.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onYear).toHaveBeenCalledExactlyOnceWith(1960);
    expect(onMonth).toHaveBeenCalledExactlyOnceWith(12);
    expect(container.querySelector('[aria-current="date"]')?.textContent).toBe('agosto');
    expect(container.querySelector('[aria-label="Volver a 1998"]')?.getAttribute('href')).toBe(
      '/timeline/1998?view=editorial',
    );
    expect(
      container.querySelector('a[href="/organizar?filter=undated#photos-workspace"]'),
    ).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
