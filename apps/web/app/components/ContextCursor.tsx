'use client';

import { useEffect, useState } from 'react';

type CursorState = 'default' | 'photo' | 'route' | 'action';

export function ContextCursor() {
  const [enabled, setEnabled] = useState(false);
  const [state, setState] = useState<CursorState>('default');
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
    const move = (event: PointerEvent) => setPosition({ x: event.clientX, y: event.clientY });
    const over = (event: PointerEvent) => {
      const target =
        event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cursor]') : null;
      setState((target?.dataset.cursor as CursorState | undefined) ?? 'default');
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerover', over, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerover', over);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <span
      aria-hidden="true"
      className={`context-cursor context-cursor--${state}`}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    >
      <span>
        {state === 'photo' ? 'Ver' : state === 'route' ? 'Ir' : state === 'action' ? 'Abrir' : ''}
      </span>
    </span>
  );
}
