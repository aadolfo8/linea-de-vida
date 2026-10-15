/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyArchiveIndexUpdated, subscribeArchiveIndexUpdated } from './archive-index-events';

describe('archive index update events', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('notifies the current tab and writes a cross-tab invalidation marker', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeArchiveIndexUpdated(onUpdate);

    notifyArchiveIndexUpdated();

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(localStorage.getItem('linea-de-vida:archive-index-updated')).toMatch(/^\d+-/);
    unsubscribe();
  });

  it('notifies a different tab when the local archive index changes', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeArchiveIndexUpdated(onUpdate);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'linea-de-vida:archive-index-updated',
        newValue: 'changed',
      }),
    );

    expect(onUpdate).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
