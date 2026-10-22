/** At most this many groups fetch their previews at once; the browser has only ~6 connections. */
export const CONCURRENT_GROUP_LOADS = 3;
/** Requests arriving within this window are ranked together, so the nearest one goes first. */
const PRIORITY_WINDOW = 40;

/**
 * Starts group loads nearest-first with a concurrency cap. Requests are re-ranked every time a
 * slot frees up, and one that is no longer wanted (the person scrolled away) is dropped instead
 * of loading photos nobody will see.
 */
export class LoadQueue {
  private readonly pending = new Map<string, { load: () => Promise<unknown>; drop: () => void }>();
  private running = 0;
  private timer = 0;

  /**
   * @param rank Distance of a group from what is on screen, or null once it is not wanted.
   */
  constructor(
    private readonly rank: (key: string) => number | null,
    private readonly limit = CONCURRENT_GROUP_LOADS,
  ) {}

  request(key: string, load: () => Promise<unknown>, drop: () => void) {
    if (this.pending.has(key)) return;
    this.pending.set(key, { load, drop });
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.pump();
    }, PRIORITY_WINDOW);
  }

  /** Forgets everything waiting (the loads in flight finish on their own). */
  clear() {
    this.pending.clear();
  }

  dispose() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.pending.clear();
  }

  private pump() {
    while (this.running < this.limit) {
      let best: string | null = null;
      let bestDistance = Infinity;
      for (const [key, entry] of this.pending) {
        const distance = this.rank(key);
        if (distance === null) {
          this.pending.delete(key);
          entry.drop();
        } else if (distance < bestDistance) {
          best = key;
          bestDistance = distance;
        }
      }
      const entry = best === null ? undefined : this.pending.get(best);
      if (best === null || !entry) return;
      this.pending.delete(best);
      this.running += 1;
      entry
        .load()
        .catch(() => undefined)
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }
}
