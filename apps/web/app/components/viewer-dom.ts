import type { KeyboardEvent } from 'react';
import { wrappedFocusIndex } from './timeline-model';
import type { Size } from './viewer-zoom';

export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export const readStage = (): Size =>
  typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight };

export const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Keeps Tab inside the dialog: wraps from the last control to the first and back. */
export function trapTab(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement | null) {
  const focusable = [...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])].filter(
    (element) => element.tabIndex >= 0,
  );
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const atBoundary = event.shiftKey
    ? currentIndex <= 0
    : currentIndex === -1 || currentIndex === focusable.length - 1;
  if (!atBoundary) return;
  event.preventDefault();
  const nextIndex = wrappedFocusIndex(currentIndex, focusable.length, event.shiftKey);
  if (nextIndex >= 0) focusable[nextIndex]!.focus();
  else dialog?.focus();
}
