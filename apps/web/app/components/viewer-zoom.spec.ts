import { describe, expect, it } from 'vitest';
import {
  DOUBLE_TAP_ZOOM,
  IDENTITY,
  MAX_ZOOM,
  clampView,
  doubleTapScale,
  fitSize,
  flipTransform,
  isRectVisible,
  isZoomed,
  wheelScale,
  zoomAround,
} from './viewer-zoom';

const stage = { width: 1000, height: 800 };
const fit = { width: 900, height: 600 };

describe('fitSize', () => {
  it('fits the whole photo with room for the chrome', () => {
    const size = fitSize({ width: 3000, height: 2000 }, stage);
    expect(size.width / size.height).toBeCloseTo(1.5);
    expect(size.width).toBeLessThanOrEqual(1000 - 96);
    expect(size.height).toBeLessThanOrEqual(800 - 150);
  });

  it('uses the full width on a phone and a neutral box while the size is unknown', () => {
    expect(fitSize({ width: 2000, height: 1000 }, { width: 400, height: 800 }).width).toBe(400);
    const unknown = fitSize(null, stage);
    expect(unknown.width).toBeGreaterThan(0);
    expect(fitSize({ width: 0, height: 0 }, stage)).toEqual(unknown);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the cursor still while zooming', () => {
    const point = { x: 100, y: -50 };
    const next = zoomAround(IDENTITY, 2, point, fit, stage);
    // The photo point under the cursor before: (100, -50) from the centre. After: same place.
    expect(next.scale).toBe(2);
    expect((point.x - next.x) / next.scale).toBeCloseTo(point.x);
    expect((point.y - next.y) / next.scale).toBeCloseTo(point.y);
  });

  it('never goes past the zoom limits and returns to the centre at 1x', () => {
    expect(zoomAround(IDENTITY, 50, { x: 0, y: 0 }, fit, stage).scale).toBe(MAX_ZOOM);
    const zoomedIn = zoomAround(IDENTITY, 3, { x: 200, y: 100 }, fit, stage);
    expect(zoomAround(zoomedIn, 0.2, { x: 200, y: 100 }, fit, stage)).toEqual(IDENTITY);
  });
});

describe('clampView', () => {
  it('lets the photo pan only while it overflows the stage', () => {
    // 900 wide at 2x is 1800: 800 more than the stage, so 400 each way.
    const view = clampView({ scale: 2, x: 5000, y: -5000 }, fit, stage);
    expect(view.x).toBe(400);
    // 600 high at 2x is 1200: 400 more than the stage, so 200 each way.
    expect(view.y).toBe(-200);
  });

  it('does not pan a photo that still fits inside the stage', () => {
    const small = { width: 300, height: 200 };
    expect(clampView({ scale: 2, x: 99, y: 99 }, small, stage)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it('resets to the identity at fit', () => {
    expect(clampView({ scale: 1, x: 40, y: 10 }, fit, stage)).toBe(IDENTITY);
  });
});

describe('gestures', () => {
  it('zooms the wheel gently and the trackpad pinch boldly', () => {
    const wheel = wheelScale(1, -100, false);
    const pinch = wheelScale(1, -100, true);
    expect(wheel).toBeGreaterThan(1);
    expect(pinch).toBeGreaterThan(wheel);
    expect(wheelScale(2, 100, false)).toBeLessThan(2);
    expect(wheelScale(1, -10, false, 1)).toBeGreaterThan(wheelScale(1, -10, false, 0));
  });

  it('toggles a double tap between fit and 2.5x', () => {
    expect(doubleTapScale(IDENTITY)).toBe(DOUBLE_TAP_ZOOM);
    expect(doubleTapScale({ scale: 3, x: 0, y: 0 })).toBe(1);
    expect(isZoomed({ scale: 1.005, x: 0, y: 0 })).toBe(false);
    expect(isZoomed({ scale: 1.5, x: 0, y: 0 })).toBe(true);
  });
});

describe('flip', () => {
  it('maps the photo onto the rect of its tile', () => {
    const tile = { left: 100, top: 50, width: 300, height: 200, right: 400, bottom: 250 };
    const flip = flipTransform(tile, fit, stage);
    expect(flip.scale).toBeCloseTo(300 / 900);
    expect(flip.x).toBe(250 - 500);
    expect(flip.y).toBe(150 - 400);
  });

  it('only flies to tiles that are on screen and not tiny', () => {
    const rect = (left: number, top: number, width: number, height: number) => ({
      left,
      top,
      width,
      right: left + width,
      bottom: top + height,
    });
    expect(isRectVisible(rect(10, 10, 200, 100), stage)).toBe(true);
    expect(isRectVisible(rect(-300, 10, 200, 100), stage)).toBe(false);
    expect(isRectVisible(rect(10, 900, 200, 100), stage)).toBe(false);
    expect(isRectVisible(rect(10, 10, 2, 2), stage)).toBe(false);
  });
});
