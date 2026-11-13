import { useEffect, useRef, useState } from 'react';

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

const cursorLabel: Record<CursorState, string> = { photo: 'Ver', route: 'Ir', action: 'Abrir' };

function isCursorState(value: string | undefined): value is CursorState {
  return value === 'photo' || value === 'route' || value === 'action';
}

export function ContextCursor() {
  const [enabled, setEnabled] = useState(false);
  const element = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(pointer: fine) and (prefers-reduced-motion: no-preference)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // The cursor follows the pointer by writing straight to the DOM: no React render per move.
    let shown: CursorState | null = null;
    const hide = () => {
      if (shown === null) return;
      shown = null;
      element.current?.classList.remove('context-cursor--visible');
    };
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
      const node = element.current;
      if (!node || !isCursorState(nextState)) {
        hide();
        return;
      }
      if (nextState !== shown) {
        node.className = `context-cursor context-cursor--${nextState} context-cursor--visible`;
        if (label.current) label.current.textContent = cursorLabel[nextState];
        shown = nextState;
      }
      const { x, y } = clampCursorPosition(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      );
      node.style.transform = `translate3d(${x - expandedCursorSize / 2}px, ${y - expandedCursorSize / 2}px, 0)`;
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
      ref={element}
      aria-hidden="true"
      className="context-cursor context-cursor--action"
      style={{
        transform: `translate3d(${-expandedCursorSize / 2}px, ${-expandedCursorSize / 2}px, 0)`,
      }}
    >
      <span ref={label}>{cursorLabel.action}</span>
    </span>
  );
}
