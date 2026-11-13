// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Session } from '../../lib/api';
import { createFakeCovers, fakeCoverPhoto, type FakePhoto } from './fake-covers';

vi.mock('next/navigation', () => ({
  usePathname: () => '/portadas',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href, ...props }, children),
  };
});
vi.mock('../../lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));
vi.mock('../../lib/api', async (original) => ({
  ...(await original<typeof import('../../lib/api')>()),
  apiJson: vi.fn(),
}));
vi.mock('../../lib/archive-index-events', () => ({ notifyArchiveIndexUpdated: vi.fn() }));
// The cache would keep serving the year it loaded before saving; the screen reloads after saving.
vi.mock('../components/timeline-cache', async () => {
  const { apiJson } = await import('../../lib/api');
  return {
    loadTimelineYears: (fetchPage: (cursor?: string) => Promise<unknown>) => fetchPage(),
    loadYearSummary: (year: number) => apiJson(`/timeline/years/${year}`),
    loadMonthPreviews: (year: number) => apiJson(`/timeline/years/${year}/month-previews`),
  };
});

import { apiJson } from '../../lib/api';
import { notifyArchiveIndexUpdated } from '../../lib/archive-index-events';
import { PortadasScreen } from './PortadasScreen';

const session: Session = {
  user: { displayName: 'Ana', email: 'ana@example.test', connections: [] },
  driveConfigured: true,
  developmentMode: false,
};

/** March 2024 has eight dated photos (m1 oldest), June one, and two photos have only a year. */
const archive = (): FakePhoto[] => [
  ...Array.from({ length: 8 }, (_, index) =>
    fakeCoverPhoto(`m${index + 1}`, `2024-03-${String(index + 1).padStart(2, '0')}`),
  ),
  fakeCoverPhoto('j1', '2024-06-10'),
  fakeCoverPhoto('y1', '2024-01-01', 'YEAR'),
  fakeCoverPhoto('y2', '2024-01-01', 'YEAR'),
  fakeCoverPhoto('old', '2023-05-05'),
];

describe('Portadas', () => {
  let root: Root;
  let container: HTMLDivElement;
  let fake: ReturnType<typeof createFakeCovers>;

  const settle = async (rounds = 6) => {
    for (let index = 0; index < rounds; index++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  };
  const mount = async (
    photos = archive(),
    options: Parameters<typeof createFakeCovers>[1] = {},
  ) => {
    fake = createFakeCovers(photos, options);
    vi.mocked(apiJson).mockImplementation(async (path, init) => fake.handler(path, init) as never);
    await act(async () => root.render(<PortadasScreen session={session} />));
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
  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await settle();
  };
  const candidate = (id: string) => need<HTMLButtonElement>(`[data-photo-id="${id}"] button`);
  const scope = (name: string) => need<HTMLButtonElement>('.cov-scope', name);
  const chosenIds = () =>
    [...container.querySelectorAll('.cov-strip li')].map((item) =>
      item.getAttribute('data-chosen-id'),
    );
  const saveButton = () => need<HTMLButtonElement>('button', 'Guardar portada');
  const puts = () => fake.calls.filter((call) => call.method === 'PUT');
  const status = () => need('[role="status"].sp-sr').textContent;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.history.replaceState(null, '', '/portadas');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('opens the newest year and lists its covers with their state', async () => {
    await mount(archive(), { stored: { 'MONTH:3': ['m2', 'm1'] } });

    expect(need('h1').textContent).toBe('Portadas');
    expect(need<HTMLSelectElement>('select').value).toBe('2024');
    expect([...container.querySelectorAll('select option')].map((o) => o.textContent)).toEqual([
      '2024',
      '2023',
    ]);
    expect([...container.querySelectorAll('.cov-scope')].map((node) => node.textContent)).toEqual([
      'Portada del añoAutomática',
      'MarzoElegida (2)',
      'JunioAutomática',
      'Sin mesAutomática',
    ]);
    expect(scope('Portada del año').getAttribute('aria-current')).toBe('true');
    expect(need('h2', 'Portada de 2024')).toBeTruthy();
    expect(container.querySelectorAll('.cov-cell')).toHaveLength(8);
    expect(find('.cov-strip')).toBeUndefined();
    expect(container.textContent).toContain('Aún no has elegido ninguna');
    expect(saveButton().disabled).toBe(true);
  });

  it('numbers the chosen photos, renumbers when one is taken out and saves them in order', async () => {
    await mount();
    await click(scope('Marzo'));

    await click(candidate('m5'));
    await click(candidate('m2'));
    await click(candidate('m7'));
    expect(chosenIds()).toEqual(['m5', 'm2', 'm7']);
    expect(candidate('m7').textContent).toContain('3');
    expect(candidate('m7').getAttribute('aria-pressed')).toBe('true');
    expect(candidate('m7').getAttribute('aria-label')).toContain('puesto 3');
    expect(status()).toContain('3 de 6');
    expect(need('.ord-toolbar').textContent).toContain('Elegidas: 3 de 6');
    expect(saveButton().disabled).toBe(false);
    expect(container.textContent).toContain('Cambios sin guardar');

    await click(candidate('m5'));
    expect(chosenIds()).toEqual(['m2', 'm7']);
    expect(candidate('m7').textContent).toContain('2');
    expect(candidate('m5').getAttribute('aria-pressed')).toBe('false');

    await click(saveButton());
    expect(puts()).toEqual([
      {
        method: 'PUT',
        path: '/covers',
        body: { kind: 'MONTH', year: 2024, month: 3, photoIds: ['m2', 'm7'] },
      },
    ]);
    expect(notifyArchiveIndexUpdated).toHaveBeenCalledTimes(1);
    expect(scope('Marzo').textContent).toBe('MarzoElegida (2)');
    expect(saveButton().disabled).toBe(true);
    expect(container.textContent).toContain('Portada guardada');
    expect(need('.sp-toast').textContent).toContain('Portada guardada: 2 fotos elegidas.');
    expect(need('.sp-toast a').getAttribute('href')).toBe('/timeline/2024');
  });

  it('shows the chosen photos first in the preview and fills the rest with automatic ones', async () => {
    await mount();
    await click(scope('Marzo'));
    await click(candidate('m1'));

    const cells = [...container.querySelectorAll<HTMLImageElement>('.cov-cell img')];
    expect(cells).toHaveLength(6);
    expect(cells.some((img) => img.src.includes('/photos/m1/'))).toBe(true);
    expect(new Set(cells.map((img) => img.src)).size).toBe(6);
    expect(container.textContent).toContain('Las 5 que faltan se completan solas.');
  });

  it('stops at the limit with a notice and still lets a photo be removed', async () => {
    await mount();
    await click(scope('Marzo'));
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']) await click(candidate(id));
    expect(chosenIds()).toHaveLength(6);
    expect(container.textContent).toContain('Has llegado al máximo de 6 fotos');

    await click(candidate('m7'));
    expect(chosenIds()).toHaveLength(6);
    expect(candidate('m7').getAttribute('aria-pressed')).toBe('false');
    expect(status()).toContain('ya tiene 6 fotos');

    await click(candidate('m3'));
    expect(chosenIds()).toHaveLength(5);
    expect(container.textContent).not.toContain('Has llegado al máximo');
  });

  it('allows eight photos for the year', async () => {
    await mount();
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']) await click(candidate(id));
    expect(chosenIds()).toHaveLength(8);
    expect(container.textContent).toContain('Has llegado al máximo de 8 fotos');
  });

  it('moves a chosen photo earlier or later with buttons', async () => {
    await mount();
    await click(scope('Marzo'));
    for (const id of ['m1', 'm2', 'm3']) await click(candidate(id));
    const item = (id: string) => need(`[data-chosen-id="${id}"]`);
    const act = (id: string, name: string) =>
      need<HTMLButtonElement>(`[data-chosen-id="${id}"] [data-act="${name}"]`);

    expect(act('m1', 'earlier').disabled).toBe(true);
    expect(act('m3', 'later').disabled).toBe(true);
    await click(act('m3', 'earlier'));
    expect(chosenIds()).toEqual(['m1', 'm3', 'm2']);
    await click(act('m1', 'later'));
    expect(chosenIds()).toEqual(['m3', 'm1', 'm2']);
    expect(item('m3').querySelector('.cov-num')?.textContent).toBe('1');
    expect(status()).toContain('puesto 2');
    await click(saveButton());
    expect(puts()[0]!.body?.photoIds).toEqual(['m3', 'm1', 'm2']);
  });

  it('removes a chosen photo from the strip', async () => {
    await mount();
    await click(scope('Marzo'));
    for (const id of ['m1', 'm2']) await click(candidate(id));
    await click(need('[data-chosen-id="m1"] [data-act="remove"]'));
    expect(chosenIds()).toEqual(['m2']);
    expect(candidate('m1').getAttribute('aria-pressed')).toBe('false');
  });

  it('chooses the year cover and the Sin mes group', async () => {
    await mount();
    await click(candidate('j1'));
    await click(saveButton());
    expect(puts()[0]!.body).toEqual({ kind: 'YEAR', year: 2024, photoIds: ['j1'] });

    await click(scope('Sin mes'));
    expect(container.querySelectorAll('.ord-tile')).toHaveLength(2);
    await click(candidate('y2'));
    await click(saveButton());
    expect(puts()[1]!.body).toEqual({ kind: 'UNKNOWN_MONTH', year: 2024, photoIds: ['y2'] });
    expect(scope('Sin mes').textContent).toBe('Sin mesElegida (1)');
    expect(scope('Portada del año').textContent).toBe('Portada del añoElegida (1)');
  });

  it('flags a chosen photo that no longer qualifies and lets it be replaced', async () => {
    const photos = archive();
    photos[0]!.hidden = true; // m1
    await mount(photos, { stored: { 'MONTH:3': ['m1', 'm2'] } });
    await click(scope('Marzo'));

    expect(need('.cov-missing').textContent).toContain(
      'Una foto elegida ya no está en esta portada',
    );
    expect(need('.cov-missing').textContent).toContain('está oculta');
    expect(chosenIds()).toEqual(['m2']);
    expect(scope('Marzo').textContent).toBe('MarzoElegida (1)');
    expect(saveButton().disabled).toBe(false);

    await click(candidate('m4'));
    await click(saveButton());
    expect(puts()[0]!.body?.photoIds).toEqual(['m2', 'm4']);
    expect(find('.cov-missing')).toBeUndefined();
  });

  it('goes back to the automatic cover and can undo it', async () => {
    await mount(archive(), { stored: { 'MONTH:3': ['m2', 'm1'] } });
    await click(scope('Marzo'));
    expect(need<HTMLButtonElement>('button', 'Volver a automática').disabled).toBe(false);

    await click(need('button', 'Volver a automática'));
    expect(fake.calls.find((call) => call.method === 'DELETE')!.body).toEqual({
      kind: 'MONTH',
      year: 2024,
      month: 3,
    });
    expect(notifyArchiveIndexUpdated).toHaveBeenCalledTimes(1);
    expect(scope('Marzo').textContent).toBe('MarzoAutomática');
    expect(chosenIds()).toEqual([]);
    expect(need<HTMLButtonElement>('button', 'Volver a automática').disabled).toBe(true);

    await click(need('.sp-toast button', 'Deshacer'));
    expect(puts()[0]!.body?.photoIds).toEqual(['m2', 'm1']);
    expect(scope('Marzo').textContent).toBe('MarzoElegida (2)');
    expect(chosenIds()).toEqual(['m2', 'm1']);
  });

  describe('unsaved changes', () => {
    const edited = async () => {
      await mount();
      await click(scope('Marzo'));
      await click(candidate('m1'));
    };

    it('asks before leaving a cover, and keeps editing on request', async () => {
      await edited();
      await click(scope('Junio'));
      expect(need('[role="alertdialog"]').textContent).toContain('cambios sin guardar');
      expect(scope('Marzo').getAttribute('aria-current')).toBe('true');

      await click(need('button', 'Seguir editando'));
      expect(find('[role="alertdialog"]')).toBeUndefined();
      expect(chosenIds()).toEqual(['m1']);
    });

    it('discards the changes when asked', async () => {
      await edited();
      await click(scope('Junio'));
      await click(need('button', 'Descartar y cambiar'));
      expect(scope('Junio').getAttribute('aria-current')).toBe('true');
      expect(puts()).toHaveLength(0);
      await click(scope('Marzo'));
      expect(chosenIds()).toEqual([]);
    });

    it('saves and then switches when asked', async () => {
      await edited();
      await click(scope('Junio'));
      await click(need('button', 'Guardar y cambiar'));
      expect(puts()[0]!.body).toEqual({ kind: 'MONTH', year: 2024, month: 3, photoIds: ['m1'] });
      expect(scope('Junio').getAttribute('aria-current')).toBe('true');
      expect(scope('Marzo').textContent).toBe('MarzoElegida (1)');
    });

    it('asks before changing year, and warns before the page is left', async () => {
      await edited();
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      const select = need<HTMLSelectElement>('select');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
          select,
          '2023',
        );
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await settle();
      expect(need('[role="alertdialog"]')).toBeTruthy();
      await click(need('button', 'Descartar y cambiar'));
      expect(need('h2', 'Portada de 2023')).toBeTruthy();
      expect(container.querySelectorAll('.ord-tile')).toHaveLength(1);
    });

    it('does not ask when nothing changed', async () => {
      await mount();
      await click(scope('Junio'));
      expect(find('[role="alertdialog"]')).toBeUndefined();
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('keeps the choice and says so when saving fails', async () => {
    await mount();
    await click(candidate('j1'));
    vi.mocked(apiJson).mockImplementationOnce(async () => {
      throw new ApiError(500, 'REQUEST_FAILED', 'boom', null, null);
    });
    // The first call after this one is the PUT.
    await click(saveButton());
    expect(need('.sp-toast.error').textContent).toContain('Algo falló por nuestra parte');
    expect(chosenIds()).toEqual(['j1']);
    expect(saveButton().disabled).toBe(false);
    expect(notifyArchiveIndexUpdated).not.toHaveBeenCalled();
  });

  it('loads more photos on request', async () => {
    await mount(archive(), { pageSize: 4 });
    expect(container.querySelectorAll('.ord-tile')).toHaveLength(4);
    await click(need('button', 'Cargar más fotos'));
    expect(container.querySelectorAll('.ord-tile')).toHaveLength(8);
  });

  it('points to Ordenar when no photo has a date yet', async () => {
    await mount([]);
    expect(container.textContent).toContain('Aún no hay fotos con fecha');
    expect(need('a', 'Ir a Ordenar').getAttribute('href')).toBe('/ordenar');
    expect(find('.ord-actions')).toBeUndefined();
  });

  it('offers a retry when the years cannot be loaded', async () => {
    vi.mocked(apiJson).mockRejectedValue(new ApiError(500, 'REQUEST_FAILED', 'x', null, null));
    await act(async () => root.render(<PortadasScreen session={session} />));
    await settle();
    expect(need('[role="alert"]').textContent).toContain('No se pudo cargar tu archivo');
    expect(need('button', 'Reintentar')).toBeTruthy();
  });
});
