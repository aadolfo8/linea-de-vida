import { useCallback, useRef, useState, type RefObject } from 'react';
import {
  IDENTITY,
  clampView,
  zoomAround,
  type Size,
  type StageBox,
  type View,
} from './viewer-zoom';

export const EASE = 'cubic-bezier(.22,1,.36,1)';

/**
 * The zoom and pan of the photo frame. The view lives in a ref and is written straight to the
 * frame's transform (no React render per gesture frame); only the rounded percentage is state.
 */
export function useViewerZoom(
  frame: RefObject<HTMLElement | null>,
  reduceMotion: boolean,
  initialStage: StageBox,
) {
  const [zoomPercent, setZoomPercent] = useState(100);
  const viewRef = useRef<View>(IDENTITY);
  const stageRef = useRef<StageBox>(initialStage);
  const fitRef = useRef<Size>({ width: 1, height: 1 });
  const naturalRef = useRef<Size | null>(null);

  const writeView = useCallback(
    (next: View, animate = false) => {
      const clamped = clampView(next, fitRef.current, stageRef.current);
      viewRef.current = clamped;
      const element = frame.current;
      if (element) {
        element.style.transition = animate && !reduceMotion ? `transform .35s ${EASE}` : 'none';
        element.style.transform = `translate3d(${clamped.x}px,${clamped.y}px,0) scale(${clamped.scale})`;
      }
      setZoomPercent(Math.round(clamped.scale * 100));
    },
    [frame, reduceMotion],
  );

  /** A pointer position relative to the centre of the stage. */
  const pointOf = (clientX: number, clientY: number) => ({
    x: clientX - stageRef.current.width / 2,
    y: clientY - (stageRef.current.top + stageRef.current.height / 2),
  });

  const zoomTo = useCallback(
    (scale: number, point = { x: 0, y: 0 }, animate = true) => {
      writeView(
        zoomAround(viewRef.current, scale, point, fitRef.current, stageRef.current),
        animate,
      );
    },
    [writeView],
  );

  const panBy = useCallback(
    (x: number, y: number) => {
      const view = viewRef.current;
      writeView({ ...view, x: view.x + x, y: view.y + y }, true);
    },
    [writeView],
  );

  return { zoomPercent, viewRef, stageRef, fitRef, naturalRef, writeView, zoomTo, panBy, pointOf };
}
