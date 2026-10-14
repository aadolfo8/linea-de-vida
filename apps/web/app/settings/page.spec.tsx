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
  folderId: 'folder',
  fileName: `${id}.jpg`,
  thumbnailUrl: `/photos/${id}/thumbnail`,
  effectiveDate: { value: null, precision: 'UNKNOWN', origin: 'UNKNOWN' },
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
  let sourceRemoved: boolean;
  let sourceStatus: string;
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
  const removeSelected = async () => {
    await click(button('Quitar del archivo'));
    await click(button('Quitar del índice'));
  };
  const treeRow = () => container.querySelector<HTMLElement>('[data-folder-id="folder"]')!;
  const filterSelect = () =>
    [...container.querySelectorAll('select')].find((node) =>
      node.querySelector('option[value="ALL"]'),
    )!;
  const changeSelect = async (node: HTMLSelectElement, value: string) => {
    await act(async () => {
      node.value = value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('React', React);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    photos = page(['a', 'b'], 'old-cursor');
    load = async () => photos;
    remove = async () => ({ results: [] });
    sourceRemoved = false;
    sourceStatus = 'ACTIVE';
    request.mockImplementation(async (path, init) => {
      if (path === '/photo-sources')
        return {
          items: sourceRemoved ? [] : [{ id: 'source', status: sourceStatus, name: 'Archive' }],
        };
      if (path === '/photo-sources/source' && init?.method === 'DELETE') {
        sourceRemoved = true;
        return undefined;
      }
      if (path.includes('/indexed-folders?'))
        return {
          items: [
            {
              id: 'folder',
              parentId: null,
              name: 'Family',
              path: ['Family'],
              status: 'ACTIVE',
              photoCount: 2,
              classifiedPhotoCount: 0,
              unclassifiedPhotoCount: 2,
              dateRule: null,
            },
          ],
          nextCursor: null,
        };
      if (path.includes('/sync-runs?')) return { items: [] };
      if (path.endsWith('/classification-summary'))
        return { total: 2, automatic: 0, folder: 0, manual: 0, unclassified: 2 };
      if (path.includes('/pending-photos?')) return load();
      if (path.startsWith('/indexed-folders/folder/photos?')) return load();
      if (path === '/photo-removals') return remove();
      if (path === '/oauth/google/drive/authorize')
        return { available: false, message: 'Google OAuth no está configurado.' };
      throw new Error(`Unexpected request: ${path}`);
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, '', '/');
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
    const navigationLocked = treeRow().getAttribute('aria-disabled');
    expect(filterSelect().disabled).toBe(true);
    expect(button('Fotos por revisar').disabled).toBe(true);
    await act(async () => pending.resolve(page(['a', 'b'])));
    expect(locked).toBe(true);
    expect(navigationLocked).toBe('true');
    expect(checkbox('a')!.checked).toBe(true);
    expect(checkbox('a')!.disabled).toBe(false);
  });

  it('offers reconnection from Settings and explains when OAuth is unavailable', async () => {
    await mount();
    await click(button('Conectar o reconectar Drive'));
    expect(request).toHaveBeenCalledWith('/oauth/google/drive/authorize', { method: 'POST' });
    expect(container.textContent).toContain('Google OAuth no está configurado.');
  });

  it('removes a selected source only after confirmation and states that Drive is untouched', async () => {
    await mount();
    await click(button('Quitar esta carpeta del archivo'));
    expect(container.textContent).toContain('Los archivos originales seguirán intactos en Drive.');
    await click(button('Quitar carpeta e índice'));
    expect(request).toHaveBeenCalledWith('/photo-sources/source', { method: 'DELETE' });
    expect(container.textContent).toContain('Drive no se ha modificado');
    expect(container.textContent).toContain('Aún no hay una fuente de fotografías');
  });

  it('allows removing a disconnected source without reconnecting Drive', async () => {
    sourceStatus = 'DISCONNECTED';
    await mount();
    expect(container.textContent).toContain('Fuentes guardadas no activas');
    await click(button('Quitar del archivo'));
    expect(container.textContent).toContain('Los archivos originales seguirán intactos en Drive.');
    await click(button('Quitar carpeta e índice'));
    expect(request).toHaveBeenCalledWith('/photo-sources/source', { method: 'DELETE' });
    expect(container.textContent).toContain('Aún no hay una fuente de fotografías');
  });

  it('announces a successful Drive reconnect and removes the callback query', async () => {
    window.history.replaceState(null, '', '/settings?oauth=drive-connected');
    await mount();
    expect(container.textContent).toContain('Drive se ha conectado.');
    expect(window.location.search).toBe('');
  });

  it('retains only failures, drops the old cursor and ignores a late pre-removal page', async () => {
    await mount();
    await click(checkbox('a')!);
    await click(checkbox('b')!);
    const latePage = deferred<ReturnType<typeof page>>();
    load = () => latePage.promise;
    await click(button('Cargar más fotografías'));
    const mutation = deferred<unknown>();
    remove = () => mutation.promise;
    await removeSelected();
    expect(checkbox('a')!.disabled).toBe(true);
    expect(treeRow().getAttribute('aria-disabled')).toBe('true');
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
    expect(container.textContent).not.toContain('Cargar más fotografías');
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
    await removeSelected();
    expect(checkbox('a')!.checked).toBe(true);
    expect(button('Quitar del archivo').disabled).toBe(false);
    expect(container.textContent).toContain('No se pudo actualizar la vista');
    remove = async () => ({ results: [{ id: 'a', status: 'ABSENT' }] });
    load = async () => page(['b']);
    await removeSelected();
    expect(checkbox('a')).toBeUndefined();
    expect(button('Quitar del archivo').disabled).toBe(true);
    expect(
      request.mock.calls
        .filter(([path]) => path === '/photo-removals')
        .map(([, options]) => JSON.parse(options!.body as string).photoIds),
    ).toEqual([['a'], ['a']]);
  });

  it('retains failed removals in the pending view and blocks tree navigation during mutation', async () => {
    await mount();
    await click(button('Fotos por revisar'));
    await click(checkbox('a')!);
    await click(checkbox('b')!);
    const mutation = deferred<unknown>();
    remove = () => mutation.promise;
    await removeSelected();
    await click(treeRow());
    await act(async () =>
      treeRow().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
    );
    expect(container.textContent).toContain('Fotos sin fecha suficiente');
    expect(filterSelect().disabled).toBe(true);
    expect(button('Volver a Family').disabled).toBe(true);
    load = async () => page([]);
    await act(async () =>
      mutation.resolve({
        results: [
          { id: 'a', status: 'REMOVED' },
          { id: 'b', status: 'FAILED' },
        ],
      }),
    );
    expect(checkbox('a')).toBeUndefined();
    expect(checkbox('b')!.checked).toBe(true);
    expect(container.textContent).not.toContain('Cargar más fotografías');
    expect(request.mock.calls.filter(([path]) => path.includes('/pending-photos?'))).toHaveLength(
      2,
    );
    await click(button('Actualizar fotos'));
    expect(checkbox('b')!.checked).toBe(true);
  });

  it('preserves the classification filter after removal and ignores the older page', async () => {
    await mount();
    await changeSelect(filterSelect(), 'MANUAL');
    await click(checkbox('a')!);
    const latePage = deferred<ReturnType<typeof page>>();
    load = () => latePage.promise;
    await click(button('Cargar más fotografías'));
    load = async () => page(['b']);
    remove = async () => ({ results: [{ id: 'a', status: 'REMOVED' }] });
    await removeSelected();
    await act(async () => latePage.resolve(page(['a', 'stale'], 'old-cursor')));
    expect(checkbox('a')).toBeUndefined();
    expect(checkbox('stale')).toBeUndefined();
    expect(filterSelect().value).toBe('MANUAL');
    const loads = request.mock.calls.filter(([path]) =>
      path.startsWith('/indexed-folders/folder/photos?'),
    );
    expect(loads.at(-1)?.[0]).toBe('/indexed-folders/folder/photos?limit=30&classification=MANUAL');
    expect(container.textContent).not.toContain('Cargar más fotografías');
  });
});
