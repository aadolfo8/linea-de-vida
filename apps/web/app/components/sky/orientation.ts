export type SkyOrientation = 'vertical' | 'horizontal';

const STORAGE_KEY = 'ldv-sky-orientation';

/** Reads the persisted travel direction; storage can be blocked, so every access is guarded. */
export function readOrientation(): SkyOrientation {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'horizontal' ? 'horizontal' : 'vertical';
  } catch {
    return 'vertical';
  }
}

export function writeOrientation(orientation: SkyOrientation) {
  try {
    window.localStorage.setItem(STORAGE_KEY, orientation);
  } catch {
    // The preference simply is not remembered.
  }
}
