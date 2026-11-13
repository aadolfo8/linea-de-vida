/** @vitest-environment jsdom */

import '../globals.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineRoute } from './TimelineRoute';
import { TimelineFocusProvider } from './TimelineFocus';
import { peekPendingTravel, resetTravel } from './sky/travel';

const navigation = vi.hoisted(() => ({
  pathname: '/timeline',
  router: { replace: vi.fn(), push: vi.fn() },
}));

vi.mock('../../lib/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => navigation.router,
}));

vi.mock('../../lib/link', async () => {
  const React = await import('react');
  type MockLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: unknown;
    scroll?: boolean;
  };
  return {
    Link: ({ href, scroll, ...props }: MockLinkProps) => {
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

// Every depth is mocked: these tests are about the shell, not about the data of each depth.
async function depthMock() {
  const React = await import('react');
  return () =>
    React.createElement(
      'div',
      null,
      React.createElement('button', null, 'Volver'),
      React.createElement('button', null, 'Reintentar'),
      React.createElement('button', null, 'Cargar más fotografías'),
    );
}
vi.mock('./sky/MonthDepth', async () => ({ MonthDepth: await depthMock() }));
vi.mock('./sky/YearsDepth', async () => ({ YearsDepth: await depthMock() }));
vi.mock('./sky/YearDepth', async () => ({ YearDepth: await depthMock() }));

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
    window.history.replaceState({}, '', '/');
    resetTravel();
    navigation.router.replace.mockClear();
    navigation.router.push.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
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
    vi.restoreAllMocks();
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

  it('exposes the month depth inside the same sky stage as the other depths', async () => {
    navigation.pathname = '/timeline/2018/5';
    await act(async () => renderRoute());

    expect(container.querySelector('[data-route-depth="month"]')).not.toBeNull();
    expect(container.querySelector('.sky canvas')).not.toBeNull();
    expect(container.querySelector('header.sky-bar')).not.toBeNull();
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
      expect(document.activeElement).toBe(
        [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'Concentrar vista',
        ),
      );
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

  describe('going up', () => {
    const escape = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

    it('goes up one depth with Escape and lands on the group we came from', async () => {
      navigation.pathname = '/timeline/2018/5';
      await act(async () => renderRoute());
      await escape();
      expect(navigation.router.push).toHaveBeenLastCalledWith('/timeline/2018');
      expect(peekPendingTravel()).toMatchObject({ mode: 'out', landKey: '5' });

      navigation.router.push.mockClear();
      navigation.pathname = '/timeline/2018';
      await act(async () => renderRoute());
      await escape();
      expect(navigation.router.push).toHaveBeenLastCalledWith('/timeline');
      expect(peekPendingTravel()).toMatchObject({ mode: 'out', landKey: '2018' });
    });

    it('lands on the undated group when leaving a year without month', async () => {
      navigation.pathname = '/timeline/2018/sin-mes';
      await act(async () => renderRoute());
      await escape();
      expect(peekPendingTravel()).toMatchObject({ mode: 'out', landKey: 'sin-mes' });
    });

    it('has nowhere to go up from the years', async () => {
      await act(async () => renderRoute());
      await escape();
      expect(navigation.router.push).not.toHaveBeenCalled();
    });

    it('leaves Escape to an open dialog, then to concentration mode, before going up', async () => {
      navigation.pathname = '/timeline/2018';
      await act(async () => renderRoute());
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.append(dialog);
      await escape();
      expect(navigation.router.push).not.toHaveBeenCalled();
      dialog.remove();

      await act(async () => {
        [...container.querySelectorAll('button')]
          .find((button) => button.textContent === 'Concentrar vista')!
          .click();
      });
      await escape();
      expect(container.querySelector('[data-focus="off"]')).not.toBeNull();
      expect(navigation.router.push).not.toHaveBeenCalled();

      await escape();
      expect(navigation.router.push).toHaveBeenCalledWith('/timeline');
    });

    it('keeps the way back to Organizar on every link that goes up', async () => {
      window.history.replaceState(
        {},
        '',
        '/timeline/2018?returnTo=%2Forganizar%3Ffolder%3Dabc&returnLabel=Verano',
      );
      navigation.pathname = '/timeline/2018';
      await act(async () => renderRoute());

      const expected = '/timeline?returnTo=%2Forganizar%3Ffolder%3Dabc&returnLabel=Verano';
      expect(container.querySelector('nav[aria-label="Dónde estás"] a')?.getAttribute('href')).toBe(
        expected,
      );
      expect(container.querySelector('aside[aria-label="Continuar organizando"]')).not.toBeNull();
      await escape();
      expect(navigation.router.push).toHaveBeenLastCalledWith(expected);
    });

    it('goes up on a trackpad pinch-out but leaves a ctrl+mouse-wheel to page zoom', async () => {
      navigation.pathname = '/timeline/2018';
      await act(async () => renderRoute());

      const zoom = new WheelEvent('wheel', { ctrlKey: true, deltaY: 100, cancelable: true });
      await act(async () => {
        window.dispatchEvent(zoom);
      });
      expect(zoom.defaultPrevented).toBe(false);
      expect(navigation.router.push).not.toHaveBeenCalled();

      // Zooming in, or a pinch that has not added up yet, stays with the browser.
      const zoomIn = new WheelEvent('wheel', { ctrlKey: true, deltaY: -4.5, cancelable: true });
      const start = new WheelEvent('wheel', { ctrlKey: true, deltaY: 4.5, cancelable: true });
      await act(async () => {
        window.dispatchEvent(zoomIn);
        window.dispatchEvent(start);
      });
      expect(zoomIn.defaultPrevented).toBe(false);
      expect(start.defaultPrevented).toBe(false);
      expect(navigation.router.push).not.toHaveBeenCalled();

      // A sustained pinch-out is consumed once it clearly adds up.
      const pinches = Array.from(
        { length: 40 },
        () => new WheelEvent('wheel', { ctrlKey: true, deltaY: 4.5, cancelable: true }),
      );
      await act(async () => {
        pinches.forEach((pinch) => window.dispatchEvent(pinch));
      });
      expect(pinches.some((pinch) => pinch.defaultPrevented)).toBe(true);
      expect(pinches[0]!.defaultPrevented).toBe(false);
      expect(navigation.router.push).toHaveBeenCalledWith('/timeline');
    });
  });

  it('announces the depth and labels the breadcrumb and back button', async () => {
    navigation.pathname = '/timeline/2018/8';
    await act(async () => renderRoute());

    expect(container.querySelector('[role="status"]')?.textContent).toBe('Agosto de 2018');
    expect(
      container.querySelector('nav[aria-label="Dónde estás"] [aria-current="location"]')
        ?.textContent,
    ).toBe('Agosto');
    expect(container.querySelector('button[aria-label="Volver a 2018"]')).not.toBeNull();

    navigation.pathname = '/timeline/2018';
    await act(async () => renderRoute());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Año 2018');
    expect(container.querySelector('button[aria-label="Volver a Años"]')).not.toBeNull();
  });

  it('remembers the travel orientation and keeps it at the month depth', async () => {
    await act(async () => renderRoute());
    const horizontal = container.querySelector<HTMLButtonElement>(
      '[aria-label="Orientación de la línea"] button[title="Horizontal"]',
    )!;
    await act(async () => horizontal.click());
    expect(container.querySelector('.sky')?.getAttribute('data-orientation')).toBe('horizontal');
    expect(window.localStorage.getItem('ldv-sky-orientation')).toBe('horizontal');

    navigation.pathname = '/timeline/2018/5';
    await act(async () => renderRoute());
    expect(container.querySelector('.sky')?.getAttribute('data-orientation')).toBe('horizontal');
    window.localStorage.clear();
  });
});
