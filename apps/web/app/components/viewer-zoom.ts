/**
 * Pure geometry of the photo viewer. The photo sits centred in the stage; a view is the scale
 * and the pan (in pixels from that centre) applied to it.
 */
export type Size = { width: number; height: number };
export type View = { scale: number; x: number; y: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
/** Where a double click or double tap lands. */
export const DOUBLE_TAP_ZOOM = 2.5;
export const KEY_ZOOM_STEP = 1.4;
export const BUTTON_ZOOM_STEP = 1.6;
/** Distance the arrow keys pan a zoomed photo. */
export const KEY_PAN_STEP = 80;

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/** Below this the photo counts as not zoomed (floating point drift after zooming out). */
export const isZoomed = (view: View) => view.scale > 1.01;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The band of the window the photo may use: full width, between the top meta and the filmstrip. */
export type StageBox = Size & { top: number };

/** Smallest band worth fitting a photo into; anything thinner means nothing was measured. */
const MIN_BAND = 120;

/**
 * The free band between the bottom edge of the top meta block and the top edge of the filmstrip,
 * measured in window pixels. Without usable measures (no layout yet) it falls back to the whole
 * window, so the viewer never collapses.
 */
export function stageBox(viewport: Size, topEdge: number, bottomEdge: number): StageBox {
  const top = clamp(topEdge, 0, viewport.height);
  const bottom = clamp(bottomEdge, 0, viewport.height);
  if (bottom - top < MIN_BAND) return { width: viewport.width, height: viewport.height, top: 0 };
  return { width: viewport.width, height: bottom - top, top };
}

/** Largest size at which the whole photo fits the stage band, with a little air around it. */
export function fitSize(natural: Size | null, stage: Size): Size {
  const source = natural && natural.width > 0 && natural.height > 0 ? natural : null;
  const narrow = stage.width < 640;
  const room = {
    width: Math.max(1, stage.width - (narrow ? 0 : 96)),
    height: Math.max(1, stage.height - 24),
  };
  if (!source) return { width: room.width * 0.6, height: room.height * 0.6 };
  const factor = Math.min(room.width / source.width, room.height / source.height);
  return { width: source.width * factor, height: source.height * factor };
}

/** Keeps the photo from being dragged away: it can only pan while it overflows the stage. */
export function clampView(view: View, fit: Size, stage: Size): View {
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM);
  if (scale <= MIN_ZOOM) return IDENTITY;
  const maxX = Math.max(0, (fit.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fit.height * scale - stage.height) / 2);
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}

/**
 * Zooms to `scale` keeping the point under the cursor still. `point` is measured from the
 * stage centre, which is where the photo's own origin sits.
 */
export function zoomAround(
  view: View,
  scale: number,
  point: { x: number; y: number },
  fit: Size,
  stage: Size,
): View {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const ratio = next / view.scale;
  return clampView(
    {
      scale: next,
      x: point.x - (point.x - view.x) * ratio,
      y: point.y - (point.y - view.y) * ratio,
    },
    fit,
    stage,
  );
}

/** Scale after a wheel tick: ctrl+wheel is a trackpad pinch and needs a bolder factor. */
export function wheelScale(scale: number, deltaY: number, pinch: boolean, deltaMode = 0) {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return scale * Math.exp(-pixels * (pinch ? 0.012 : 0.0018));
}

/** The scale a double click or double tap leads to: back to fit, or in to 2.5x. */
export const doubleTapScale = (view: View) => (isZoomed(view) ? MIN_ZOOM : DOUBLE_TAP_ZOOM);

/** Transform that makes a photo of size `from` look like the rect `to` (grow and shrink). */
export function flipTransform(
  to: { left: number; top: number; width: number; height: number },
  fit: Size,
  stage: Size,
  /** Window distance from the top to the stage band, when the band does not start there. */
  stageTop = 0,
) {
  return {
    x: to.left + to.width / 2 - stage.width / 2,
    y: to.top + to.height / 2 - (stageTop + stage.height / 2),
    scale: to.width / Math.max(1, fit.width),
  };
}

/** Whether a rect is on screen and big enough to be worth flying to or from. */
export function isRectVisible(
  rect: { left: number; top: number; right: number; bottom: number; width: number },
  stage: Size,
) {
  return (
    rect.width > 4 &&
    rect.right > 0 &&
    rect.left < stage.width &&
    rect.bottom > 0 &&
    rect.top < stage.height
  );
}
