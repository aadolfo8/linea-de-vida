// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/ArchiveNav', () => ({ ArchiveNav: () => null }));
vi.mock('../components/ProtectedSurface', () => ({
  ProtectedSurface: ({ children }: { children: (session: unknown) => React.ReactNode }) =>
    children({ user: { connections: [] } }),
}));
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  apiJson: vi.fn(),
}));
import { apiJson } from '../../lib/api';
import SettingsPage from './page';

const request = vi.mocked(apiJson);
const photo = (id: string) => ({
  id,
  fileName: `${id}.jpg`,
  thumbnailUrl: `/photos/${id}/thumbnail`,
  effectiveDate: { value: null, precision: 'UNKNOWN' },
});
const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map(photo),
  nextCursor,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('mounted archive removal', () => {
  let root: Root;
  let container: HTMLDivElement;
  let photos: ReturnType<typeof page>;
  let load: () => Promise<ReturnType<typeof page>>;
  let remove: () => Promise<unknown>;
  const button = (text: string) => {
    const found = [...container.querySelectorAll('button')].find((node) =>
      node.textContent?.includes(text),
    );
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
  };
  const checkbox = (id: string) => {
    const label = [...container.querySelectorAll('label')].find((node) =>
      node.textContent?.includes(`${id}.jpg`),
    );
    return label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  };
  const click = async (node: HTMLElement) => {
    await act(async () => node.click());
  };
  const mount = async () => {
    await act(async () => root.render(<SettingsPage />));
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('React', React);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    photos = page(['a', 'b'], 'old-cursor');
    load = async () => photos;
    remove = async () => ({ results: [] });
    request.mockImplementation(async (path) => {
      if (path === '/photo-sources')
        return { items: [{ id: 'source', status: 'ACTIVE', name: 'Archive' }] };
      if (path.includes('/indexed-folders?'))
        return {
          items: [
            { id: 'folder', name: 'Family', path: ['Family'], status: 'ACTIVE', photoCount: 2 },
          ],
          nextCursor: null,
        };
      if (path.includes('/sync-runs?')) return { items: [] };
      if (path.startsWith('/indexed-folders/folder/photos?')) return load();
      if (path === '/photo-removals') return remove();
      throw new Error(`Unexpected request: ${path}`);
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('locks selection and navigation while refreshing the retained selection', async () => {
    await mount();
    await click(checkbox('a')!);
    const pending = deferred<ReturnType<typeof page>>();
    load = () => pending.promise;
    await click(button('Actualizar fotos'));
    const locked = checkbox('a')!.disabled;
    const navigationLocked = button('Family').disabled;
    await act(async () => pending.resolve(page(['a', 'b'])));
    expect(locked).toBe(true);
    expect(navigationLocked).toBe(true);
    expect(checkbox('a')!.checked).toBe(true);
    expect(checkbox('a')!.disabled).toBe(false);
  });

  it('retains only failures, drops the old cursor and ignores a late pre-removal page', async () => {
    await mount();
    await click(checkbox('a')!);
    await click(checkbox('b')!);
    const latePage = deferred<ReturnType<typeof page>>();
    load = () => latePage.promise;
    await click(button('Cargar más fotos'));
    const mutation = deferred<unknown>();
    remove = () => mutation.promise;
    await click(button('Quitar seleccionadas'));
    expect(checkbox('a')!.disabled).toBe(true);
    expect(button('Family').disabled).toBe(true);
    load = async () => page(['b']);
    await act(async () =>
      mutation.resolve({
        results: [
          { id: 'a', status: 'REMOVED' },
          { id: 'b', status: 'FAILED' },
        ],
      }),
    );
    await act(async () => latePage.resolve(page(['a', 'stale'], 'old-cursor')));
    expect(checkbox('a')).toBeUndefined();
    expect(checkbox('stale')).toBeUndefined();
    expect(checkbox('b')!.checked).toBe(true);
    expect(container.textContent).not.toContain('Cargar más fotos');
    expect(container.textContent).toContain('1 fotos retiradas; 1 pendientes');
  });

  it('keeps unconfirmed photos selectable after a lost response and retries ABSENT safely', async () => {
    await mount();
    await click(checkbox('a')!);
    remove = async () => {
      throw new Error('response lost');
    };
    load = async () => {
      throw new Error('refresh offline');
    };
    await click(button('Quitar seleccionadas'));
    expect(checkbox('a')!.checked).toBe(true);
    expect(button('Quitar seleccionadas').disabled).toBe(false);
    expect(container.textContent).toContain('No se pudo actualizar la vista');
    remove = async () => ({ results: [{ id: 'a', status: 'ABSENT' }] });
    load = async () => page(['b']);
    await click(button('Quitar seleccionadas'));
    expect(checkbox('a')).toBeUndefined();
    expect(button('Quitar seleccionadas').disabled).toBe(true);
    expect(
      request.mock.calls
        .filter(([path]) => path === '/photo-removals')
        .map(([, options]) => JSON.parse(options!.body as string).photoIds),
    ).toEqual([['a'], ['a']]);
  });
});
