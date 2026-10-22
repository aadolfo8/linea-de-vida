// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Session } from '../../lib/api';

vi.mock('next/navigation', () => ({
  usePathname: () => '/ajustes',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href, ...props }, children),
  };
});
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  apiJson: vi.fn(),
}));
vi.mock('../../lib/archive-index-events', () => ({ notifyArchiveIndexUpdated: vi.fn() }));

import { apiJson } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { AjustesScreen } from './AjustesScreen';

const session = (connected = true): Session => ({
  user: {
    displayName: 'Ana',
    email: 'ana@example.test',
    connections: connected ? [{ id: 'c1', provider: 'google-drive', status: 'ACTIVE' }] : [],
  },
  driveConfigured: true,
  developmentMode: false,
});

type Run = {
  id: string;
  photoSourceId: string;
  status: string;
  foundCount?: number;
  processedCount?: number;
  issueCount?: number;
  updatedAt?: string;
};

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function createBackend() {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const sources = [
    {
      id: 's1',
      name: 'Google Fotos de Ana',
      type: 'GOOGLE_TAKEOUT',
      status: 'ACTIVE',
      driveFolderId: 'd1',
    },
    {
      id: 's2',
      name: 'Fotos de la familia',
      type: 'GENERIC',
      status: 'ACTIVE',
      driveFolderId: 'd2',
    },
  ];
  const runs: Record<string, Run | null> = {
    s1: { id: 'r1', photoSourceId: 's1', status: 'SUCCEEDED', updatedAt: hoursAgo(2) },
    s2: { id: 'r2', photoSourceId: 's2', status: 'SUCCEEDED', updatedAt: hoursAgo(26) },
  };
  const piles: Record<
    string,
    { undated: number; yearOnly: number; dated: number; hidden: number; total: number }
  > = {
    s1: { undated: 0, yearOnly: 0, dated: 120, hidden: 2, total: 120 },
    s2: { undated: 30, yearOnly: 12, dated: 8, hidden: 0, total: 50 },
  };
  /** Progress the next polls of `sync-runs/:id` report, in order. */
  const polls: Run[] = [];
  const children: Record<string, Array<{ id: string; name: string }>> = {
    abc123: [
      { id: 'c-a', name: '2019' },
      { id: 'c-b', name: '2020' },
    ],
    takeout1: [{ id: 'g1', name: 'Google Fotos' }],
  };
  const state = {
    createError: null as ApiError | null,
    childrenError: null as ApiError | null,
    nextRun: { id: 'r9', photoSourceId: 'new', status: 'QUEUED' } as Run,
  };

  const handler = async (path: string, init?: RequestInit): Promise<unknown> => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const url = new URL(path, 'http://api.test');
    const route = url.pathname;
    let match: RegExpMatchArray | null;

    if (route === '/photo-sources' && method === 'GET') return { items: sources, nextCursor: null };
    if (route === '/photo-sources' && method === 'POST') {
      if (state.createError) throw state.createError;
      const created = { id: 'new', status: 'ACTIVE', ...body, driveFolderId: body.driveFolderId };
      sources.unshift(created);
      runs.new = null;
      piles.new = { undated: 0, yearOnly: 0, dated: 0, hidden: 0, total: 0 };
      return created;
    }
    if ((match = route.match(/^\/photo-sources\/([^/]+)\/sync-runs$/))) {
      const id = match[1]!;
      if (method === 'POST') {
        const run = { ...state.nextRun, photoSourceId: id };
        runs[id] = run;
        return run;
      }
      return { items: runs[id] ? [runs[id]] : [], nextCursor: null };
    }
    if ((match = route.match(/^\/sync-runs\/([^/]+)$/))) {
      const next = polls.shift();
      if (!next) throw new Error('no more polls');
      runs[next.photoSourceId] = next;
      return next;
    }
    if (route === '/ordering/piles') return piles[url.searchParams.get('sourceId') ?? ''];
    if ((match = route.match(/^\/photo-sources\/([^/]+)$/)) && method === 'DELETE') {
      sources.splice(
        sources.findIndex((source) => source.id === match![1]),
        1,
      );
      return undefined;
    }
    if ((match = route.match(/^\/oauth-connections\/c1\/drive\/folders\/([^/]+)\/children$/))) {
      if (state.childrenError) throw state.childrenError;
      return { items: children[match[1]!] ?? [], nextCursor: null };
    }
    if (route === '/oauth-connections/c1' && method === 'DELETE') return undefined;
    if (route === '/oauth/google/drive/authorize')
      return { available: true, authorizationUrl: 'https://accounts.example/consent' };
    if (route === '/auth/logout') return undefined;
    throw new Error(`Unexpected request: ${method} ${path}`);
  };

  return { handler, calls, sources, runs, piles, polls, children, state };
}

describe('Ajustes', () => {
  let root: Root;
  let container: HTMLDivElement;
  let backend: ReturnType<typeof createBackend>;
  const place = { assign: vi.fn(), replace: vi.fn(), search: '', pathname: '/ajustes' };

  const settle = async (rounds = 6) => {
    for (let index = 0; index < rounds; index++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  };
  const wait = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
    await settle();
  };
  const mount = async (
    options: { connected?: boolean; search?: string; arrange?: (b: typeof backend) => void } = {},
  ) => {
    place.search = options.search ?? '';
    backend = createBackend();
    options.arrange?.(backend);
    vi.mocked(apiJson).mockImplementation((path, init) => backend.handler(path, init) as never);
    await act(async () =>
      root.render(<AjustesScreen session={session(options.connected ?? true)} pollMs={5} />),
    );
    await settle();
  };
  const find = <T extends Element = HTMLElement>(
    selector: string,
    text?: string,
    scope?: Element,
  ) =>
    [...(scope ?? container).querySelectorAll<T>(selector)].find((node) =>
      text === undefined ? true : (node.textContent ?? '').includes(text),
    );
  const need = <T extends Element = HTMLElement>(
    selector: string,
    text?: string,
    scope?: Element,
  ) => {
    const found = find<T>(selector, text, scope);
    if (!found) throw new Error(`Missing ${selector} ${text ?? ''}`);
    return found;
  };
  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
  };
  const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const card = (name: string) => need('article', name);
  const requests = (method: string, prefix: string) =>
    backend.calls.filter((call) => call.method === method && call.path.startsWith(prefix));
  const dialog = () => need('[role="dialog"]');

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('location', place);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('sources', () => {
    it('shows one card per source with its kind, state, numbers and the way to order', async () => {
      await mount();
      const takeout = card('Google Fotos de Ana');
      expect(takeout.textContent).toContain('Exportación de Google Fotos');
      expect(takeout.textContent).toContain('Al día · actualizado hace 2 horas');
      expect(takeout.textContent).toContain('120fotos');
      expect(takeout.textContent).toContain('2ocultas');
      expect(find('a', 'Ordenar', takeout)).toBeUndefined();

      const family = card('Fotos de la familia');
      expect(family.textContent).toContain('Carpeta de Drive');
      expect(family.textContent).toContain('Al día · actualizado ayer');
      expect(family.textContent).toContain('42por fechar');
      expect(need('a', 'Ordenar 42', family).getAttribute('href')).toBe('/ordenar?source=s2');
    });

    it('shows found and processed counts while a source is being read', async () => {
      await mount({
        arrange: (b) => {
          b.runs.s2 = {
            id: 'r2',
            photoSourceId: 's2',
            status: 'RUNNING',
            foundCount: 200,
            processedCount: 50,
          };
          b.polls.push({ ...b.runs.s2, processedCount: 50 });
        },
      });
      const family = card('Fotos de la familia');
      expect(family.textContent).toContain('Leyendo fotos nuevas… 50 de 200');
      const bar = need('[role="progressbar"]', undefined, family);
      expect(bar.getAttribute('aria-valuenow')).toBe('50');
      expect(bar.getAttribute('aria-valuemax')).toBe('200');
      expect(need<HTMLButtonElement>('button', 'Buscar fotos nuevas', family).disabled).toBe(true);
    });

    it('starts a reading, follows its progress and refreshes the numbers when it ends', async () => {
      await mount({
        arrange: (b) => {
          b.state.nextRun = { id: 'r5', photoSourceId: 's2', status: 'QUEUED' };
          b.polls.push(
            {
              id: 'r5',
              photoSourceId: 's2',
              status: 'RUNNING',
              foundCount: 200,
              processedCount: 50,
            },
            {
              id: 'r5',
              photoSourceId: 's2',
              status: 'SUCCEEDED',
              foundCount: 200,
              processedCount: 200,
              updatedAt: new Date().toISOString(),
            },
          );
        },
      });
      backend.piles.s2 = { undated: 5, yearOnly: 0, dated: 95, hidden: 0, total: 100 };
      await click(need('button', 'Buscar fotos nuevas', card('Fotos de la familia')));
      expect(requests('POST', '/photo-sources/s2/sync-runs')).toHaveLength(1);

      await wait(80);
      const family = card('Fotos de la familia');
      expect(requests('GET', '/sync-runs/r5').length).toBeGreaterThanOrEqual(2);
      expect(family.textContent).toContain('Al día · actualizado ahora mismo');
      expect(family.textContent).toContain('100fotos');
      expect(family.textContent).toContain('5por fechar');
      expect(notifyArchiveIndexUpdated).toHaveBeenCalled();
    });

    it('explains a failed reading and retries it', async () => {
      await mount({
        arrange: (b) => {
          b.runs.s2 = { id: 'r2', photoSourceId: 's2', status: 'FAILED' };
          b.state.nextRun = { id: 'r6', photoSourceId: 's2', status: 'QUEUED' };
        },
      });
      const family = card('Fotos de la familia');
      expect(family.textContent).toContain(
        'La última búsqueda no terminó. Tus fotos siguen intactas.',
      );
      expect(find('button', 'Buscar fotos nuevas', family)).toBeUndefined();
      await click(need('button', 'Reintentar', family));
      expect(requests('POST', '/photo-sources/s2/sync-runs')).toHaveLength(1);
    });

    it('tells the person when a reading could not even be queued', async () => {
      await mount({
        arrange: (b) => {
          const original = b.handler;
          b.handler = async (path, init) => {
            if (init?.method === 'POST' && path.endsWith('/sync-runs'))
              throw new ApiError(503, 'SYNC_ENQUEUE_FAILED', 'x', null, null);
            return original(path, init);
          };
        },
      });
      await click(need('button', 'Buscar fotos nuevas', card('Fotos de la familia')));
      expect(need('[role="alert"]').textContent).toContain(
        'No pudimos empezar a buscar fotos nuevas',
      );
    });

    it('removes a source only on the second tap and says Drive is untouched', async () => {
      await mount();
      await click(need('button', 'Quitar', card('Fotos de la familia')));
      expect(requests('DELETE', '/photo-sources')).toHaveLength(0);
      const family = card('Fotos de la familia');
      expect(family.textContent).toContain('Tu Drive no cambia');
      expect(need('button', '¿Seguro? Pulsa otra vez', family)).toBeDefined();

      await click(need('button', '¿Seguro? Pulsa otra vez', family));
      expect(requests('DELETE', '/photo-sources/s2')).toHaveLength(1);
      expect(find('article', 'Fotos de la familia')).toBeUndefined();
      expect(container.textContent).toContain('Fuente quitada. Tu Drive no ha cambiado.');
    });

    it('keeps the card and explains when a source cannot be removed yet', async () => {
      await mount({
        arrange: (b) => {
          const original = b.handler;
          b.handler = async (path, init) => {
            if (init?.method === 'DELETE')
              throw new ApiError(409, 'SOURCE_SYNC_ACTIVE', 'x', null, null);
            return original(path, init);
          };
        },
      });
      await click(need('button', 'Quitar', card('Fotos de la familia')));
      await click(need('button', '¿Seguro? Pulsa otra vez', card('Fotos de la familia')));
      expect(card('Fotos de la familia').textContent).toContain(
        'Estamos leyendo esa carpeta ahora mismo',
      );
    });
  });

  describe('account', () => {
    it('shows the account and the read-only Drive connection', async () => {
      await mount();
      expect(container.textContent).toContain('ana@example.test');
      expect(container.textContent).toContain('Google Drive conectado (solo lectura)');
      expect(find('.sp-banner.warn')).toBeUndefined();
      expect(container.textContent).toContain('Solo tú ves tu archivo');
      expect(container.textContent).toContain('Solo las carpetas que eliges');
      expect(container.textContent).toContain('Drive no se toca');
    });

    it('asks before disconnecting Drive, then shows the banner and the way back', async () => {
      await mount();
      await click(need('button', 'Desconectar Drive'));
      expect(requests('DELETE', '/oauth-connections/c1')).toHaveLength(0);
      expect(need('[role="alertdialog"]').textContent).toContain('tu Drive no cambia');
      await click(need('button', 'Sí, desconectar'));

      expect(requests('DELETE', '/oauth-connections/c1')).toHaveLength(1);
      expect(need('.sp-banner.warn').textContent).toContain('Drive no está conectado.');
      expect(find('button', 'Conectar Drive')).toBeDefined();
      expect(need<HTMLButtonElement>('button.ajs-add').disabled).toBe(true);
    });

    it('can cancel the disconnection', async () => {
      await mount();
      await click(need('button', 'Desconectar Drive'));
      await click(need('[role="alertdialog"] button', 'Cancelar'));
      expect(find('[role="alertdialog"]')).toBeUndefined();
      expect(requests('DELETE', '/oauth-connections/c1')).toHaveLength(0);
    });

    it('shows a single banner when Drive is disconnected and connects from it', async () => {
      await mount({ connected: false });
      expect(container.querySelectorAll('.sp-banner.warn')).toHaveLength(1);
      await click(need('.sp-banner.warn button', 'Conectar Drive'));
      expect(requests('POST', '/oauth/google/drive/authorize')).toHaveLength(1);
      expect(place.assign).toHaveBeenCalledWith('https://accounts.example/consent');
    });

    it('signs out and returns to the welcome page', async () => {
      await mount();
      await click(need('button', 'Cerrar sesión', need('.ajs-account')));
      expect(requests('POST', '/auth/logout')).toHaveLength(1);
      expect(place.replace).toHaveBeenCalledWith('/');
    });

    it('reports how the Drive consent went when Google sends the person back', async () => {
      await mount({ search: '?oauth=drive-denied' });
      expect(need('[role="alert"]').textContent).toContain(
        'No se concedió el acceso de solo lectura',
      );
    });
  });

  describe('add photos', () => {
    const open = async () => {
      await click(need('button.ajs-add'));
      return dialog();
    };
    const pasteAndCheck = async (link: string) => {
      await typeInto(need<HTMLInputElement>('[role="dialog"] input[type="url"]'), link);
      await click(need('[role="dialog"] button', 'Comprobar'));
    };

    it('explains Google Takeout and what a newer export does', async () => {
      await mount();
      const wizard = await open();
      expect(wizard.textContent).toContain('Exportación de Google Fotos');
      expect(wizard.textContent).toContain('Una carpeta de Drive');
      await click(need('[role="dialog"] button.ajs-choice', 'Exportación de Google Fotos'));
      expect(dialog().textContent).toContain('takeout.google.com');
      expect(dialog().textContent).toContain('solo se añaden las fotos nuevas');
    });

    it('checks a pasted link, lists the subfolders and adds the source with a first reading', async () => {
      await mount();
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await pasteAndCheck('https://drive.google.com/drive/folders/abc123?usp=sharing');

      expect(requests('GET', '/oauth-connections/c1/drive/folders/abc123/children')).toHaveLength(
        1,
      );
      expect(dialog().textContent).toContain('Carpeta encontrada.');
      expect(dialog().textContent).toContain('2019');
      expect(dialog().textContent).toContain('2020');
      expect(
        find('.sp-banner', 'Parece una exportación de Google Fotos', dialog()),
      ).toBeUndefined();

      await typeInto(
        need<HTMLInputElement>('[role="dialog"] input.ajs-name'),
        'Escaneos de la abuela',
      );
      await click(need('[role="dialog"] button', 'Añadir'));

      expect(requests('POST', '/photo-sources')[0]!.body).toEqual({
        oauthConnectionId: 'c1',
        driveFolderId: 'abc123',
        name: 'Escaneos de la abuela',
        type: 'GENERIC',
      });
      expect(requests('POST', '/photo-sources/new/sync-runs')).toHaveLength(1);
      expect(dialog().textContent).toContain('«Escaneos de la abuela» añadida');
      expect(dialog().textContent).toContain('Ordenar → Sin fecha');
      await click(need('[role="dialog"] button', 'Listo'));
      expect(card('Escaneos de la abuela')).toBeDefined();
    });

    it('hints that a folder looks like a Takeout and offers to switch the type', async () => {
      await mount();
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await pasteAndCheck('takeout1');
      expect(requests('GET', '/oauth-connections/c1/drive/folders/takeout1/children')).toHaveLength(
        1,
      );
      expect(dialog().textContent).toContain('Parece una exportación de Google Fotos');

      await click(need('[role="dialog"] button', 'Sí, es de Google Fotos'));
      expect(need<HTMLInputElement>('[role="dialog"] input.ajs-name').value).toBe('Google Fotos');
      await click(need('[role="dialog"] button', 'Añadir'));
      expect(requests('POST', '/photo-sources')[0]!.body).toMatchObject({
        driveFolderId: 'takeout1',
        type: 'GOOGLE_TAKEOUT',
      });
      expect(dialog().textContent).toContain('Es una exportación de Google Fotos');
    });

    it('shows the progress of the first reading in the last step', async () => {
      await mount({
        arrange: (b) => {
          b.state.nextRun = {
            id: 'r9',
            photoSourceId: 'new',
            status: 'RUNNING',
            foundCount: 40,
            processedCount: 10,
          };
          b.polls.push({ ...b.state.nextRun, processedCount: 10 });
        },
      });
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Exportación de Google Fotos'));
      await pasteAndCheck('abc123');
      await click(need('[role="dialog"] button', 'Añadir'));
      expect(need('[role="dialog"] [role="progressbar"]').getAttribute('aria-valuenow')).toBe('10');
      expect(dialog().textContent).toContain('Leyendo fotos nuevas… 10 de 40');
    });

    it('explains a folder that overlaps another source', async () => {
      await mount();
      backend.state.createError = new ApiError(409, 'FOLDER_SOURCE_OVERLAP', 'x', null, null);
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await pasteAndCheck('abc123');
      await click(need('[role="dialog"] button', 'Añadir'));
      expect(need('[role="dialog"] [role="alert"]').textContent).toContain(
        'contiene, o está dentro de, otra que ya has añadido',
      );
      expect(requests('POST', '/photo-sources/new/sync-runs')).toHaveLength(0);
    });

    it('explains an authorization error while checking the folder', async () => {
      await mount();
      backend.state.childrenError = new ApiError(403, 'DRIVE_FORBIDDEN', 'x', null, null);
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await pasteAndCheck('abc123');
      expect(need('[role="dialog"] [role="alert"]').textContent).toContain(
        'Google no nos deja leer',
      );
      expect(need<HTMLButtonElement>('button', 'Añadir', dialog()).disabled).toBe(true);
    });

    it('refuses a link that is not a concrete folder', async () => {
      await mount();
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await pasteAndCheck('root');
      expect(need('[role="dialog"] [role="alert"]').textContent).toContain('carpeta concreta');
      expect(requests('GET', '/oauth-connections')).toHaveLength(0);
    });

    it('goes back a step and closes with Escape', async () => {
      await mount();
      await open();
      await click(need('[role="dialog"] button.ajs-choice', 'Una carpeta de Drive'));
      await click(need('[role="dialog"] button', 'Atrás'));
      expect(dialog().textContent).toContain('¿De dónde vienen?');
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(find('[role="dialog"]')).toBeUndefined();
    });
  });
});
