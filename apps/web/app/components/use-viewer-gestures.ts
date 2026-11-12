import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { gap } from './viewer-dom';
import {
  doubleTapScale,
  isZoomed,
  wheelScale,
  zoomAround,
  type Size,
  type StageBox,
  type View,
} from './viewer-zoom';

const SWIPE_DISTANCE = 70;
const DISMISS_DISTANCE = 110;
const TAP_SLOP = 8;
const DOUBLE_TAP_WINDOW = 320;

type Gesture = {
  mode: 'pan' | 'swipe' | 'pinch';
  startX: number;
  startY: number;
  view: View;
  distance: number;
  axis: 'x' | 'y' | null;
  moved: boolean;
  onStage: boolean;
};

type ZoomApi = {
  viewRef: RefObject<View>;
  stageRef: RefObject<StageBox>;
  fitRef: RefObject<Size>;
  writeView: (next: View, animate?: boolean) => void;
  zoomTo: (scale: number, point?: { x: number; y: number }, animate?: boolean) => void;
  pointOf: (clientX: number, clientY: number) => { x: number; y: number };
};

/**
 * Pointer, touch and wheel gestures on the photo stage: drag to pan when zoomed, swipe to change
 * photo or pull down to close, pinch and wheel to zoom, double tap / double click to toggle zoom.
 */
export function useViewerGestures({
  frame,
  stageEl,
  view: { viewRef, stageRef, fitRef, writeView, zoomTo, pointOf },
  poke,
  step,
  requestClose,
}: {
  frame: RefObject<HTMLElement | null>;
  stageEl: RefObject<HTMLElement | null>;
  view: ZoomApi;
  poke: (keyboard?: boolean) => void;
  step: (direction: -1 | 1) => void;
  requestClose: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchToggledAt = useRef(0);

  // Wheel and trackpad pinch zoom around the pointer; React's wheel listener is passive.
  useEffect(() => {
    const element = stageEl.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      poke();
      const view = viewRef.current;
      zoomTo(
        wheelScale(view.scale, event.deltaY, event.ctrlKey, event.deltaMode),
        pointOf(event.clientX, event.clientY),
        false,
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [poke, zoomTo]);

  const beginGesture = (pointerId: number): Gesture | null => {
    const first = pointers.current.get(pointerId);
    if (!first) return null;
    return {
      mode: isZoomed(viewRef.current) ? 'pan' : 'swipe',
      startX: first.x,
      startY: first.y,
      view: viewRef.current,
      distance: 0,
      axis: null,
      moved: false,
      onStage: false,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; the gesture still works without it.
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      const next = beginGesture(event.pointerId);
      if (next) gesture.current = { ...next, onStage: event.target === event.currentTarget };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        mode: 'pinch',
        startX: 0,
        startY: 0,
        view: viewRef.current,
        distance: Math.max(1, gap(a!, b!)),
        axis: null,
        moved: true,
        onStage: false,
      };
    }
    setDragging(gesture.current?.mode === 'pan');
  };

  const dragFrame = (x: number, y: number, fade: number) => {
    const element = frame.current;
    if (!element) return;
    element.style.transition = 'none';
    element.style.transform = `translate3d(${x}px,${y}px,0) scale(${1 - Math.min(0.2, y / 1200)})`;
    element.style.opacity = String(fade);
  };
  const settleFrame = () => {
    const element = frame.current;
    if (!element) return;
    element.style.opacity = '';
    writeView(viewRef.current, true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    poke();
    const active = gesture.current;
    if (!active || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const middle = pointOf((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      writeView(
        zoomAround(
          active.view,
          active.view.scale * (gap(a!, b!) / active.distance),
          middle,
          fitRef.current,
          stageRef.current,
        ),
      );
      return;
    }
    if (Math.hypot(dx, dy) > TAP_SLOP) active.moved = true;
    if (active.mode === 'pan') {
      writeView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
      return;
    }
    if (!active.axis && Math.hypot(dx, dy) > TAP_SLOP)
      active.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    if (active.axis === 'x') dragFrame(dx * 0.6, 0, 1 - Math.min(0.5, Math.abs(dx) / 600));
    else if (active.axis === 'y')
      dragFrame(dx * 0.2, Math.max(0, dy) * 0.6, 1 - Math.min(0.5, Math.max(0, dy) / 500));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    setDragging(false);
    if (active?.mode === 'swipe') {
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      if (active.axis === 'x' && Math.abs(dx) > SWIPE_DISTANCE && event.type === 'pointerup') {
        settleFrame();
        step(dx < 0 ? 1 : -1);
      } else if (active.axis === 'y' && dy > DISMISS_DISTANCE && event.type === 'pointerup') {
        settleFrame();
        requestClose();
      } else if (active.axis) {
        settleFrame();
      } else if (!active.moved && event.type === 'pointerup') {
        const now = Date.now();
        const previous = lastTap.current;
        if (
          event.pointerType !== 'mouse' &&
          previous &&
          now - previous.time < DOUBLE_TAP_WINDOW &&
          Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 30
        ) {
          lastTap.current = null;
          touchToggledAt.current = now;
          zoomTo(doubleTapScale(viewRef.current), pointOf(event.clientX, event.clientY));
        } else {
          lastTap.current = { time: now, x: event.clientX, y: event.clientY };
          if (active.onStage && event.pointerType === 'mouse') requestClose();
        }
      }
    }
    const [rest] = [...pointers.current.entries()];
    if (rest) {
      const next = beginGesture(rest[0]);
      gesture.current = next ? { ...next, moved: true } : null;
    } else gesture.current = null;
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    // A double tap already toggled; browsers may still report it as a double click.
    if (Date.now() - touchToggledAt.current < 500) return;
    zoomTo(doubleTapScale(viewRef.current), pointOf(event.clientX, event.clientY));
  };

  return { dragging, onPointerDown, onPointerMove, onPointerUp, onDoubleClick };
}
