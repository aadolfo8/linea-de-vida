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
});
