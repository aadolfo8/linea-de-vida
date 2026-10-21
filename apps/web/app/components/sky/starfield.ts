import { clamp, type Rng } from './rng';

export type Star = {
  /** Normalised position (0..1) inside the viewport. */
  x: number;
  y: number;
  /** Parallax depth: how far the star drifts when the track moves. */
  z: number;
  /** Size in CSS pixels. */
  r: number;
  /** Base brightness. */
  a: number;
  /** Twinkle frequency and phase. */
  f: number;
  ph: number;
};

export type SkyDrawState = {
  width: number;
  height: number;
  dpr: number;
  /** Track position along the travel axis. */
  current: number;
  /** Time in ms. */
  time: number;
  horizontal: boolean;
  /** 0..1 intensity of the warp streaks. */
  warp: number;
  /** 1 streaks outward (travelling in), -1 inward (travelling out). */
  warpDirection: 1 | -1;
  reduced: boolean;
};

const DEPTHS = [0.03, 0.08, 0.16];

export const starCount = (width: number, height: number) =>
  Math.max(0, Math.round((width * height) / 2400));

export function createStars(count: number, rng: Rng): Star[] {
  return Array.from({ length: count }, () => ({
    x: rng(),
    y: rng(),
    z: DEPTHS[Math.floor(rng() * DEPTHS.length)]!,
    r: rng() * 1.1 + 0.25,
    a: rng() * 0.6 + 0.2,
    f: rng() * 2 + 0.5,
    ph: rng() * 6,
  }));
}

/** Warp envelope: ramps up and back down over one travel. */
export const warpEnvelope = (elapsed: number, duration: number) =>
  Math.sin(clamp(elapsed / duration) * Math.PI);

const wrap = (value: number, size: number) => ((value % size) + size) % size;

export function starPosition(
  star: Star,
  state: Pick<SkyDrawState, 'width' | 'height' | 'current' | 'horizontal'>,
) {
  const x = star.x * state.width;
  const y = star.y * state.height;
  return state.horizontal
    ? { x: wrap(x - state.current * star.z, state.width), y }
    : { x, y: wrap(y - state.current * star.z, state.height) };
}

export function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: readonly Star[],
  state: SkyDrawState,
) {
  const { width, height, dpr, warp, warpDirection, reduced, time } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  ctx.fillStyle = ctx.strokeStyle = '#dfe8ff';
  for (const star of stars) {
    const { x, y } = starPosition(star, state);
    const twinkle = reduced
      ? star.a
      : clamp(star.a + Math.sin((time / 1000) * star.f + star.ph) * 0.25, 0.05, 1);
    if (warp > 0.002 && !reduced) {
      // Flying in (or out): stars streak away from the centre.
      const stretch = 1 + warp * 0.9 * star.z * 6 * warpDirection;
      ctx.globalAlpha = Math.min(1, twinkle + warp * 0.5);
      ctx.lineWidth = star.r;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(cx + (x - cx) * stretch, cy + (y - cy) * stretch);
      ctx.stroke();
    } else {
      ctx.globalAlpha = twinkle;
      ctx.fillRect(x, y, star.r, star.r);
    }
  }
  ctx.globalAlpha = 1;
}
