/**
 * Tells a trackpad pinch-out apart from browser zoom made with ctrl + mouse wheel, so only a
 * deliberate pinch travels up a depth and everything else keeps zooming the page (WCAG 1.4.4).
 *
 * Pinches arrive as streams of small, usually fractional, pixel-mode ctrl+wheel deltas; a mouse
 * wheel sends big steps (or whole lines). Only zoom-out deltas (positive) count, and nothing is
 * consumed until a clear amount of them piled up inside a short window.
 */
export const PINCH_MAX_DELTA = 50;
export const PINCH_THRESHOLD = 120;
const PINCH_WINDOW = 250;
/** After a pinch is consumed, the rest of its tail is swallowed so the page does not zoom late. */
const PINCH_TAIL = 450;

export type PinchEvent = { ctrlKey: boolean; deltaY: number; deltaMode: number; time: number };
export type PinchVerdict = 'pass' | 'accumulate' | 'consume' | 'swallow';

export function createPinchDetector() {
  let accumulated = 0;
  let last = -Infinity;
  let tailUntil = -Infinity;

  return (event: PinchEvent): PinchVerdict => {
    if (!event.ctrlKey) return 'pass';
    if (event.time < tailUntil) return 'swallow';
    const pinchLike = event.deltaMode === 0 && Math.abs(event.deltaY) < PINCH_MAX_DELTA;
    // Zoom in, a mouse wheel or a stale gesture: not ours, and it resets what piled up.
    if (!pinchLike || event.deltaY <= 0) {
      accumulated = 0;
      return 'pass';
    }
    if (event.time - last > PINCH_WINDOW) accumulated = 0;
    last = event.time;
    accumulated += event.deltaY;
    if (accumulated <= PINCH_THRESHOLD) return 'accumulate';
    accumulated = 0;
    tailUntil = event.time + PINCH_TAIL;
    return 'consume';
  };
}
