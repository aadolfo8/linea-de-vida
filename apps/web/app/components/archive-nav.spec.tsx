// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveNav } from './ArchiveNav';

const route = vi.hoisted(() => ({ pathname: '/organizar' }));

vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
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
});
