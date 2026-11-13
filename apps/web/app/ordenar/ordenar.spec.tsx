// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Session } from '../../lib/api';
import { createFakeArchive, fakePhoto } from './fake-archive';

vi.mock('../../lib/navigation', () => ({
  usePathname: () => '/ordenar',
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('../../lib/link', async () => {
  const React = await import('react');
  return {
    Link: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href, ...props }, children),
  };
});
vi.mock('../../lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  apiJson: vi.fn(),
}));
vi.mock('../../lib/archive-index-events', () => ({ notifyArchiveIndexUpdated: vi.fn() }));

import { apiJson } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { OrdenarScreen } from './OrdenarScreen';

const session = (connected = true): Session => ({
  user: {
    displayName: 'Ana',
    email: 'ana@example.test',
    connections: connected ? [{ id: 'c1', provider: 'google-drive', status: 'ACTIVE' }] : [],
  },
  driveConfigured: true,
  developmentMode: false,
});

const manual = (value: string, precision: 'YEAR' | 'MONTH' | 'DAY') => ({
  value,
  precision,
  originKind: 'manual' as const,
});

const basicPhotos = () => [
  fakePhoto('p1', { folderId: 'f2' }),
  fakePhoto('p2', { folderId: 'f2' }),
  fakePhoto('p3', { folderId: 'f1' }),
  fakePhoto('p4', { folderId: 'f2', date: manual('1998-01-01T00:00:00.000Z', 'YEAR') }),
  fakePhoto('p5', { folderId: 'f3', hidden: true }),
];

/** Holds a request until `open()` is called, to race it against what the person does next. */
const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};
const apiFailure = (status: number) => new ApiError(status, 'REQUEST_FAILED', 'failed', null, null);

describe('Ordenar', () => {
  /** Runs before each request reaches the fake archive; it can wait or reject. */
  let intercept: ((path: string, init?: RequestInit) => Promise<void> | void) | null = null;
  let root: Root;
  let container: HTMLDivElement;
  let archive: ReturnType<typeof createFakeArchive>;

  const settle = async (rounds = 6) => {
    for (let index = 0; index < rounds; index++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  };
  const mount = async (
    photos = basicPhotos(),
    options: Parameters<typeof createFakeArchive>[1] = {},
    connected = true,
    url = '/ordenar',
  ) => {
    window.history.replaceState(null, '', url);
    archive = createFakeArchive(photos, options);
    vi.mocked(apiJson).mockImplementation(async (path, init) => {
      await intercept?.(path, init);
      return archive.handler(path, init) as never;
    });
    await act(async () => root.render(<OrdenarScreen session={session(connected)} />));
    await settle();
  };
  const find = <T extends Element = HTMLElement>(selector: string, text?: string) =>
    [...container.querySelectorAll<T>(selector)].find((node) =>
      text === undefined ? true : (node.textContent ?? '').includes(text),
    );
  const need = <T extends Element = HTMLElement>(selector: string, text?: string) => {
    const found = find<T>(selector, text);
    if (!found) throw new Error(`Missing ${selector} ${text ?? ''}`);
    return found;
  };
  const click = async (element: Element, init: MouseEventInit = {}) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    });
    await settle();
  };
  const press = async (element: Element | Document, key: string) => {
    await act(async () => {
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    });
    await settle();
  };
  const typeInto = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const tiles = () => [...container.querySelectorAll<HTMLButtonElement>('.ord-tile-main')];
  const tile = (id: string) => need<HTMLButtonElement>(`[data-photo-id="${id}"] .ord-tile-main`);
  const requests = (method: string, prefix: string) =>
    archive.calls.filter((call) => call.method === method && call.path.startsWith(prefix));
  const treeItem = (name: string) => need('[role="treeitem"]', name);

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    intercept = null;
  });

  describe('piles, tree and grid', () => {
    it('shows the piles with live counts and opens the first pile with work', async () => {
      await mount();
      const counts = Object.fromEntries(
        [...container.querySelectorAll('.ord-pile[data-pile]')].map((node) => [
          node.getAttribute('data-pile'),
          node.querySelector('span')?.textContent,
        ]),
      );
      expect(counts).toEqual({ undated: '3', yearOnly: '1', dated: '0', hidden: '1' });
      expect(need('[data-pile="undated"]').getAttribute('aria-pressed')).toBe('true');
      expect(tiles().map((node) => node.getAttribute('aria-label'))).toEqual([
        'p1.jpg, sin fecha',
        'p2.jpg, sin fecha',
        'p3.jpg, sin fecha',
      ]);
      expect(container.textContent).toContain('Tienes 3 fotos sin fecha y 1 foto con solo el año');
      expect(window.location.search).toBe('?pile=undated');
    });

    it('lists the folder tree with what is left to date and the folder date badge', async () => {
      await mount(basicPhotos(), { rule: true });
      const items = [...container.querySelectorAll('[role="treeitem"]')];
      expect(items.map((node) => node.getAttribute('aria-level'))).toEqual(['1', '2', '1']);
      expect(treeItem('Escaneos').textContent).toContain('3 por fechar');
      expect(treeItem('Móvil').textContent).toContain('✓');
      expect(treeItem('1998').textContent).toContain('Fecha de la carpeta: 1998');
      expect(need('[role="tree"]').getAttribute('aria-label')).toBe('Carpetas de Drive');
    });

    it('moves through the tree with the keyboard and chooses a folder', async () => {
      await mount();
      const first = treeItem('Escaneos');
      expect(first.getAttribute('aria-expanded')).toBe('true');
      await press(first, 'ArrowLeft');
      expect(treeItem('Escaneos').getAttribute('aria-expanded')).toBe('false');
      expect(find('[role="treeitem"]', '1998')).toBeUndefined();
      await press(treeItem('Escaneos'), 'ArrowRight');
      expect(find('[role="treeitem"]', '1998')).toBeDefined();
      await press(treeItem('Escaneos'), 'ArrowRight');
      expect(document.activeElement).toBe(treeItem('1998'));
      await press(treeItem('1998'), 'End');
      expect(document.activeElement).toBe(treeItem('Móvil'));
      await press(treeItem('Móvil'), 'Home');
      expect(document.activeElement).toBe(treeItem('Escaneos'));
      await press(treeItem('Escaneos'), 'ArrowDown');
      await press(treeItem('1998'), 'Enter');

      const photoCall = requests('GET', '/ordering/photos').at(-1)!;
      expect(photoCall.path).toContain('folderId=f2');
      expect(photoCall.path).toContain('includeSubfolders=true');
      expect(treeItem('1998').getAttribute('aria-selected')).toBe('true');
      expect(window.location.search).toContain('folder=f2');
    });

    it('shows the breadcrumb and filters again when subfolders are left out', async () => {
      await mount(basicPhotos(), {}, true, '/ordenar?folder=f2&pile=undated');
      const crumbs = need('nav[aria-label="Dónde estás"]');
      expect(crumbs.textContent).toContain('Fotos de la familia');
      expect(crumbs.textContent).toContain('Escaneos');
      expect(need('[aria-current="location"]').textContent).toBe('1998');
      const toggle = need<HTMLInputElement>('.ord-switch input');
      expect(toggle.checked).toBe(true);
      await click(toggle);
      expect(requests('GET', '/ordering/photos').at(-1)!.path).toContain('includeSubfolders=false');
      expect(window.location.search).toContain('subfolders=0');
    });

    it('pages with the cursor and keeps the selection across pages', async () => {
      const many = Array.from({ length: 5 }, (_, index) => fakePhoto(`q${index}`));
      await mount(many, { pageSize: 2 });
      expect(tiles()).toHaveLength(2);
      await click(tile('q0'));
      await click(need('button', 'Cargar más fotos'));
      expect(tiles()).toHaveLength(4);
      expect(requests('GET', '/ordering/photos').at(-1)!.path).toContain('cursor=2');
      expect(tile('q0').getAttribute('aria-pressed')).toBe('true');
      expect(need('.ord-actions .count').textContent).toBe('1 foto');
    });
  });

  describe('selection', () => {
    it('toggles with a click, selects a range with shift and clears with Escape', async () => {
      await mount(Array.from({ length: 5 }, (_, index) => fakePhoto(`q${index}`)));
      await click(tile('q1'));
      await click(tile('q3'), { shiftKey: true });
      expect(tiles().map((node) => node.getAttribute('aria-pressed'))).toEqual([
        'false',
        'true',
        'true',
        'true',
        'false',
      ]);
      expect(need('.ord-actions .count').textContent).toBe('3 fotos');
      await click(tile('q2'));
      expect(need('.ord-actions .count').textContent).toBe('2 fotos');
      await press(document, 'Escape');
      expect(find('.ord-actions')).toBeUndefined();
    });

    it('selects all loaded photos and offers the whole pile when it is larger', async () => {
      await mount(
        Array.from({ length: 5 }, (_, index) => fakePhoto(`q${index}`)),
        { pageSize: 2 },
      );
      await click(need('button', 'Seleccionar todas'));
      expect(need('.ord-actions .count').textContent).toBe('2 fotos');
      expect(need('button', 'Quitar selección')).toBeDefined();

      await click(need('button', 'Seleccionar las 5 del montón'));
      expect(need('.ord-actions .count').textContent).toBe('5 fotos');
      const pages = requests('GET', '/ordering/photos').filter((call) =>
        call.path.includes('cursor='),
      );
      expect(pages.length).toBeGreaterThan(0);
    });

    it('opens a larger peek with the 1280 variant', async () => {
      await mount();
      await click(need('.ord-zoom'));
      const dialog = need('[role="dialog"]');
      expect(dialog.querySelector('img')?.getAttribute('src')).toContain('width=1280');
      expect(dialog.textContent).toContain('p1.jpg');
      await press(dialog, 'ArrowRight');
      expect(need('[role="dialog"]').textContent).toContain('p2.jpg');
      await press(document, 'Escape');
      expect(find('[role="dialog"]')).toBeUndefined();
    });
  });

  describe('dates', () => {
    const openSheet = async (...ids: string[]) => {
      for (const id of ids) await click(tile(id));
      await click(need('.ord-actions button', 'Poner fecha'));
    };
    const sheetYear = () => need<HTMLInputElement>('[role="dialog"] input');

    it('sends only the year when the month is unknown', async () => {
      await mount();
      await openSheet('p1', 'p2');
      await typeInto(sheetYear(), '1998');
      expect(need('.sp-result').textContent).toBe('1998');
      await click(need('[role="dialog"] button', 'Poner a 2 fotos'));

      expect(requests('PUT', '/photos/dates')[0]!.body).toEqual({
        photoIds: ['p1', 'p2'],
        year: 1998,
        precision: 'YEAR',
      });
      expect(archive.photos.find((p) => p.id === 'p1')!.precision).toBe('YEAR');
    });

    it('sends the month with MONTH precision and the day with DAY precision', async () => {
      await mount();
      await openSheet('p1');
      await typeInto(sheetYear(), '2004');
      await click(need('[role="dialog"] .sp-months button', 'ago'));
      expect(need('.sp-result').textContent).toBe('Agosto de 2004');
      await click(need('[role="dialog"] button', 'Poner a 1 foto'));
      expect(requests('PUT', '/photos/dates')[0]!.body).toEqual({
        photoIds: ['p1'],
        year: 2004,
        month: 8,
        precision: 'MONTH',
      });

      await click(tile('p2'));
      await click(need('.ord-actions button', 'Poner fecha'));
      await typeInto(sheetYear(), '2004');
      await click(need('[role="dialog"] .sp-months button', 'ago'));
      await click(need('[role="dialog"] button', 'Sé el día exacto'));
      await click(need('[role="dialog"] .sp-days button', '12'));
      expect(need('.sp-result').textContent).toBe('12 de agosto de 2004');
      await click(need('[role="dialog"] button', 'Poner a 1 foto'));
      expect(requests('PUT', '/photos/dates')[1]!.body).toEqual({
        photoIds: ['p2'],
        year: 2004,
        month: 8,
        day: 12,
        precision: 'DAY',
      });
    });

    it('applies on Enter and refuses an incomplete year', async () => {
      await mount();
      await openSheet('p1');
      const apply = need<HTMLButtonElement>('[role="dialog"] button', 'Poner a 1 foto');
      expect(apply.disabled).toBe(true);
      await typeInto(sheetYear(), '19');
      expect(apply.disabled).toBe(true);
      await typeInto(sheetYear(), '1985');
      await press(sheetYear(), 'Enter');
      expect(requests('PUT', '/photos/dates')).toHaveLength(1);
      expect(find('[role="dialog"]')).toBeUndefined();
    });

    it('uses the decade chips and the year steppers', async () => {
      await mount();
      await openSheet('p1');
      await click(need('[role="dialog"] .sp-chips button', '1980s'));
      expect(sheetYear().value).toBe('1980');
      await click(need('[role="dialog"] button[aria-label="Año siguiente"]'));
      expect(sheetYear().value).toBe('1981');
    });

    it('moves the tiles out of the pile, refreshes the counts and announces the result', async () => {
      await mount();
      await openSheet('p1', 'p2');
      await typeInto(sheetYear(), '2004');
      await click(need('[role="dialog"] .sp-months button', 'ago'));
      await click(need('[role="dialog"] button', 'Poner a 2 fotos'));

      expect(tiles().map((node) => node.getAttribute('aria-label'))).toEqual(['p3.jpg, sin fecha']);
      expect(need('[data-pile="undated"] span').textContent).toBe('1');
      expect(need('[data-pile="dated"] span').textContent).toBe('2');
      expect(find('.ord-actions')).toBeUndefined();
      expect(container.textContent).toContain('2 fotos → Agosto de 2004');
      expect(need('.sp-toast a').getAttribute('href')).toContain('/timeline/2004/8');
      expect(need('[role="status"][aria-live="polite"]').textContent).toContain(
        'Quedan 1 foto sin fecha',
      );
      expect(notifyArchiveIndexUpdated).toHaveBeenCalled();
    });

    it('undoes a change by clearing the manual dates it created', async () => {
      await mount();
      await openSheet('p1');
      await typeInto(sheetYear(), '1998');
      await click(need('[role="dialog"] button', 'Poner a 1 foto'));
      await click(need('.sp-toast button', 'Deshacer'));

      expect(requests('POST', '/photos/dates/clear')[0]!.body).toEqual({ photoIds: ['p1'] });
      expect(archive.photos.find((p) => p.id === 'p1')!.precision).toBe('UNKNOWN');
      expect(tiles().map((node) => node.getAttribute('aria-label'))).toContain('p1.jpg, sin fecha');
      expect(container.textContent).toContain('Hecho: las fotos vuelven a como estaban.');
    });

    it('undoes a correction by putting the previous manual dates back', async () => {
      await mount(basicPhotos(), {}, true, '/ordenar?pile=yearOnly');
      await openSheet('p4');
      await typeInto(sheetYear(), '2004');
      await click(need('[role="dialog"] .sp-months button', 'ago'));
      await click(need('[role="dialog"] button', 'Poner a 1 foto'));
      await click(need('.sp-toast button', 'Deshacer'));

      const restore = requests('PUT', '/photos/dates').at(-1)!;
      expect(restore.body).toEqual({ photoIds: ['p4'], year: 1998, precision: 'YEAR' });
      expect(archive.photos.find((p) => p.id === 'p4')!.precision).toBe('YEAR');
    });

    it('reports partial failures and retries only the photos that failed', async () => {
      await mount(basicPhotos(), { failIds: ['p2'] });
      await openSheet('p1', 'p2');
      await typeInto(sheetYear(), '1998');
      await click(need('[role="dialog"] button', 'Poner a 2 fotos'));

      expect(need('.sp-toast').getAttribute('role')).toBe('alert');
      expect(need('.sp-toast').textContent).toContain(
        '1 foto → 1998. 1 foto no se pudieron guardar.',
      );
      // The failed photo stays in the view, still selected.
      expect(tile('p2').getAttribute('aria-pressed')).toBe('true');
      expect(find('[data-photo-id="p1"]')).toBeUndefined();

      archive.failing.clear();
      await click(need('.sp-toast button', 'Reintentar'));
      expect(requests('PUT', '/photos/dates').at(-1)!.body).toEqual({
        photoIds: ['p2'],
        year: 1998,
        precision: 'YEAR',
      });
      expect(find('[data-photo-id="p2"]')).toBeUndefined();
    });

    it('offers "Quitar fecha" only when a selected photo has a manual date', async () => {
      await mount(basicPhotos(), {}, true, '/ordenar?pile=yearOnly');
      await click(tile('p4'));
      await click(need('.ord-actions button', 'Quitar fecha'));
      expect(requests('POST', '/photos/dates/clear')[0]!.body).toEqual({ photoIds: ['p4'] });
      expect(container.textContent).toContain('Quitaste la fecha puesta a mano a 1 foto.');

      await click(need('.sp-toast button', 'Deshacer'));
      expect(requests('PUT', '/photos/dates').at(-1)!.body).toEqual({
        photoIds: ['p4'],
        year: 1998,
        precision: 'YEAR',
      });
    });

    it('does not offer "Quitar fecha" for photos without a manual date', async () => {
      await mount();
      await click(tile('p1'));
      expect(find('.ord-actions button', 'Quitar fecha')).toBeUndefined();
    });
  });

  describe('hiding', () => {
    it('hides, leaves the pile and undoes with a restore', async () => {
      await mount();
      await click(tile('p3'));
      await click(need('.ord-actions button', 'Ocultar'));
      expect(requests('POST', '/photos/hide')[0]!.body).toEqual({ photoIds: ['p3'] });
      expect(find('[data-photo-id="p3"]')).toBeUndefined();
      expect(container.textContent).toContain('1 foto ocultas. Siguen en tu Drive.');
      expect(need('[data-pile="hidden"] span').textContent).toBe('2');

      await click(need('.sp-toast button', 'Deshacer'));
      expect(requests('POST', '/photos/unhide')[0]!.body).toEqual({ photoIds: ['p3'] });
      expect(find('[data-photo-id="p3"]')).toBeDefined();
    });

    it('shows "Volver a mostrar" in the hidden pile', async () => {
      await mount(basicPhotos(), {}, true, '/ordenar?pile=hidden');
      await click(tile('p5'));
      await click(need('.ord-actions button', 'Volver a mostrar'));
      expect(requests('POST', '/photos/unhide')[0]!.body).toEqual({ photoIds: ['p5'] });
      expect(container.textContent).toContain('1 foto vuelven a tu archivo.');
    });

    it('explains honestly when a pile is empty', async () => {
      await mount([fakePhoto('p1', { date: manual('2004-08-01T00:00:00.000Z', 'MONTH') })]);
      expect(window.location.search).toBe('?pile=dated');
      await click(need('[data-pile="hidden"]'));
      expect(container.textContent).toContain('No hay fotos ocultas');
    });
  });

  describe('filename suggestions', () => {
    it('shows the banner only when there are suggestions and accepts them for the scope', async () => {
      await mount(basicPhotos(), { suggestions: 24 });
      const banner = need('.sp-banner[aria-label="Fechas que vienen en el nombre"]');
      expect(banner.textContent).toContain('24 fotos llevan la fecha en el nombre (de WhatsApp).');
      expect(banner.textContent).toContain('«IMG-20190312-WA0001.jpg» es del 12 de marzo de 2019');
      await click(need('button', 'Usar esas fechas'));

      expect(requests('POST', '/ordering/filename-suggestions/accept')[0]!.body).toEqual({
        sourceId: 's1',
      });
      expect(container.textContent).toContain('24 fotos fechadas por su nombre');
      expect(find('.sp-banner[aria-label="Fechas que vienen en el nombre"]')).toBeUndefined();
    });

    it('stays out of the way when there is nothing to suggest', async () => {
      await mount();
      expect(find('.sp-banner[aria-label="Fechas que vienen en el nombre"]')).toBeUndefined();
    });
  });

  describe('folder dates', () => {
    const open = async (rule = false) => {
      await mount(basicPhotos(), { rule }, true, '/ordenar?folder=f2&pile=undated');
    };

    it('previews the effect of the two choices in one sentence and applies the folder date', async () => {
      await open();
      await click(need('button', 'Poner fecha a la carpeta'));
      await typeInto(need<HTMLInputElement>('[role="dialog"] input[inputmode="numeric"]'), '1998');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320));
      });
      await settle();
      expect(need('.sp-sentence').textContent).toBe(
        'Cambiará la fecha de 6 fotos de 10. Las que tienen fecha puesta a mano (2) no se tocan.',
      );
      expect(requests('POST', '/indexed-folders/f2/date/preview').at(-1)!.body).toEqual({
        year: 1998,
        precision: 'YEAR',
        includeSubfolders: true,
        overrideCameraDates: false,
      });

      const [subfolders, override] = [
        ...container.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]'),
      ];
      await click(subfolders!);
      await click(override!);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 320));
      });
      await settle();
      expect(requests('POST', '/indexed-folders/f2/date/preview').at(-1)!.body).toEqual({
        year: 1998,
        precision: 'YEAR',
        includeSubfolders: false,
        overrideCameraDates: true,
      });
      expect(need('.sp-sentence').textContent).toContain(
        'Se sustituye la fecha de cámara de 2 fotos.',
      );

      await click(need('[role="dialog"] button', 'Poner fecha a la carpeta'));
      expect(requests('PUT', '/indexed-folders/f2/date')[0]!.body).toEqual({
        year: 1998,
        precision: 'YEAR',
        includeSubfolders: false,
        overrideCameraDates: true,
      });
      expect(container.textContent).toContain('«1998» ahora es de 1998.');
    });

    it('undoes a first folder date by removing it', async () => {
      await open();
      await click(need('button', 'Poner fecha a la carpeta'));
      await typeInto(need<HTMLInputElement>('[role="dialog"] input[inputmode="numeric"]'), '1998');
      await click(need('[role="dialog"] button', 'Poner fecha a la carpeta'));
      await click(need('.sp-toast button', 'Deshacer'));
      expect(requests('DELETE', '/indexed-folders/f2/date')).toHaveLength(1);
    });

    it('removes the folder date and undoes it by re-applying the previous rule', async () => {
      await open(true);
      expect(container.textContent).toContain('Fecha de la carpeta: 1998');
      await click(need('button', 'Quitar fecha de la carpeta'));
      expect(requests('DELETE', '/indexed-folders/f2/date')).toHaveLength(1);
      await click(need('.sp-toast button', 'Deshacer'));
      expect(requests('PUT', '/indexed-folders/f2/date')[0]!.body).toEqual({
        year: 1998,
        precision: 'YEAR',
        includeSubfolders: true,
        overrideCameraDates: false,
      });
    });

    it('offers no removal when the folder has no date', async () => {
      await open();
      expect(find('button', 'Quitar fecha de la carpeta')).toBeUndefined();
    });
  });

  describe('quick mode', () => {
    const key = async (name: string) => press(need('[role="dialog"]'), name);

    it('dates one photo after another, remembering the year', async () => {
      await mount();
      await click(need('button', 'Fechar una a una'));
      const dialog = () => need('[role="dialog"]');
      expect(dialog().textContent).toContain('Foto 1 de 4');

      for (const digit of '1998') await key(digit);
      await key('8');
      await key('Enter');
      expect(requests('PUT', '/photos/dates')[0]!.body).toEqual({
        photoIds: ['p1'],
        year: 1998,
        month: 8,
        precision: 'MONTH',
      });
      expect(dialog().textContent).toContain('Foto 2 de 4');
      expect(need<HTMLInputElement>('[role="dialog"] input').value).toBe('1998');

      // Only the year, remembered, and no month.
      await key('Enter');
      expect(requests('PUT', '/photos/dates')[1]!.body).toEqual({
        photoIds: ['p2'],
        year: 1998,
        precision: 'YEAR',
      });
    });

    it('moves the year with the arrows, skips with S and hides with H', async () => {
      await mount();
      await click(need('button', 'Fechar una a una'));
      for (const digit of '1998') await key(digit);
      await key('ArrowRight');
      expect(need<HTMLInputElement>('[role="dialog"] input').value).toBe('1999');
      await key('ArrowLeft');
      await key('ArrowLeft');
      expect(need<HTMLInputElement>('[role="dialog"] input').value).toBe('1997');

      await key('s');
      expect(need('[role="dialog"]').textContent).toContain('Foto 2 de 4');
      expect(requests('PUT', '/photos/dates')).toHaveLength(0);

      await key('h');
      expect(requests('POST', '/photos/hide')[0]!.body).toEqual({ photoIds: ['p2'] });
      expect(need('[role="dialog"]').textContent).toContain('Foto 3 de 4');
    });

    it('asks for a year before saving and keeps the photo when saving fails', async () => {
      await mount(basicPhotos(), { failIds: ['p1'] });
      await click(need('button', 'Fechar una a una'));
      await key('Enter');
      expect(need('[role="dialog"] [role="alert"]').textContent).toContain(
        'Escribe primero el año',
      );
      expect(requests('PUT', '/photos/dates')).toHaveLength(0);

      for (const digit of '1998') await key(digit);
      await key('Enter');
      expect(need('[role="dialog"] [role="alert"]').textContent).toContain('No se pudo guardar');
      expect(need('[role="dialog"]').textContent).toContain('Foto 1 de 4');
    });

    it('finishes with Escape, refreshes the view and says what was done', async () => {
      await mount();
      await click(need('button', 'Fechar una a una'));
      for (const digit of '2001') await key(digit);
      await key('Enter');
      await press(document, 'Escape');
      expect(find('[role="dialog"]')).toBeUndefined();
      expect(container.textContent).toContain('Hecho: 1 foto fechadas.');
      expect(tiles().map((node) => node.getAttribute('aria-label'))).not.toContain(
        'p1.jpg, sin fecha',
      );
    });

    it('does not offer again a photo it dated with only a year while still loading', async () => {
      const late = gate();
      let held = false;
      await mount();
      intercept = async (path) => {
        if (path.includes('pile=yearOnly') && !held) {
          held = true;
          await late.opened;
        }
      };
      await click(need('button', 'Fechar una a una'));
      for (const digit of '1998') await key(digit);
      await key('Enter');
      late.open();
      await settle();
      // p1 moved to "year only" while it loaded: it is counted once, with p4.
      expect(need('[role="dialog"]').textContent).toContain('Foto 2 de 4');
    });

    it('is not offered when nothing is left to date', async () => {
      await mount([fakePhoto('p1', { date: manual('2004-08-01T00:00:00.000Z', 'MONTH') })]);
      expect(need<HTMLButtonElement>('button', 'Fechar una a una').disabled).toBe(true);
    });
  });

  describe('states', () => {
    it('shows one clear banner when Drive is disconnected', async () => {
      await mount(basicPhotos(), {}, false);
      expect(need('.sp-banner.warn').textContent).toContain('Drive no está conectado.');
      expect(find('button', 'Conectar Drive')).toBeDefined();
    });

    it('lets the person choose among several sources', async () => {
      await mount(
        basicPhotos(),
        {
          sources: [
            { id: 's1', name: 'Fotos de la familia', type: 'GENERIC' },
            { id: 's2', name: 'Google Fotos de Ana', type: 'GOOGLE_TAKEOUT' },
          ],
        },
        true,
        '/ordenar?source=s1',
      );
      expect(need<HTMLSelectElement>('.ord-source select').options).toHaveLength(2);
    });

    it('explains an archive without sources', async () => {
      await mount([], { sources: [] });
      expect(container.textContent).toContain('Aún no hay fotos');
      expect(need('a', 'Añadir fotos').getAttribute('href')).toBe('/ajustes');
    });

    it('shows a retryable alert when the photos fail to load', async () => {
      await mount();
      let failing = true;
      vi.mocked(apiJson).mockImplementation((path, init) => {
        if (failing && path.startsWith('/ordering/photos'))
          return Promise.reject(new Error('offline'));
        return archive.handler(path, init) as never;
      });
      await click(need('[data-pile="yearOnly"]'));
      expect(need('[role="alert"]').textContent).toContain('No se pudieron cargar las fotos');
      failing = false;
      await click(need('[role="alert"] button', 'Reintentar'));
      expect(tiles().map((node) => node.getAttribute('aria-label'))).toEqual(['p4.jpg, 1998']);
    });
  });
  describe('consistency under races and failures', () => {
    const undatedMany = () => [
      ...Array.from({ length: 70 }, (_, index) => fakePhoto(`u${String(index).padStart(2, '0')}`)),
      fakePhoto('y1', { date: manual('1998-01-01T00:00:00.000Z', 'YEAR') }),
    ];

    it('drops a page that arrives after the person changed pile', async () => {
      await mount(undatedMany());
      const late = gate();
      intercept = async (path) => {
        if (path.includes('cursor=')) await late.opened;
      };
      await click(need('button', 'Cargar más fotos'));
      await click(need('[data-pile="yearOnly"]'));
      late.open();
      await settle();
      expect(tiles().map((node) => node.getAttribute('aria-label'))).toEqual(['y1.jpg, 1998']);
    });

    it('keeps the pile the person chose while the first counts were loading', async () => {
      const slow = gate();
      let first = true;
      intercept = async (path) => {
        if (path.startsWith('/ordering/piles') && first) {
          first = false;
          await slow.opened;
        }
      };
      await mount();
      await click(need('[data-pile="hidden"]'));
      slow.open();
      await settle();
      expect(need('[data-pile="hidden"]').getAttribute('aria-pressed')).toBe('true');
      expect(window.location.search).toBe('?pile=hidden');
    });

    it('does not crash on an address whose pile is an object property', async () => {
      await mount(basicPhotos(), {}, true, '/ordenar?pile=constructor');
      expect(window.location.search).toBe('?pile=undated');
    });

    it('shows a retryable error when the first counts fail and picks a pile on retry', async () => {
      let failing = true;
      intercept = (path) => {
        if (failing && path.startsWith('/ordering/piles')) throw apiFailure(500);
      };
      await mount();
      expect(need('[role="alert"]').textContent).toContain('No se pudieron cargar las fotos');
      failing = false;
      await click(need('[role="alert"] button', 'Reintentar'));
      expect(window.location.search).toBe('?pile=undated');
      expect(tiles()).toHaveLength(3);
    });

    it('keeps the folder and offers a retry when its detail fails for another reason', async () => {
      let failing = true;
      intercept = (path) => {
        if (failing && path.startsWith('/indexed-folders/f1')) throw apiFailure(500);
      };
      await mount(basicPhotos(), {}, true, '/ordenar?folder=f1');
      expect(window.location.search).toContain('folder=f1');
      expect(need('[role="alert"]').textContent).toContain('No se pudo cargar esta carpeta');
      failing = false;
      await click(need('[role="alert"] button', 'Reintentar'));
      expect(find('[role="alert"]')).toBeUndefined();
      expect(window.location.search).toContain('folder=f1');
    });

    it('drops a folder that no longer exists', async () => {
      intercept = (path) => {
        if (path.startsWith('/indexed-folders/f1')) throw apiFailure(404);
      };
      await mount(basicPhotos(), {}, true, '/ordenar?folder=f1');
      expect(window.location.search).not.toContain('folder=');
    });

    it('asks for the counts once per change', async () => {
      await mount();
      const before = requests('GET', '/ordering/piles').length;
      await click(tile('p1'));
      await click(need('.ord-actions button', 'Ocultar'));
      expect(requests('GET', '/ordering/piles')).toHaveLength(before + 1);
    });

    it('retries the undo itself when the undo fails', async () => {
      await mount();
      await click(tile('p1'));
      await click(need('.ord-actions button', 'Ocultar'));
      let failing = true;
      intercept = (path) => {
        if (failing && path.startsWith('/photos/unhide')) throw apiFailure(500);
      };
      await click(need('.sp-toast button', 'Deshacer'));
      expect(need('.sp-toast').textContent).toContain('Algo falló por nuestra parte');
      failing = false;
      await click(need('.sp-toast button', 'Reintentar'));
      // The failed attempt never reached the archive; the retry did.
      expect(requests('POST', '/photos/unhide')).toHaveLength(1);
      expect(need('.sp-toast').textContent).toContain('vuelven a estar como antes');
    });
  });
});
