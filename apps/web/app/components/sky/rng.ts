export type Rng = () => number;

/** Small deterministic generator (Lehmer) so layouts are stable for the same seed. */
export function seededRng(seed: number): Rng {
  let state = (Math.abs(Math.trunc(seed) * 7919 + 13) % 2147483646) + 1;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
  next();
  next();
  next();
  return next;
}

export function shuffle<T>(items: readonly T[], rng: Rng) {
  const result = items.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Smoothstep easing used by every reveal. */
export const smooth = (t: number) => t * t * (3 - 2 * t);
