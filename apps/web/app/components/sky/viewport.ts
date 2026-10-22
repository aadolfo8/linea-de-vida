export type ViewportSize = { width: number; height: number };

/** Mobile browsers grow and shrink the URL bar by less than this while the page scrolls. */
const CHROME_HEIGHT_SLOP = 120;

/** Whether the main input is a finger rather than a mouse (phones, tablets, home touchscreens). */
export const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

/**
 * A touch device's URL bar showing or hiding changes only the height, by a small amount, in the
 * middle of a scroll. Rebuilding the sky for it would re-measure everything under the finger,
 * so it is ignored; width and orientation changes (and big height changes) are real.
 */
export const isBrowserChromeResize = (
  previous: ViewportSize,
  next: ViewportSize,
  coarse: boolean,
) =>
  coarse &&
  previous.width === next.width &&
  Math.abs(previous.height - next.height) < CHROME_HEIGHT_SLOP;
