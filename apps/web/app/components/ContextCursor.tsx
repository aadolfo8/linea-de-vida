'use client';

import { useEffect, useState } from 'react';

type CursorState = 'photo' | 'route' | 'action';

const expandedCursorSize = 52;
const cursorViewportInset = 4;

export function clampCursorPosition(x: number, y: number, width: number, height: number) {
  const radius = expandedCursorSize / 2 + cursorViewportInset;
  return {
    x: Math.min(Math.max(x, radius), Math.max(radius, width - radius)),
    y: Math.min(Math.max(y, radius), Math.max(radius, height - radius)),
  };
}

function isCursorState(value: string | undefined): value is CursorState {
  return value === 'photo' || value === 'route' || value === 'action';
}

export function ContextCursor() {
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<CursorState>('action');
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const query = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const hide = () => setVisible(false);
    const leave = (event: PointerEvent) => {
      const related =
        event.relatedTarget instanceof Element
          ? event.relatedTarget.closest<HTMLElement>('[data-cursor]')
          : null;
      if (!related) hide();
    };
    const move = (event: PointerEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cursor]') : null;
      const nextState = target?.dataset.cursor;
      if (!isCursorState(nextState)) {
        hide();
        return;
      }
      setState(nextState);
      setPosition(
        clampCursorPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight),
      );
      setVisible(true);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('blur', hide);
    window.addEventListener('pointerout', leave, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('scroll', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('pointerout', leave);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <span
      aria-hidden="true"
      className={`context-cursor context-cursor--${state}${visible ? ' context-cursor--visible' : ''}`}
      style={{
        transform: `translate3d(${position.x - expandedCursorSize / 2}px, ${position.y - expandedCursorSize / 2}px, 0)`,
      }}
    >
      <span>{state === 'photo' ? 'Ver' : state === 'route' ? 'Ir' : 'Abrir'}</span>
    </span>
  );
}
