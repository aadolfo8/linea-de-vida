/** @vitest-environment jsdom */

import '../globals.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineRoute } from './TimelineRoute';

const navigation = vi.hoisted(() => ({
  pathname: '/timeline',
  router: { replace: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
}));

vi.mock('next/link', async () => {
  const React = await import('react');
  type MockLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: unknown;
    scroll?: boolean;
  };
  return {
    default: ({ href, scroll, ...props }: MockLinkProps) => {
      void scroll;
      return React.createElement('a', { ...props, href: String(href) });
    },
  };
});

vi.mock('./ProtectedSurface', () => ({
  ProtectedSurface: ({
    children,
  }: {
    children: (session: { user: { displayName: string } }) => React.ReactNode;
  }) => children({ user: { displayName: 'Archive owner' } }),
}));

vi.mock('./ImmersiveTimelineExperience', async () => {
  const React = await import('react');
  return {
    ImmersiveTimelineExperience: () =>
      React.createElement(
        'main',
        null,
        React.createElement('button', null, 'Volver'),
        React.createElement('button', null, 'Reintentar'),
        React.createElement('button', null, 'Cargar más fotografías'),
      ),
  };
});

vi.mock('./TimelineExperience', () => ({ TimelineExperience: () => null }));

describe('Timeline shell targets', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders archive, mode, and action controls with a 44px minimum hit area', async () => {
    await act(async () => root.render(<TimelineRoute view="immersive" />));

    const controls = [...container.querySelectorAll<HTMLElement>('a, button')];
    expect(controls.length).toBeGreaterThanOrEqual(8);
    controls.forEach((control) => {
      const style = window.getComputedStyle(control);
      expect(style.minWidth, control.textContent ?? control.getAttribute('aria-label') ?? '').toBe(
        '44px',
      );
      expect(style.minHeight, control.textContent ?? control.getAttribute('aria-label') ?? '').toBe(
        '44px',
      );
    });
  });
});
