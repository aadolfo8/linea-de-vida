import type { SkyEngine } from './sky-engine';

type ActiveStage = { engine: SkyEngine; world: HTMLElement };

/*
 * The stage that is currently on screen. Travel is triggered from chrome and shortcuts that
 * live outside the stage (and keep working on depths that render without one), so they look
 * the stage up here instead of through React context.
 */
let active: ActiveStage | null = null;

export function registerSkyStage(stage: ActiveStage) {
  active = stage;
  return () => {
    if (active === stage) active = null;
  };
}

export const activeSkyStage = () => active;
