'use client';

import { Minus, Plus, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';
import { api } from '../../lib/api';
import { mediaUrl, thumbnailVariantUrl } from '../../lib/media';
import './photo-viewer.css';
import {
  photoDateLabel,
  photoPrecisionLabel,
  wrappedFocusIndex,
  type TimelinePhoto,
  type TimelinePhotoPage,
} from './timeline-model';
import {
  BUTTON_ZOOM_STEP,
  IDENTITY,
  KEY_PAN_STEP,
  KEY_ZOOM_STEP,
  clampView,
  doubleTapScale,
  fitSize,
  flipTransform,
  isRectVisible,
  isZoomed,
  stageBox,
  wheelScale,
  zoomAround,
  type Size,
  type StageBox,
  type View,
} from './viewer-zoom';

const focusableSelector =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const EASE = 'cubic-bezier(.22,1,.36,1)';
/** Chrome fades away after this long without pointer or keyboard activity. */
const IDLE_DELAY = 2600;
const OPEN_DURATION = 520;
const CLOSE_DURATION = 380;
const SWIPE_DISTANCE = 70;
const DISMISS_DISTANCE = 110;
const TAP_SLOP = 8;
const DOUBLE_TAP_WINDOW = 320;
const ORIGINAL_MIME = /^image\/(jpeg|png|webp|gif)$/i;

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const readStage = (): Size =>
  typeof window === 'undefined'
    ? { width: 1280, height: 800 }
    : { width: window.innerWidth, height: window.innerHeight };

/** Where the viewer grows from and shrinks back to: the tile the photo was opened from. */
export type ViewerSource = {
  /** On-screen rect of that photo's tile, or null when it is not visible. */
  rectOf: (
    photoId: string,
  ) => Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'> | null;
  /** Gives focus back to that tile; false when it is gone. */
  focusTile?: (photoId: string) => boolean;
};

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

const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function TimelinePhotoViewer({
  photos,
  initialIndex,
  total,
  loadMore,
  source,
  onPhotoChange,
  onClose,
}: {
  photos: TimelinePhoto[];
  initialIndex: number;
  /** How many photos the period holds, when known; the counter shows it instead of the loaded count. */
  total?: number | null;
  loadMore?: () => Promise<TimelinePhotoPage | null>;
  source?: ViewerSource;
  /** The photo on display changed (not called for the one it opened on). */
  onPhotoChange?: (photoId: string) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const [loadedPhotos, setLoadedPhotos] = useState(photos);
  const [hasMore, setHasMore] = useState(Boolean(loadMore));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [index, setIndex] = useState(initialIndex);
  const [pendingAdvance, setPendingAdvance] = useState<number | null>(null);
  const [stage, setStage] = useState<StageBox>(() => ({ ...readStage(), top: 0 }));
  const [measured, setMeasured] = useState<{ id: string; width: number; height: number } | null>(
    null,
  );
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const [closing, setClosing] = useState(false);

  const backdrop = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLElement>(null);
  const metaEl = useRef<HTMLDivElement>(null);
  const toolsEl = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const loadingMoreRef = useRef(false);
  const viewRef = useRef<View>(IDENTITY);
  const stageRef = useRef<StageBox>(stage);
  const fitRef = useRef<Size>({ width: 1, height: 1 });
  const naturalRef = useRef<Size | null>(null);
  const direction = useRef<-1 | 0 | 1>(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchToggledAt = useRef(0);
  const closingRef = useRef(false);
  const idleTimer = useRef(0);
  const overChrome = useRef(false);
  const keyboardInput = useRef(false);
  const preloaded = useRef(new Set<string>());
  const currentId = useRef<string | undefined>(undefined);
  const sourceRef = useRef(source);
  const onCloseRef = useRef(onClose);
  const onPhotoChangeRef = useRef(onPhotoChange);
  useLayoutEffect(() => {
    sourceRef.current = source;
    onCloseRef.current = onClose;
    onPhotoChangeRef.current = onPhotoChange;
  });

  const selected = loadedPhotos[index];
  const [shownState, setShownState] = useState<Shown | null>(null);
  const shown = selected
    ? shownState?.id === selected.id
      ? shownState
      : freshShown(selected)
    : null;
  const updateShown = (change: Partial<Shown>) => {
    if (selected) setShownState({ ...shown!, ...change });
  };
  const natural =
    selected?.dimensions ?? (selected && measured?.id === selected.id ? measured : null);
  const fit = fitSize(natural, stage);
  useLayoutEffect(() => {
    stageRef.current = stage;
    fitRef.current = fit;
    naturalRef.current = natural;
    currentId.current = selected?.id;
  });

  const openedOn = useRef(selected?.id);
  useEffect(() => {
    if (selected && selected.id !== openedOn.current) onPhotoChangeRef.current?.(selected.id);
  }, [selected]);

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
    [reduceMotion],
  );

  // A new fit (resize, or the real size of the photo arriving) re-clamps the current view.
  useLayoutEffect(() => {
    writeView(viewRef.current);
  }, [fit.width, fit.height, stage.width, stage.height, writeView]);

  // The photo is fitted into the band between the top meta block and the filmstrip, measured
  // from the real layout so it never overlaps either (they wrap differently per screen).
  const measureStage = useCallback(() => {
    const viewport = readStage();
    const strips = strip.current?.getBoundingClientRect();
    const metaBottom = metaEl.current?.getBoundingClientRect().bottom ?? 0;
    const toolsBottom = toolsEl.current?.getBoundingClientRect().bottom ?? 0;
    let next: StageBox = { ...viewport, top: 0 };
    if (strips && strips.height > 0 && Math.max(metaBottom, toolsBottom) > 0) {
      const padding = parseFloat(window.getComputedStyle(strip.current!).paddingTop) || 0;
      next = stageBox(viewport, Math.max(metaBottom, toolsBottom) + 8, strips.top + padding - 10);
    }
    // The grow-from-tile effect runs in this same commit, before the re-render: give it the band.
    stageRef.current = next;
    fitRef.current = fitSize(naturalRef.current, next);
    setStage((current) =>
      current.width === next.width && current.height === next.height && current.top === next.top
        ? current
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    measureStage();
    window.addEventListener('resize', measureStage);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureStage);
    for (const element of [metaEl.current, toolsEl.current, strip.current])
      if (element) observer?.observe(element);
    return () => {
      window.removeEventListener('resize', measureStage);
      observer?.disconnect();
    };
  }, [measureStage]);

  // Idle chrome: it fades after a still moment, but never from under a keyboard user.
  const poke = useCallback((keyboard = false) => {
    keyboardInput.current = keyboard;
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      const active = document.activeElement;
      const focusInChrome =
        active instanceof HTMLElement &&
        active !== dialog.current &&
        dialog.current?.contains(active);
      if (overChrome.current || (keyboardInput.current && focusInChrome)) return;
      setIdle(true);
    }, IDLE_DELAY);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(idleTimer.current);
  }, [poke]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const hidden: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    const hiddenElements = new Set<HTMLElement>();
    let current: HTMLElement | null = backdrop.current;

    while (current?.parentElement) {
      const parent = current.parentElement;
      for (const sibling of parent.children) {
        if (sibling === current || !(sibling instanceof HTMLElement) || hiddenElements.has(sibling))
          continue;
        hiddenElements.add(sibling);
        hidden.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.inert = true;
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (parent === document.body) break;
      current = parent;
    }

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusFirst = () => {
      const first =
        closeButton.current ?? dialog.current?.querySelector<HTMLElement>(focusableSelector);
      if (first) first.focus({ preventScroll: true });
      else dialog.current?.focus();
    };
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target)) focusFirst();
    };
    focusFirst();
    document.addEventListener('focusin', containFocus);

    return () => {
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      hidden.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      const photoId = currentId.current;
      const refocused = photoId ? sourceRef.current?.focusTile?.(photoId) : false;
      if (!refocused && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // The photo grows out of its tile.
  useLayoutEffect(() => {
    const element = frame.current;
    const photoId = currentId.current;
    const rect = photoId ? sourceRef.current?.rectOf(photoId) : null;
    if (!element || !rect || reduceMotion || typeof element.animate !== 'function') return;
    if (!isRectVisible(rect, readStage())) return;
    const from = flipTransform(rect, fitRef.current, stageRef.current, stageRef.current.top);
    element.animate(
      [
        { transform: `translate3d(${from.x}px,${from.y}px,0) scale(${from.scale})` },
        { transform: 'translate3d(0,0,0) scale(1)' },
      ],
      { duration: OPEN_DURATION, easing: EASE },
    );
    // Only the first paint grows from the tile.
  }, []);

  const fetchNextPage = useCallback(async () => {
    if (!loadMore || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const page = await loadMore();
      if (!page) {
        setLoadMoreError(true);
        return;
      }
      setLoadedPhotos((current) => {
        const currentIds = new Set(current.map((photo) => photo.id));
        return [...current, ...page.items.filter((photo) => !currentIds.has(photo.id))];
      });
      setHasMore(Boolean(page.nextCursor));
    } catch {
      setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, loadMore]);

  useEffect(() => {
    setLoadedPhotos((current) => {
      if (photos.length <= current.length) return current;
      const currentIds = new Set(current.map((photo) => photo.id));
      return [...current, ...photos.filter((photo) => !currentIds.has(photo.id))];
    });
  }, [photos]);

  useEffect(() => {
    if (!loadMoreError && hasMore && loadedPhotos.length - index <= 5) void fetchNextPage();
  }, [fetchNextPage, hasMore, index, loadMoreError, loadedPhotos.length]);

  const select = useCallback((next: number, step: -1 | 1) => {
    direction.current = step;
    setIndex(next);
  }, []);

  useEffect(() => {
    if (pendingAdvance === null || pendingAdvance >= loadedPhotos.length) return;
    select(pendingAdvance, 1);
    setPendingAdvance(null);
  }, [loadedPhotos.length, pendingAdvance, select]);

  /** Moves one photo along, never wrapping; at the loaded end it waits for the next page. */
  const step = useCallback(
    (delta: -1 | 1) => {
      if (delta < 0) {
        if (index > 0) select(index - 1, -1);
      } else if (index < loadedPhotos.length - 1) select(index + 1, 1);
      else if (hasMore) {
        setPendingAdvance(loadedPhotos.length);
        void fetchNextPage();
      }
    },
    [fetchNextPage, hasMore, index, loadedPhotos.length, select],
  );

  // Every photo starts at fit; the new one slides in from the side it came from.
  useLayoutEffect(() => {
    writeView(IDENTITY);
    const element = frame.current;
    const slide = direction.current;
    direction.current = 0;
    if (!slide || reduceMotion || !element || typeof element.animate !== 'function') return;
    element.animate(
      [
        { opacity: 0, transform: `translate3d(${slide * 40}px,0,0)` },
        { opacity: 1, transform: 'translate3d(0,0,0)' },
      ],
      { duration: 320, easing: EASE },
    );
  }, [index, reduceMotion, writeView]);

  // Neighbours are fetched ahead of time, thumbnails and originals alike.
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    for (const offset of [1, -1, 2]) {
      const neighbour = loadedPhotos[index + offset];
      if (!neighbour) continue;
      const urls = [thumbnailVariantUrl(api, neighbour.thumbnailUrl, 1280)];
      if (ORIGINAL_MIME.test(neighbour.mimeType))
        urls.push(mediaUrl(api, `/v1/photos/${neighbour.id}/content`));
      for (const url of urls) {
        if (preloaded.current.has(url)) continue;
        preloaded.current.add(url);
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
      }
    }
  }, [index, loadedPhotos]);

  // The filmstrip keeps the current photo in view.
  useEffect(() => {
    const element = strip.current;
    const current = element?.children[index];
    if (!element || !(current instanceof HTMLElement)) return;
    const left = current.offsetLeft - element.clientWidth / 2 + current.clientWidth / 2;
    if (typeof element.scrollTo === 'function')
      element.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
    else element.scrollLeft = left;
  }, [index, loadedPhotos.length, reduceMotion]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const element = frame.current;
    const photoId = currentId.current;
    const rect = photoId ? sourceRef.current?.rectOf(photoId) : null;
    const finish = () => {
      closingRef.current = false;
      onCloseRef.current();
    };
    if (
      !element ||
      !rect ||
      reduceMotion ||
      isZoomed(viewRef.current) ||
      typeof element.animate !== 'function' ||
      !isRectVisible(rect, readStage())
    ) {
      finish();
      return;
    }
    setClosing(true);
    const to = flipTransform(rect, fitRef.current, stageRef.current, stageRef.current.top);
    const from = viewRef.current;
    const animation = element.animate(
      [
        { transform: `translate3d(${from.x}px,${from.y}px,0) scale(${from.scale})` },
        { transform: `translate3d(${to.x}px,${to.y}px,0) scale(${to.scale})` },
      ],
      { duration: CLOSE_DURATION, easing: EASE, fill: 'forwards' },
    );
    animation.finished.then(finish, finish);
  }, [reduceMotion]);

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

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A double tap already toggled; browsers may still report it as a double click.
    if (Date.now() - touchToggledAt.current < 500) return;
    zoomTo(doubleTapScale(viewRef.current), pointOf(event.clientX, event.clientY));
  };

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    poke(true);
    if (event.key === 'Tab') {
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []),
      ].filter((element) => element.tabIndex >= 0);
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const atBoundary = event.shiftKey
        ? currentIndex <= 0
        : currentIndex === -1 || currentIndex === focusable.length - 1;
      if (atBoundary) {
        event.preventDefault();
        const nextIndex = wrappedFocusIndex(currentIndex, focusable.length, event.shiftKey);
        if (nextIndex >= 0) focusable[nextIndex]!.focus();
        else dialog.current?.focus();
      }
      return;
    }
    if (isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const zoomed = isZoomed(viewRef.current);
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        if (zoomed) zoomTo(1);
        else requestClose();
        break;
      case 'Backspace':
        event.preventDefault();
        requestClose();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (zoomed) panBy(KEY_PAN_STEP, 0);
        else step(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (zoomed) panBy(-KEY_PAN_STEP, 0);
        else step(1);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!zoomed) break;
        event.preventDefault();
        panBy(0, event.key === 'ArrowUp' ? KEY_PAN_STEP : -KEY_PAN_STEP);
        break;
      case '+':
      case '=':
        event.preventDefault();
        zoomTo(viewRef.current.scale * KEY_ZOOM_STEP);
        break;
      case '-':
      case '_':
        event.preventDefault();
        zoomTo(viewRef.current.scale / KEY_ZOOM_STEP);
        break;
      case '0':
        event.preventDefault();
        zoomTo(1);
        break;
    }
  };

  if (!selected) return null;
  const isDownloadOnly = /^image\/(heic|heif)$/i.test(selected.mimeType);
  const zoomed = zoomPercent > 101;
  const count = Math.max(total ?? 0, loadedPhotos.length);
  const precision = photoPrecisionLabel(selected);
  const ambient = thumbnailVariantUrl(api, selected.thumbnailUrl, 640).replace(/["\\]/g, '');
  const keepVisible = {
    onPointerEnter: () => {
      overChrome.current = true;
    },
    onPointerLeave: () => {
      overChrome.current = false;
    },
  };

  return (
    <div
      ref={backdrop}
      className="pv"
      data-idle={idle}
      data-closing={closing}
      onPointerMove={() => poke()}
    >
      <div className="pv-amb" style={{ backgroundImage: `url("${ambient}")` }} aria-hidden="true" />
      <section
        ref={dialog}
        className="pv-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Vista ampliada de ${selected.fileName}`}
        tabIndex={-1}
        onKeyDown={keyDown}
      >
        <div
          ref={stageEl}
          className="pv-stage"
          style={{ top: stage.top, height: stage.height }}
          data-zoomed={zoomed}
          data-dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <div ref={frame} className="pv-frame" style={{ width: fit.width, height: fit.height }}>
            <ViewerImage
              photo={selected}
              shown={shown!}
              onLoad={(width, height) => {
                updateShown({ status: 'ready' });
                if (width > 0 && height > 0) setMeasured({ id: selected.id, width, height });
              }}
              onError={() =>
                shown!.variant === 'original'
                  ? updateShown({ variant: 'thumbnail', status: 'loading', fallback: true })
                  : updateShown({ status: 'error' })
              }
            />
          </div>
        </div>

        <header className="pv-top pv-ui" {...keepVisible}>
          <div ref={metaEl} className="pv-meta">
            <p className="pv-date">{photoDateLabel(selected)}</p>
            <p className="pv-folder">
              <span className="pv-file">{selected.fileName}</span>
              {precision && <em className="pv-chip">{precision}</em>}
            </p>
          </div>
          <div ref={toolsEl} className="pv-tools">
            <span className="pv-count" aria-live="polite">
              {(index + 1).toLocaleString('es-ES')} / {count.toLocaleString('es-ES')}
            </span>
            <button
              type="button"
              className="pv-btn"
              aria-label="Alejar"
              disabled={zoomPercent <= 100}
              onClick={() => zoomTo(viewRef.current.scale / BUTTON_ZOOM_STEP)}
            >
              <Minus aria-hidden="true" />
            </button>
            <output className="pv-zoom" aria-label="Zoom">
              {zoomPercent}%
            </output>
            <button
              type="button"
              className="pv-btn"
              aria-label="Acercar"
              onClick={() => zoomTo(viewRef.current.scale * BUTTON_ZOOM_STEP)}
            >
              <Plus aria-hidden="true" />
            </button>
            <button
              ref={closeButton}
              type="button"
              className="pv-btn"
              aria-label="Cerrar visor"
              onClick={requestClose}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </header>

        <button
          type="button"
          className="pv-btn pv-nav pv-ui"
          data-side="prev"
          aria-label="Foto anterior"
          disabled={index === 0}
          onClick={() => step(-1)}
          {...keepVisible}
        >
          <ArrowIcon direction="left" />
        </button>
        <button
          type="button"
          className="pv-btn pv-nav pv-ui"
          data-side="next"
          aria-label="Foto siguiente"
          disabled={index === loadedPhotos.length - 1 && !hasMore}
          onClick={() => step(1)}
          {...keepVisible}
        >
          <ArrowIcon direction="right" />
        </button>

        <div className="pv-notes">
          {shown!.status === 'loading' && (
            <p className="pv-note" role="status" aria-live="polite">
              {shown!.variant === 'original'
                ? 'Cargando fotografía en alta calidad…'
                : 'Cargando fotografía…'}
            </p>
          )}
          {shown!.status === 'ready' && shown!.fallback && (
            <p className="pv-note" role="status" aria-live="polite">
              El original no se pudo cargar; se muestra la miniatura.
            </p>
          )}
          {shown!.status === 'error' && (
            <div className="pv-note" role="alert">
              <p>No se pudo cargar la fotografía.</p>
              <button
                type="button"
                onClick={() => updateShown({ status: 'loading', retry: shown!.retry + 1 })}
              >
                Reintentar miniatura
              </button>
            </div>
          )}
          {isDownloadOnly && (
            <p className="pv-note pv-ui" {...keepVisible}>
              <span>Este formato se muestra con una vista previa.</span>
              <a href={mediaUrl(api, `/v1/photos/${selected.id}/content`)}>Descargar original</a>
            </p>
          )}
          {loadingMore && (
            <p className="pv-note" role="status" aria-live="polite">
              Cargando más fotografías…
            </p>
          )}
          {loadMoreError && (
            <p className="pv-note pv-ui" {...keepVisible}>
              <button type="button" onClick={() => void fetchNextPage()}>
                Reintentar carga
              </button>
            </p>
          )}
        </div>

        <nav ref={strip} className="pv-strip pv-ui" aria-label="Fotos" {...keepVisible}>
          {loadedPhotos.map((photo, photoIndex) => (
            <button
              key={photo.id}
              type="button"
              aria-label={`Foto ${photoIndex + 1}: ${photoDateLabel(photo)}`}
              aria-current={photoIndex === index ? 'true' : undefined}
              tabIndex={photoIndex === index ? 0 : -1}
              onClick={() => select(photoIndex, photoIndex > index ? 1 : -1)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
              <img
                src={thumbnailVariantUrl(api, photo.thumbnailUrl, 640)}
                alt=""
                width={photo.dimensions?.width}
                height={photo.dimensions?.height}
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </button>
          ))}
        </nav>
      </section>
    </div>
  );
}

function ArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** What the viewer is currently trying to show for the open photo. */
type Shown = {
  id: string;
  variant: 'thumbnail' | 'original';
  status: 'loading' | 'ready' | 'error';
  /** Bumped to remount the image when the thumbnail is retried. */
  retry: number;
  /** The original failed and the thumbnail stands in for it. */
  fallback: boolean;
};

const freshShown = (photo: TimelinePhoto): Shown => ({
  id: photo.id,
  variant: ORIGINAL_MIME.test(photo.mimeType) ? 'original' : 'thumbnail',
  status: 'loading',
  retry: 0,
  fallback: false,
});

/**
 * The photo itself: the thumbnail first, then the original on top once it has loaded. The
 * parent owns the loading, fallback and retry state so its notices stay outside the zoomed frame.
 */
function ViewerImage({
  photo,
  shown,
  onLoad,
  onError,
}: {
  photo: TimelinePhoto;
  shown: Shown;
  onLoad: (width: number, height: number) => void;
  onError: () => void;
}) {
  const thumbnailSrc = thumbnailVariantUrl(api, photo.thumbnailUrl, 1280);
  const src =
    shown.variant === 'original' ? mediaUrl(api, `/v1/photos/${photo.id}/content`) : thumbnailSrc;

  return (
    <>
      {shown.variant === 'original' && shown.status === 'loading' && (
        <>
          {/* Keep the small preview visible until the full image is ready. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
          <img
            className="pv-under"
            src={thumbnailSrc}
            alt=""
            aria-hidden="true"
            loading="eager"
            draggable={false}
          />
        </>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- Private media URLs rely on the browser's session cookies. */}
      <img
        key={`${photo.id}-${shown.variant}-${shown.retry}`}
        className="pv-img"
        src={src}
        alt={photo.fileName}
        data-source={shown.variant}
        data-ready={shown.status === 'ready'}
        draggable={false}
        onLoad={(event) =>
          onLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)
        }
        onError={onError}
      />
    </>
  );
}
