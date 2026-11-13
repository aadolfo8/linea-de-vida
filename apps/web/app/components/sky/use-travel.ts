import { useRouter } from '../../../lib/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { hideOpening, showOpening, showOpeningFailed } from './opening-indicator';
import { activeSkyStage } from './sky-registry';
import { useSky } from './SkyStage';
import {
  consumeTravelEntry,
  setPendingTravel,
  travelAnimation,
  travelCenterOf,
  type PendingTravel,
  type TravelLocation,
  type TravelMode,
} from './travel';

export type TravelTo = (
  href: string,
  mode: TravelMode,
  originEl: Element | null,
  landKey: string | null,
  /** Name of the destination, for the "opening" message of a slow navigation. */
  label?: string,
) => void;

/** How long a depth may stay hidden while its data loads before it shows anyway. */
const REVEAL_FALLBACK = 600;
/** The navigation is only declared failed after this long; slow networks and dev compiles are fine. */
const NAVIGATION_TIMEOUT = 12000;
/** The "opening" indicator appears only if the navigation is not instant. */
const OPENING_DELAY = 350;
/** How often the location is checked while a navigation is pending. */
const LANDING_POLL = 120;

/**
 * Plays the exit zoom (and warp) of the current depth, then navigates. The pending travel
 * lives in a module-level store so the next depth can play the matching entry. While the
 * navigation is slow the world stays away and a status message says so; only a navigation
 * that genuinely never lands gives the world back so the user can try again.
 */
export function useTravel(): TravelTo {
  const router = useRouter();
  const travelling = useRef(false);
  /** The watch of the latest trip only: an earlier trip's timers must never cancel a later one. */
  const watch = useRef<{ trip: number; stop: () => void } | null>(null);
  const trips = useRef(0);
  const clearWatch = useCallback(() => {
    watch.current?.stop();
    watch.current = null;
  }, []);
  useEffect(
    () => () => {
      clearWatch();
      hideOpening();
    },
    [clearWatch],
  );

  return useCallback(
    (href, mode, originEl, landKey, label) => {
      if (travelling.current) return;
      const target = new URL(href, window.location.origin);
      if (target.pathname === window.location.pathname) return;
      travelling.current = true;
      clearWatch();
      hideOpening();
      const trip = (trips.current += 1);
      const origin = travelCenterOf(originEl);
      setPendingTravel({ mode, origin, landKey });

      const stage = activeSkyStage();
      const world = stage?.world;
      const animates = Boolean(
        stage && world && !stage.engine.reduced && typeof world.animate === 'function',
      );
      /** Gives the world back after a failure so the next tap starts from a clean state. */
      const restore = () => {
        if (stage) stage.engine.busy = false;
        world?.getAnimations?.().forEach((animation) => animation.cancel());
        setPendingTravel(null);
      };
      const go = async () => {
        let pushed = false;
        try {
          if (stage && world && animates) {
            stage.engine.busy = true;
            stage.engine.startWarp(mode === 'in' ? 1 : -1);
            world.style.transformOrigin = `${origin.x}px ${origin.y}px`;
            const { keyframes, options } = travelAnimation('exit', mode);
            await world.animate(keyframes, options).finished.catch(() => undefined);
          }
          router.push(href);
          pushed = true;
        } catch {
          restore();
        } finally {
          travelling.current = false;
        }
        if (!pushed || trip !== trips.current) return;

        const opening = window.setTimeout(() => showOpening(label), OPENING_DELAY);
        let failure = 0;
        const poll = window.setInterval(() => {
          if (window.location.pathname !== target.pathname) return;
          stop();
          hideOpening();
        }, LANDING_POLL);
        const stop = () => {
          window.clearTimeout(opening);
          window.clearTimeout(failure);
          window.clearInterval(poll);
        };
        failure = window.setTimeout(() => {
          stop();
          if (watch.current?.trip === trip) watch.current = null;
          if (window.location.pathname === target.pathname) return hideOpening();
          restore();
          showOpeningFailed();
        }, NAVIGATION_TIMEOUT);
        watch.current = { trip, stop };
      };
      void go();
    },
    [clearWatch, router],
  );
}

/**
 * Every depth calls this as it mounts. It hides the world until the data is ready, lands
 * zoomed-out travels on the group we came from, and plays the entry zoom of the pending
 * travel (or the one inferred from browser back/forward).
 */
export function useTravelEntry({
  ready,
  location,
  onLanded,
}: {
  ready: boolean;
  location: TravelLocation;
  onLanded?: () => void;
}) {
  const { engine, worldRef, reduced } = useSky();
  const travel = useRef<PendingTravel | null | undefined>(undefined);
  const played = useRef(false);
  const landed = useRef(onLanded);
  useLayoutEffect(() => {
    landed.current = onLanded;
  });

  useLayoutEffect(() => {
    if (travel.current === undefined) travel.current = consumeTravelEntry(location);
    const world = worldRef.current;
    engine.busy = false;
    if (!travel.current || !world) return;
    world.getAnimations?.().forEach((animation) => animation.cancel());
    if (reduced || played.current) return;
    world.style.opacity = '0';
    const timer = window.setTimeout(() => {
      if (!played.current) world.style.opacity = '';
    }, REVEAL_FALLBACK);
    return () => window.clearTimeout(timer);
    // The entry belongs to the depth that mounted; later renders never replay it.
  }, []);

  useEffect(() => {
    const entry = travel.current;
    const world = worldRef.current;
    if (!ready || !entry || !world || played.current) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      played.current = true;
      engine.measure();
      let center = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      if (entry.mode === 'out' && entry.landKey) {
        const item = engine.itemByKey(entry.landKey);
        if (item) {
          engine.scrollToItem(item, true);
          center = engine.centerInViewport(item, engine.target);
        }
      }
      world.style.opacity = '';
      const done = () => {
        if (!cancelled) landed.current?.();
      };
      if (reduced || typeof world.animate !== 'function') {
        done();
        return;
      }
      world.style.transformOrigin = `${center.x}px ${center.y}px`;
      const { keyframes, options } = travelAnimation('entry', entry.mode);
      world.animate(keyframes, options).finished.then(done, () => undefined);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [engine, ready, reduced, worldRef]);
}
