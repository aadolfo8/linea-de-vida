'use client';

import { useReducedMotion } from '../../../lib/use-reduced-motion';
import { createPortal } from 'react-dom';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { SkyOrientation } from './orientation';
import { isBrowserChromeResize, isCoarsePointer } from './viewport';
import { SkyEngine, type SkyFrame, type SkyItem } from './sky-engine';
import { registerSkyStage } from './sky-registry';
import './sky.css';

type SkyContextValue = {
  engine: SkyEngine;
  orientation: SkyOrientation;
  setOrientation: (orientation: SkyOrientation) => void;
  viewport: { width: number; height: number };
  reduced: boolean;
  worldRef: RefObject<HTMLDivElement | null>;
  trackRef: RefObject<HTMLDivElement | null>;
  /** Fixed layer above the moving track, for chrome that must not travel with it. */
  overlayNode: HTMLDivElement | null;
};

const SkyContext = createContext<SkyContextValue | null>(null);

export function useSky() {
  const context = useContext(SkyContext);
  if (!context) throw new Error('The sky requires a SkyStage.');
  return context;
}

/** Registers an element on the track and exposes its measured offsets (never transformed rects). */
export function useSkyItem<T extends HTMLElement>(key: string | null = null) {
  const { engine } = useSky();
  const ref = useRef<T>(null);
  const itemRef = useRef<SkyItem | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { item, release } = engine.register(element, key);
    itemRef.current = item;
    return () => {
      itemRef.current = null;
      release();
    };
  }, [engine, key]);
  return { ref, itemRef };
}

/** Per-frame callback with the track position; keep it imperative, it runs every frame. */
export function useSkyFrame(callback: (frame: SkyFrame) => void) {
  const { engine } = useSky();
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  useEffect(() => engine.subscribe((frame) => latest.current(frame)), [engine]);
}

/** Runs after the engine re-measured the items, e.g. to rebuild the thread. */
export function useSkyMeasure(callback: () => void) {
  const { engine } = useSky();
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  useEffect(() => engine.onMeasure(() => latest.current()), [engine]);
}

/** Renders fixed chrome (rail, hint) from inside a depth, outside the transformed track. */
export function SkyOverlay({ children }: { children: ReactNode }) {
  const { overlayNode } = useSky();
  return overlayNode ? createPortal(children, overlayNode) : null;
}

const readViewport = () =>
  typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight };

export function SkyStage({
  orientation,
  onOrientationChange,
  label,
  overlay,
  children,
}: {
  orientation: SkyOrientation;
  onOrientationChange: (orientation: SkyOrientation) => void;
  label: string;
  /** Fixed chrome (bar, rail, hint) that lives outside the moving track. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const [engine] = useState(() => new SkyEngine());
  const reduced = useReducedMotion() ?? false;
  const [viewport, setViewport] = useState(readViewport);
  const [overlayNode, setOverlayNode] = useState<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    const world = worldRef.current;
    const track = trackRef.current;
    if (!scroller || !canvas || !world || !track) return;
    engine.configure({ orientation, reduced });
    engine.attach({ scroller, canvas, world, track });
    const unregister = registerSkyStage({ engine, world });
    return () => {
      unregister();
      engine.detach();
    };
    // Orientation and motion changes are applied by the effect below.
  }, [engine]);

  useLayoutEffect(() => {
    engine.configure({ orientation, reduced });
  }, [engine, orientation, reduced, viewport]);

  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () =>
          setViewport((previous) => {
            const next = readViewport();
            return isBrowserChromeResize(previous, next, isCoarsePointer()) ? previous : next;
          }),
        150,
      );
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const value = useMemo<SkyContextValue>(
    () => ({
      engine,
      orientation,
      setOrientation: onOrientationChange,
      viewport,
      reduced,
      worldRef,
      trackRef,
      overlayNode,
    }),
    [engine, onOrientationChange, orientation, overlayNode, reduced, viewport],
  );

  return (
    <SkyContext.Provider value={value}>
      <div className="sky" data-orientation={orientation} data-reduced={reduced ? 'true' : 'false'}>
        <main
          ref={scrollerRef}
          id="timeline-main"
          tabIndex={-1}
          className="sky-scroller"
          aria-label={label}
        >
          <div className="sky-sticky">
            <canvas ref={canvasRef} className="sky-canvas" aria-hidden="true" />
            <div ref={worldRef} className="sky-world">
              <div ref={trackRef} className="sky-track">
                {children}
              </div>
            </div>
          </div>
        </main>
        <div ref={setOverlayNode} className="sky-overlay">
          {overlay}
        </div>
      </div>
    </SkyContext.Provider>
  );
}
