import { describe, expect, it, vi } from 'vitest';
import { seededRng } from './rng';
import { createStars, drawStars, starCount, starPosition, warpEnvelope } from './starfield';

describe('starfield', () => {
  it('creates a deterministic set of stars inside the unit square', () => {
    const stars = createStars(50, seededRng(3));
    expect(createStars(50, seededRng(3))).toEqual(stars);
    expect(stars).toHaveLength(50);
    stars.forEach((star) => {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect([0.03, 0.08, 0.16]).toContain(star.z);
    });
    expect(starCount(1200, 800)).toBe(400);
  });

  it('drifts stars along the travel axis and wraps them', () => {
    const star = { x: 0.5, y: 0.1, z: 0.1, r: 1, a: 1, f: 1, ph: 0 };
    const base = { width: 1000, height: 500, horizontal: false };
    expect(starPosition(star, { ...base, current: 0 })).toEqual({ x: 500, y: 50 });
    expect(starPosition(star, { ...base, current: 1000 }).y).toBe(450);
    expect(starPosition(star, { ...base, current: 100, horizontal: true })).toEqual({
      x: 490,
      y: 50,
    });
  });

  it('rises and falls with the warp envelope', () => {
    expect(warpEnvelope(0, 1000)).toBe(0);
    expect(warpEnvelope(500, 1000)).toBeCloseTo(1);
    expect(warpEnvelope(1000, 1000)).toBeCloseTo(0);
    expect(warpEnvelope(5000, 1000)).toBeCloseTo(0);
  });

  it('draws points at rest and streaks during a warp, but never streaks with reduced motion', () => {
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const stars = createStars(5, seededRng(1));
    const state = {
      width: 400,
      height: 300,
      dpr: 2,
      current: 0,
      time: 0,
      horizontal: false,
      warp: 0,
      warpDirection: 1 as const,
      reduced: false,
    };
    drawStars(ctx, stars, state);
    expect(ctx.fillRect).toHaveBeenCalledTimes(5);
    expect(ctx.stroke).not.toHaveBeenCalled();

    drawStars(ctx, stars, { ...state, warp: 0.8 });
    expect(ctx.stroke).toHaveBeenCalledTimes(5);

    vi.mocked(ctx.stroke).mockClear();
    drawStars(ctx, stars, { ...state, warp: 0.8, reduced: true });
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
