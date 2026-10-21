import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeTravelEntry,
  inferTravel,
  peekPendingTravel,
  resetTravel,
  setPendingTravel,
  shouldRestorePosition,
  travelAnimation,
  travelDepth,
  travelLocation,
} from './travel';

const years = travelLocation('/timeline');
const year = travelLocation('/timeline/2004');
const month = travelLocation('/timeline/2004/8');
const unknown = travelLocation('/timeline/2004/sin-mes');

afterEach(resetTravel);

describe('travel depth', () => {
  it('maps routes to depths', () => {
    expect([years, year, month, unknown].map(travelDepth)).toEqual([0, 1, 2, 2]);
  });
});

describe('restoring a saved position', () => {
  it('restores when nothing decides the position', () => {
    expect(shouldRestorePosition(year)).toBe(true);
    consumeTravelEntry(year);
    expect(shouldRestorePosition(year)).toBe(true);
  });

  it('lets an explicit landing win without consuming the travel', () => {
    setPendingTravel({ mode: 'out', origin: { x: 0, y: 0 }, landKey: '8' });
    expect(shouldRestorePosition(year)).toBe(false);
    expect(peekPendingTravel()).not.toBeNull();
  });

  it('lets the landing of browser back win too, before the depth consumes it', () => {
    consumeTravelEntry(month);
    expect(shouldRestorePosition(year)).toBe(false);
    expect(consumeTravelEntry(year)).toMatchObject({ mode: 'out', landKey: '8' });
  });

  it('keeps restoring when going deeper, which lands on no group', () => {
    consumeTravelEntry(year);
    expect(shouldRestorePosition(month)).toBe(true);
  });
});

describe('travel store', () => {
  it('hands an explicit pending travel to the next depth exactly once', () => {
    const travel = { mode: 'in' as const, origin: { x: 10, y: 20 }, landKey: null };
    setPendingTravel(travel);
    expect(peekPendingTravel()).toBe(travel);
    expect(consumeTravelEntry(year)).toBe(travel);
    expect(peekPendingTravel()).toBeNull();
    expect(consumeTravelEntry(month)).toMatchObject({ mode: 'in' });
  });

  it('plays nothing on the very first visit', () => {
    expect(consumeTravelEntry(year)).toBeNull();
  });

  it('infers a zoom out onto the group we came from when the depth decreases', () => {
    consumeTravelEntry(month);
    expect(consumeTravelEntry(year)).toMatchObject({ mode: 'out', landKey: '8' });
    expect(consumeTravelEntry(years)).toMatchObject({ mode: 'out', landKey: '2004' });
  });

  it('lands on the undated group and on the year when jumping several levels', () => {
    expect(inferTravel(unknown, year)).toMatchObject({ mode: 'out', landKey: 'sin-mes' });
    expect(inferTravel(month, years)).toMatchObject({ mode: 'out', landKey: '2004' });
  });

  it('infers a zoom in when the depth increases and nothing for the same depth', () => {
    expect(inferTravel(years, year)).toMatchObject({ mode: 'in', landKey: null });
    expect(inferTravel(month, travelLocation('/timeline/2004/9'))).toBeNull();
    expect(inferTravel(null, year)).toBeNull();
  });
});

describe('travel animation', () => {
  it('zooms the world away from the origin on exit', () => {
    const entering = travelAnimation('exit', 'in');
    expect(entering.keyframes.at(-1)).toMatchObject({ transform: 'scale(2.8)', opacity: 0 });
    expect(entering.options.fill).toBe('forwards');
    expect(travelAnimation('exit', 'out').keyframes.at(-1)).toMatchObject({
      transform: 'scale(0.5)',
    });
  });

  it('settles onto the new depth from a smaller or larger scale', () => {
    expect(travelAnimation('entry', 'in').keyframes[0]).toMatchObject({ transform: 'scale(0.55)' });
    expect(travelAnimation('entry', 'out').keyframes[0]).toMatchObject({ transform: 'scale(2.6)' });
    expect(travelAnimation('entry', 'out').keyframes.at(-1)).toMatchObject({ opacity: 1 });
  });
});
