// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveNav } from './ArchiveNav';
import { apiJson } from '../../lib/api';

const route = vi.hoisted(() => ({ pathname: '/organizar' }));
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => navigation,
}));
vi.mock('../../lib/api', () => ({ apiJson: vi.fn() }));
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    default: ({ href, children, ...props }: React.ComponentProps<'a'>) =>
      React.createElement('a', { href, ...props }, children),
  };
});

describe('ArchiveNav', () => {
  let root: Root;
  let container: HTMLDivElement;

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
  });

  it('separates the timeline, organization, and settings destinations', async () => {
    await act(async () => root.render(<ArchiveNav name="Ana" />));

    const links = [...container.querySelectorAll('nav[aria-label="Navegación principal"] a')];
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Cronología', '/timeline'],
      ['Organizar', '/organizar'],
      ['Ajustes', '/settings'],
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('closes the session and returns to the welcome page', async () => {
    vi.mocked(apiJson).mockResolvedValue(undefined);
    await act(async () => root.render(<ArchiveNav name="Ana" />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(apiJson).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(navigation.replace).toHaveBeenCalledWith('/');
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it('keeps the session page open and explains when logout fails', async () => {
    vi.mocked(apiJson).mockRejectedValue(new Error('network error'));
    await act(async () => root.render(<ArchiveNav name="Ana" />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No se pudo cerrar la sesión',
    );
  });

  describe('sky variant', () => {
    const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-controls]')!;
    const panel = () => container.querySelector<HTMLElement>('.sky-nav-panel')!;

    it('collapses the archive links behind a menu button that names and controls its panel', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));

      expect(toggle().getAttribute('aria-label')).toBe('Menú principal');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-controls')).toBe(panel().id);
      expect(container.querySelector('.sky-nav')?.getAttribute('data-open')).toBe('false');
      expect(panel().querySelectorAll('nav a')).toHaveLength(3);
      expect(panel().textContent).toContain('Cerrar sesión');
    });

    it('opens and closes with the button', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));

      await act(async () => toggle().click());
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('.sky-nav')?.getAttribute('data-open')).toBe('true');
      await act(async () => toggle().click());
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on Escape, returns focus to the button and keeps the key from going further', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      await act(async () => toggle().click());
      const link = panel().querySelector<HTMLAnchorElement>('a')!;
      link.focus();

      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => link.dispatchEvent(escape));

      expect(escape.defaultPrevented).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle());
    });

    it('closes on Escape even when focus never entered the menu', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      await act(async () => toggle().click());
      (document.activeElement as HTMLElement | null)?.blur();
      await act(async () => {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      });
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle());
    });

    it('leaves Escape alone while the menu is closed', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      await act(async () => toggle().dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(false);
    });

    it('closes when the visitor taps outside of it', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      await act(async () => toggle().click());
      await act(async () => {
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('closes after navigating', async () => {
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      await act(async () => toggle().click());
      route.pathname = '/timeline/2004';
      await act(async () => root.render(<ArchiveNav variant="sky" name="Ana" />));
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });
  });
});
