/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }));

vi.mock('../components/ProtectedSurface', () => ({
  ProtectedSurface: ({ children }: { children: (session: unknown) => React.ReactNode }) =>
    children({
      user: {
        displayName: 'Archive user',
        connections: [{ id: 'connection', provider: 'google-drive', status: 'ACTIVE' }],
      },
    }),
}));
vi.mock('../components/ArchiveNav', () => ({ ArchiveNav: () => null }));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, apiJson: mocks.apiJson };
});

const folder = (id: string, parentId: string | null) => ({
  id,
  parentId,
  name: id,
  path: [id],
  status: 'ACTIVE',
  photoCount: 0,
  classifiedPhotoCount: 0,
  unclassifiedPhotoCount: 0,
  dateRule: null,
});

describe('Settings indexed folder tree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.apiJson.mockReset();
    mocks.apiJson.mockImplementation((path: string) => {
      if (path === '/photo-sources')
        return Promise.resolve({
          items: [{ id: 'source', name: 'Archive', type: 'GENERIC', status: 'ACTIVE' }],
        });
      if (path.includes('/indexed-folders?'))
        return Promise.resolve({
          items: [
            folder('root', null),
            folder('child', 'root'),
            folder('grandchild', 'child'),
            folder('orphan', 'missing'),
            folder('orphan-child', 'orphan'),
            folder('cycle-a', 'cycle-b'),
            folder('cycle-b', 'cycle-a'),
          ],
          nextCursor: null,
        });
      if (path.includes('/classification-summary'))
        return Promise.resolve({ total: 0, automatic: 0, folder: 0, manual: 0, unclassified: 0 });
      if (path.includes('/sync-runs?')) return Promise.resolve({ items: [] });
      if (path.includes('/photos?')) return Promise.resolve({ items: [], nextCursor: null });
      throw new Error(`Unexpected request: ${path}`);
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const rows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const ids = (container: HTMLElement) => rows(container).map((row) => row.dataset.folderId);

  it('hides descendants after keyboard collapse while preserving orphan and cyclic components', async () => {
    await act(async () => root.render(<SettingsPage />));
    expect(ids(container)).toEqual([
      'root',
      'child',
      'grandchild',
      'orphan',
      'orphan-child',
      'cycle-a',
      'cycle-b',
    ]);

    const rootRow = rows(container)[0];
    expect(rootRow.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      rootRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(rootRow.getAttribute('aria-expanded')).toBe('false');
    expect(ids(container)).toEqual(['root', 'orphan', 'orphan-child', 'cycle-a', 'cycle-b']);

    await act(async () => {
      rootRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(rootRow.getAttribute('aria-expanded')).toBe('true');
    expect(ids(container)).toEqual([
      'root',
      'child',
      'grandchild',
      'orphan',
      'orphan-child',
      'cycle-a',
      'cycle-b',
    ]);
  });
});
