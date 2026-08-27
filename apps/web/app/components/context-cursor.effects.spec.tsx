/** @vitest-environment jsdom */

import '../globals.css';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampCursorPosition, ContextCursor } from './ContextCursor';

describe('context cursor behavior', () => {
  let container: HTMLDivElement;
  let fixture: HTMLDivElement;
  let root: Root;
  let plainTarget: HTMLButtonElement;
  let semanticTarget: HTMLButtonElement;

  const cursor = () => container.querySelector<HTMLElement>('.context-cursor')!;
  const movePointer = (target: Element, clientX = 160, clientY = 120) => {
    target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
  };

  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal('innerWidth', 320);
    vi.stubGlobal('innerHeight', 240);
    container = document.createElement('div');
    fixture = document.createElement('div');
    plainTarget = document.createElement('button');
    semanticTarget = document.createElement('button');
    semanticTarget.dataset.cursor = 'photo';
    fixture.append(plainTarget, semanticTarget);
    document.body.append(container, fixture);
    root = createRoot(container);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    fixture.remove();
    vi.unstubAllGlobals();
  });

  const renderCursor = async () => {
    await act(async () => root.render(<ContextCursor />));
  };

  it('stays hidden by default and over ordinary targets, then labels only semantic hover', async () => {
    await renderCursor();

    expect(cursor().classList.contains('context-cursor--visible')).toBe(false);
    expect(window.getComputedStyle(cursor()).visibility).toBe('hidden');

    act(() => movePointer(plainTarget));
    expect(cursor().classList.contains('context-cursor--visible')).toBe(false);
    expect(window.getComputedStyle(cursor()).visibility).toBe('hidden');

    act(() => movePointer(semanticTarget));
    expect(cursor().classList.contains('context-cursor--visible')).toBe(true);
    expect(window.getComputedStyle(cursor()).visibility).toBe('visible');
    expect(cursor().textContent).toBe('Ver');
  });

  it('hides after semantic leave, scroll, window blur, and pointer exit', async () => {
    await renderCursor();
    const show = () => {
      act(() => movePointer(semanticTarget));
      expect(cursor().classList.contains('context-cursor--visible')).toBe(true);
    };
    const expectHidden = () =>
      expect(cursor().classList.contains('context-cursor--visible')).toBe(false);

    show();
    act(() => {
      semanticTarget.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: plainTarget }),
      );
    });
    expectHidden();

    show();
    act(() => window.dispatchEvent(new Event('scroll')));
    expectHidden();

    show();
    act(() => window.dispatchEvent(new Event('blur')));
    expectHidden();

    show();
    act(() => {
      semanticTarget.dispatchEvent(
        new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }),
      );
    });
    expectHidden();
  });

  it('reflects clamped expanded-cursor coordinates at viewport edges', async () => {
    await renderCursor();

    act(() => movePointer(semanticTarget, -20, -40));
    expect(cursor().style.transform).toBe('translate3d(4px, 4px, 0)');

    act(() => movePointer(semanticTarget, 400, 300));
    expect(cursor().style.transform).toBe('translate3d(264px, 184px, 0)');
  });
});

describe('context cursor viewport bounds', () => {
  it('keeps the expanded semantic cursor fully inside every viewport edge', () => {
    expect(clampCursorPosition(-20, -40, 320, 240)).toEqual({ x: 30, y: 30 });
    expect(clampCursorPosition(400, 300, 320, 240)).toEqual({ x: 290, y: 210 });
    expect(clampCursorPosition(160, 120, 320, 240)).toEqual({ x: 160, y: 120 });
  });
});
