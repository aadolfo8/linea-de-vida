import { parseTimelineRoute } from '../timeline-model';

export type TravelMode = 'in' | 'out';
export type TravelPoint = { x: number; y: number };
export type PendingTravel = {
  mode: TravelMode;
  /** Where the exit zoom was anchored (viewport pixels). */
  origin: TravelPoint;
  /** Item the destination should land on, e.g. the year or month we came from. */
  landKey: string | null;
};
export type TravelLocation = { year: number | null; month: number | null; unknown: boolean };

/*
 * The pending travel lives at module level on purpose: the depth that plays the exit is
 * unmounted by the client navigation it triggers, and the next depth reads it when it mounts.
 */
let pending: PendingTravel | null = null;
let lastLocation: TravelLocation | null = null;

export const setPendingTravel = (travel: PendingTravel | null) => {
  pending = travel;
};
export const peekPendingTravel = () => pending;

/** Test and teardown helper. */
export function resetTravel() {
  pending = null;
  lastLocation = null;
}

export const travelLocation = (pathname: string): TravelLocation => {
  const { year, month, unknown } = parseTimelineRoute(pathname);
  return { year, month, unknown };
};

/** 0 = all years, 1 = one year, 2 = one month (or the undated group of a year). */
export function travelDepth(location: TravelLocation) {
  if (!location.year) return 0;
  return location.month || location.unknown ? 2 : 1;
}

/** Key of the group a location occupies inside the list of the given depth. */
export function travelKey(location: TravelLocation, depth: 0 | 1) {
  if (depth === 0) return location.year ? String(location.year) : null;
  if (location.unknown) return 'sin-mes';
  return location.month ? String(location.month) : null;
}

const viewportCenter = (): TravelPoint =>
  typeof window === 'undefined'
    ? { x: 0, y: 0 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 };

/** Browser back/forward and typed URLs carry no travel: derive it from the depth change. */
export function inferTravel(
  previous: TravelLocation | null,
  next: TravelLocation,
): PendingTravel | null {
  if (!previous) return null;
  const from = travelDepth(previous);
  const to = travelDepth(next);
  if (to === from) return null;
  if (to < from)
    return { mode: 'out', origin: viewportCenter(), landKey: travelKey(previous, to as 0 | 1) };
  return { mode: 'in', origin: viewportCenter(), landKey: null };
}

/**
 * Called once by every depth as it mounts. Returns the travel to play (explicit or inferred)
 * and remembers the location so the next navigation can be inferred.
 */
export function consumeTravelEntry(next: TravelLocation): PendingTravel | null {
  const travel = pending ?? inferTravel(lastLocation, next);
  pending = null;
  lastLocation = next;
  return travel;
}

/**
 * Whether a depth that is mounting should restore its saved scroll position. Landing on the
 * group we came from (explicit travel, or the one browser back/forward implies) decides the
 * position instead, so the two must never fight. Reads the entry without consuming it.
 */
export const shouldRestorePosition = (location: TravelLocation) =>
  !(pending ?? inferTravel(lastLocation, location))?.landKey;

export const travelCenterOf = (element: Element | null | undefined): TravelPoint => {
  if (!element) return viewportCenter();
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

export type TravelPhase = 'exit' | 'entry';
export type TravelAnimation = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

/** World zoom: the exit scales away from the origin, the entry settles onto the new depth. */
export function travelAnimation(phase: TravelPhase, mode: TravelMode): TravelAnimation {
  const rest = { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' };
  if (phase === 'exit') {
    return {
      keyframes: [
        rest,
        { transform: mode === 'in' ? 'scale(2.8)' : 'scale(0.5)', opacity: 0, filter: 'blur(6px)' },
      ],
      options: {
        duration: mode === 'in' ? 480 : 420,
        easing: 'cubic-bezier(.55,0,.75,.25)',
        fill: 'forwards',
      },
    };
  }
  return {
    keyframes: [
      { transform: mode === 'in' ? 'scale(0.55)' : 'scale(2.6)', opacity: 0, filter: 'blur(6px)' },
      rest,
    ],
    options: { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' },
  };
}

export const WARP_DURATION = 1000;
