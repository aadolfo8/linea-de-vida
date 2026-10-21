'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useOptionalSky, useSky } from './SkyStage';
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
) => void;

/** How long a depth may stay hidden while its data loads before it shows anyway. */
const REVEAL_FALLBACK = 600;
/** If the navigation never lands, give the world back instead of leaving it hidden. */
const EXIT_GUARD = 3500;

/**
 * Plays the exit zoom (and warp) of the current depth, then navigates. The pending travel
 * lives in a module-level store so the next depth can play the matching entry.
 */
export function useTravel(): TravelTo {
  const router = useRouter();
  const sky = useOptionalSky();
  const travelling = useRef(false);

  return useCallback(
    (href, mode, originEl, landKey) => {
      if (travelling.current) return;
      const target = new URL(href, window.location.origin);
      if (target.pathname === window.location.pathname) return;
      travelling.current = true;
      const origin = travelCenterOf(originEl);
      setPendingTravel({ mode, origin, landKey });

      const world = sky?.worldRef.current;
      const animates = Boolean(sky && world && !sky.reduced && typeof world.animate === 'function');
      const finish = async () => {
        if (sky && world && animates) {
          sky.engine.busy = true;
          sky.engine.startWarp(mode === 'in' ? 1 : -1);
          world.style.transformOrigin = `${origin.x}px ${origin.y}px`;
          const { keyframes, options } = travelAnimation('exit', mode);
          await world.animate(keyframes, options).finished.catch(() => undefined);
          window.setTimeout(() => {
            if (window.location.pathname !== target.pathname) {
              world.getAnimations().forEach((animation) => animation.cancel());
              sky.engine.busy = false;
              setPendingTravel(null);
            }
          }, EXIT_GUARD);
        }
        router.push(href, { scroll: false });
        travelling.current = false;
      };
      void finish();
    },
    [router, sky],
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
