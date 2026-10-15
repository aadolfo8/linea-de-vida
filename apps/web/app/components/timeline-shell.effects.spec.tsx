/** @vitest-environment jsdom */

import '../globals.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineRoute } from './TimelineRoute';
import { TimelineFocusProvider } from './TimelineFocus';

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

describe('Timeline shell targets', () => {
  let container: HTMLDivElement;
  let root: Root;
  const renderRoute = () =>
    root.render(
      <TimelineFocusProvider>
        <TimelineRoute />
      </TimelineFocusProvider>,
    );

  beforeEach(() => {
    navigation.pathname = '/timeline';
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
    await act(async () => renderRoute());

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

  it('exposes month-gallery depth and releases both shell controls from sticky positioning', async () => {
    navigation.pathname = '/timeline/2018/5';
    await act(async () => renderRoute());

    const shell = container.querySelector<HTMLElement>('[data-route-depth="month"]');
    const archiveNav = container.querySelector<HTMLElement>('.archive-nav');
    const modeBar = container.querySelector<HTMLElement>(
      'nav[aria-label="Vista de la cronología"]',
    );

    expect(shell).not.toBeNull();
    expect(window.getComputedStyle(archiveNav!).position).toBe('relative');
    expect(window.getComputedStyle(modeBar!).position).toBe('relative');
  });

  for (const pathname of [
    '/timeline',
    '/timeline/2018',
    '/timeline/2018/5',
    '/timeline/2018/sin-mes',
  ]) {
    it(`keeps timeline controls when concentrating ${pathname}`, async () => {
      navigation.pathname = pathname;
      await act(async () => renderRoute());
      const enter = [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Concentrar vista',
      )!;
      enter.focus();
      await act(async () => enter.click());

      expect(container.querySelector('[data-focus="on"]')).not.toBeNull();
      expect(container.querySelector('.archive-nav')).toBeNull();
      expect(container.querySelector('nav[aria-label="Vista de la cronología"]')).toBeNull();
      expect(container.textContent).toContain('Salir del modo concentración');
      expect(container.textContent).toContain('Cargar más fotografías');
      const exit = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Salir del modo concentración'),
      )!;
      expect(document.activeElement).toBe(exit);
      expect(navigation.router.replace).not.toHaveBeenCalled();

      await act(async () => exit.click());
      expect(document.activeElement).toBe(container.querySelector('button'));
      expect(container.querySelector('.archive-nav')).not.toBeNull();
      expect(container.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.href).toContain(
        '/timeline',
      );
    });
  }

  it('keeps focus mode on nested route changes and exits with Escape', async () => {
    await act(async () => renderRoute());
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Concentrar vista')!
        .click();
    });
    navigation.pathname = '/timeline/2018/5';
    await act(async () => renderRoute());
    expect(container.querySelector('[data-focus="on"][data-route-depth="month"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[data-focus="off"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('Concentrar vista');
    expect(container.querySelector<HTMLAnchorElement>('a[href="/timeline"]')).not.toBeNull();
  });

  it('leaves Escape to an open photo dialog and respects already handled keys', async () => {
    await act(async () => renderRoute());
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Concentrar vista')!
        .click();
    });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    container.append(dialog);
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const handled = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      handled.preventDefault();
      window.dispatchEvent(handled);
    });
    expect(container.querySelector('[data-focus="on"]')).not.toBeNull();
  });
});
