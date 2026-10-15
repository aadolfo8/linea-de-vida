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
import { ArchiveWorkspace } from '../components/ArchiveWorkspace';
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
  let folderItems: Array<Record<string, unknown>>;
  let historyRun: Record<string, unknown> | null;
  let excludedItems: Array<Record<string, unknown>>;
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
    await act(async () =>
      root.render(
        <ArchiveWorkspace
          area="organize"
          sessionConnection={{ id: 'connection', provider: 'google-drive', status: 'ACTIVE' }}
        />,
      ),
    );
  };
  const mountSettings = async () => {
    await act(async () => root.render(<SettingsPage />));
  };
  const removeSelected = async () => {
    await click(button('Quitar del archivo'));
    await click(button('Quitar del índice'));
  };
  const treeRow = () => container.querySelector<HTMLElement>('[data-folder-id="folder"]')!;
  const filterSelect = () =>
    [...container.querySelectorAll('select')].find((node) =>
      node.querySelector('option[value="MANUAL"]'),
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
    folderItems = [
      {
        id: 'folder',
        driveFolderId: 'drive-folder',
        parentId: null,
        name: 'Family',
        path: ['Family'],
        status: 'ACTIVE',
        photoCount: 2,
        classifiedPhotoCount: 0,
        unclassifiedPhotoCount: 2,
        dateRule: null,
      },
    ];
    historyRun = null;
    excludedItems = [];
    request.mockImplementation(async (path, init) => {
      if (path === '/photo-sources')
        return {
          items: sourceRemoved ? [] : [{ id: 'source', status: sourceStatus, name: 'Archive' }],
        };
      if (path === '/photo-sources/source' && init?.method === 'DELETE') {
        sourceRemoved = true;
        return undefined;
      }
      if (path === '/photo-sources/source/sync-runs' && init?.method === 'POST')
        return { id: 'run', status: 'QUEUED', createdAt: '2026-10-14T00:00:00.000Z' };
      if (path.includes('/indexed-folders?'))
        return {
          items: folderItems,
          nextCursor: null,
        };
      if (path.includes('/sync-runs?')) return { items: historyRun ? [historyRun] : [] };
      if (path.includes('/issues?'))
        return {
          items: [
            {
              id: 'issue-1',
              code: 'ACCESS_DENIED',
              details: 'Drive denied access.',
              driveFolderId: 'drive-folder',
            },
            {
              id: 'issue-2',
              code: 'UNREADABLE_METADATA',
              driveFileId: 'drive-file',
              driveFolderId: 'drive-folder',
              indexedPhotoId: 'photo-a',
              indexedFolderId: 'folder',
              fileName: 'damaged.jpg',
            },
          ],
          totalCount: 2,
          countsByCode: { ACCESS_DENIED: 1, UNREADABLE_METADATA: 1 },
          nextCursor: null,
        };
      if (path.endsWith('/classification-summary'))
        return { total: 2, automatic: 0, folder: 0, manual: 0, unclassified: 2 };
      if (path.includes('/pending-photos?')) return load();
      if (path.startsWith('/indexed-folders/folder/photos?')) return load();
      if (path.startsWith('/photo-sources/source/photos?')) return load();
      if (path === '/photo-exclusions?limit=30') return { items: excludedItems, nextCursor: null };
      if (path === '/photo-exclusions/excluded-1' && init?.method === 'DELETE') {
        excludedItems = excludedItems.map((item) => ({
          ...item,
          restoredAt: '2026-10-14T00:00:00.000Z',
        }));
        return undefined;
      }
      if (path === '/photo-removals') return remove();
      if (path === '/photos/manual-date-overrides/preview')
        return {
          selectedCount: 1,
          willChangeCount: 1,
          alreadySameCount: 0,
          alreadyDatedCount: 1,
        };
      if (path === '/photos/manual-date-overrides' && init?.method === 'PUT') return { items: [] };
      if (path === '/indexed-folders/folder/date-override/preview')
        return {
          scopePhotoCount: 2,
          willChangeCount: 1,
          unchangedCount: 1,
          preservesManualCount: 0,
          replacesAutomaticCount: 1,
          replacesFolderNameDateCount: 0,
        };
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
    await mountSettings();
    await click(button('Conectar o reconectar Drive'));
    expect(request).toHaveBeenCalledWith('/oauth/google/drive/authorize', { method: 'POST' });
    expect(container.textContent).toContain('Google OAuth no está configurado.');
  });

  it('removes a selected source only after confirmation and states that Drive is untouched', async () => {
    await mount();
    await click(button('Quitar esta carpeta del archivo'));
    expect(container.textContent).toContain('Los archivos originales seguirán intactos en Drive.');
    expect(container.textContent).toContain(
      'se quitarán las correcciones manuales, las reglas de fecha de carpeta y el historial de revisión',
    );
    expect(container.textContent).toContain(
      'las fotos que hayas excluido previamente seguirán fuera',
    );
    await click(button('Quitar carpeta'));
    expect(request).toHaveBeenCalledWith('/photo-sources/source', { method: 'DELETE' });
    expect(container.textContent).toContain('Drive no se ha modificado');
    expect(container.textContent).toContain('Aún no hay carpetas de fotos');
  });

  it('shows a folder overview and explains its safe review action', async () => {
    await mount();
    expect(container.textContent).toContain('Mis carpetas');
    expect(container.textContent).toContain('Disponible');
    expect(container.textContent).toContain('Solo una revisión completa retira fotos ausentes');
    expect(container.textContent).toContain('no se eliminan archivos de Google Drive');
    const overviewStats = container.querySelector('li dl')?.textContent;
    expect(overviewStats).toContain('Fotos incluidas2');
    expect(overviewStats).toContain('Fotos por revisar2');

    await click(button('Revisar y actualizar carpeta'));
    expect(request).toHaveBeenCalledWith('/photo-sources/source/sync-runs', { method: 'POST' });
  });

  it('reports the exact number of photos removed after a complete review', async () => {
    historyRun = {
      id: 'run',
      status: 'SUCCEEDED',
      foundCount: 5,
      indexedCount: 3,
      issueCount: 0,
      removedCount: 2,
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    await mount();

    expect(container.textContent).toContain(
      'Revisión completada: Se han retirado 2 fotos que ya no estaban.',
    );
    expect(container.textContent).toContain(
      'Esta acción solo actualiza la aplicación; no borra archivos de Google Drive.',
    );
  });

  it('explains and supports the folder tree keyboard controls', async () => {
    folderItems.push({
      id: 'child',
      driveFolderId: 'drive-child',
      parentId: 'folder',
      name: 'Summer',
      path: ['Family', 'Summer'],
      status: 'ACTIVE',
      photoCount: 0,
      classifiedPhotoCount: 0,
      unclassifiedPhotoCount: 0,
      dateRule: null,
    });
    await mount();

    const parent = treeRow();
    const key = async (element: HTMLElement, value: string) => {
      await act(async () => {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
      });
    };
    expect(container.querySelector('[role="tree"]')?.getAttribute('aria-describedby')).toBe(
      'folder-tree-keyboard-help',
    );
    expect(container.textContent).toContain('Inicio/Fin ir al primero/último');
    expect(container.querySelector('[data-tree-disclosure]')?.className).toContain('size-11');
    expect(
      container.querySelector('#folder-tree-keyboard-help')?.parentElement?.className,
    ).toContain('leading-relaxed');

    parent.focus();
    await key(parent, 'ArrowLeft');
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-folder-id="child"]')).toBeNull();

    await key(parent, 'ArrowRight');
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const child = container.querySelector<HTMLElement>('[data-folder-id="child"]')!;
    await key(parent, 'ArrowRight');
    expect(document.activeElement).toBe(child);
    await key(child, 'ArrowLeft');
    expect(document.activeElement).toBe(parent);
  });

  it('offers a safe Drive review from the selected folder context', async () => {
    await mount();
    await click(treeRow());

    expect(container.textContent).toContain('La revisión completa la carpeta de origen');
    expect(container.textContent).toContain('No se borran archivos de Drive.');
    await click(button('Revisar y actualizar carpeta'));

    expect(request).toHaveBeenCalledWith('/photo-sources/source/sync-runs', { method: 'POST' });
    expect(container.textContent).toContain('Revisión solicitada');
  });

  it('restores the selected folder and pending task from a shareable URL', async () => {
    window.history.replaceState(
      null,
      '',
      '/organizar?source=source&folder=folder&task=pending&classification=UNCLASSIFIED',
    );
    await mount();

    expect(request).toHaveBeenCalledWith(
      '/photo-sources/source/pending-photos?limit=30',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain('Fotos sin fecha suficiente');
    expect(container.textContent).toContain('Volver a Family');
    expect(window.location.search).toContain('task=pending');
    expect(window.location.search).toContain('folder=folder');
  });

  it('writes task and folder changes to browser history without serializing selections', async () => {
    await mount();
    await click(treeRow());
    await click(button('Fotos por revisar'));

    expect(window.location.search).toContain('source=source');
    expect(window.location.search).toContain('folder=folder');
    expect(window.location.search).toContain('task=pending');
    expect(window.location.search).not.toContain('selected');
  });

  it('opens the review queue and loads photos without a date', async () => {
    await mount();
    await click(button('Fotos por revisar'));
    expect(request).toHaveBeenCalledWith(
      '/photo-sources/source/pending-photos?limit=30',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain('Falta una fecha');
    expect(container.textContent).toContain('Ver fotos sin fecha');
  });

  it('separates folder and photo problems and opens the affected folder context', async () => {
    await mount();
    await click(button('Fotos por revisar'));

    expect(container.textContent).toContain('Problemas de carpeta');
    expect(container.textContent).toContain('Problemas de foto');
    expect(container.textContent).toContain('damaged.jpg');
    expect(container.textContent).toContain('no cierra el problema');
    await click(button('Abrir carpeta de la foto'));

    expect(request).toHaveBeenCalledWith(
      '/indexed-folders/folder/photos?limit=30',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(container.textContent).toContain('Family');
  });

  it('previews a manual correction before enabling the apply action', async () => {
    await mount();
    await click(checkbox('a')!);
    await click(button('Corregir fecha'));

    const yearSelect = [...container.querySelectorAll('select')].find((node) =>
      node.querySelector('option[value="2000"]'),
    )!;
    await changeSelect(yearSelect, '2000');
    await click(button('Ver qué cambiará'));

    expect(request).toHaveBeenCalledWith(
      '/photos/manual-date-overrides/preview',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"photoIds":["a"]'),
      }),
    );
    expect(container.textContent).toContain('La fecha cambiará en 1 foto.');
    expect(button('Aplicar a 1 foto').disabled).toBe(false);
  });

  it('offers the corrected period in the timeline after applying a manual date', async () => {
    await mount();
    await click(checkbox('a')!);
    await click(button('Corregir fecha'));

    const yearSelect = [...container.querySelectorAll('select')].find((node) =>
      node.querySelector('option[value="2000"]'),
    )!;
    await changeSelect(yearSelect, '2000');
    await click(button('Ver qué cambiará'));
    await click(button('Aplicar a 1 foto'));

    expect(request).toHaveBeenCalledWith(
      '/photos/manual-date-overrides',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(container.textContent).toContain('Corrección guardada');
    expect(container.textContent).toContain('Fecha actualizada en 1 foto');
    const timelineLink = [...container.querySelectorAll('a')].find(
      (link) => link.textContent === 'Ver en la cronología',
    );
    expect(timelineLink?.getAttribute('href')).toBe('/timeline/2000');
  });

  it('previews the exact folder-rule impact before saving the rule', async () => {
    await mount();
    await click(treeRow());

    const yearSelect = [...container.querySelectorAll('select')].find((node) =>
      node.querySelector('option[value="2000"]'),
    )!;
    await changeSelect(yearSelect, '2000');
    await click(button('Ver qué fotos cambiarán'));

    expect(request).toHaveBeenCalledWith(
      '/indexed-folders/folder/date-override/preview',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"scope":"DIRECT_ONLY"'),
      }),
    );
    expect(container.textContent).toContain('La fecha cambiará en 1 foto.');
    expect(button('Aplicar fecha a 1 foto').disabled).toBe(false);
  });

  it('explains access problems from the latest review and offers a retry', async () => {
    historyRun = {
      id: 'run-1',
      status: 'PARTIAL',
      issueCount: 1,
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    await mount();
    await click(button('Fotos por revisar'));
    expect(container.textContent).toContain('Problemas que siguen pendientes');
    expect(container.textContent).toContain('No se pudo acceder a la carpeta configurada.');
    expect(container.textContent).toContain('Comprueba que la carpeta siga disponible en Drive');
    expect(container.textContent).toContain('Revisión parcial');
    expect(container.textContent).toContain('No se confirmaron las ausencias');
    expect(request).toHaveBeenCalledWith('/photo-sources/source/issues?limit=30', {
      signal: expect.any(AbortSignal),
    });
  });

  it('shows real progress for an active source in Mis carpetas', async () => {
    historyRun = {
      id: 'run-active',
      status: 'RUNNING',
      phase: 'SCANNING',
      foundCount: 4,
      processedCount: 1,
      indexedCount: 1,
      issueCount: 0,
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    await mount();

    expect(container.textContent).toContain('Revisando carpetas y fotografías');
    expect(container.textContent).toContain('1 foto revisada de 4');
    expect(
      container.querySelector('progress[aria-label="Avance de revisión de Archive"]'),
    ).toBeTruthy();
  });

  it('reports a failed review without implying that missing photos were confirmed', async () => {
    historyRun = {
      id: 'run-failed',
      status: 'FAILED',
      foundCount: 3,
      processedCount: 1,
      indexedCount: 1,
      issueCount: 1,
      createdAt: '2026-10-14T00:00:00.000Z',
    };
    await mount();

    expect(container.textContent).toContain('Revisión fallida');
    expect(container.textContent).toContain('No se confirmó ninguna ausencia');
    expect(container.textContent).toContain('Drive no se modificó');
  });

  it('searches the source across folders and filters locally excluded photos into a recoverable bin', async () => {
    excludedItems = [
      {
        id: 'excluded-1',
        sourceId: 'source',
        sourceName: 'Archive',
        folderPath: ['Family', 'Summer'],
        fileName: 'lost.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-10-13T12:00:00.000Z',
        restoredAt: null,
      },
    ];
    await mount();
    expect(container.textContent).toContain('lost.jpg');
    expect(container.textContent).toContain('Family / Summer');

    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(
        searchInput,
        'summer',
      );
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(button('Buscar en el archivo'));
    expect(request).toHaveBeenCalledWith(
      '/photo-sources/source/photos?limit=30&q=summer',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await click(button('Restaurar'));
    expect(request).toHaveBeenCalledWith('/photo-exclusions/excluded-1', { method: 'DELETE' });
    expect(
      container.querySelector('ul[aria-label="Fotos excluidas y en proceso de restauración"]')
        ?.textContent,
    ).toContain('Restaurada · pendiente de revisión en Drive');
    expect(container.textContent).toContain('Su corrección manual de fecha se conservará');
  });

  it('allows removing a disconnected source without reconnecting Drive', async () => {
    sourceStatus = 'DISCONNECTED';
    await mount();
    expect(container.textContent).toContain('Drive desconectado');
    expect(container.querySelector('a[href="/settings#drive-title"]')?.textContent).toContain(
      'Reconectar Drive',
    );
    await click(button('Quitar fuente'));
    expect(container.textContent).toContain('Los archivos originales seguirán intactos en Drive.');
    await click(button('Quitar carpeta'));
    expect(request).toHaveBeenCalledWith('/photo-sources/source', { method: 'DELETE' });
    expect(container.textContent).toContain('Aún no hay carpetas de fotos');
  });

  it('announces a successful Drive reconnect and removes the callback query', async () => {
    window.history.replaceState(null, '', '/settings?oauth=drive-connected');
    await mountSettings();
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
