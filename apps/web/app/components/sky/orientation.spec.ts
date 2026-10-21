/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOrientation, writeOrientation } from './orientation';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('orientation preference', () => {
  it('defaults to vertical and remembers horizontal', () => {
    expect(readOrientation()).toBe('vertical');
    writeOrientation('horizontal');
    expect(readOrientation()).toBe('horizontal');
    writeOrientation('vertical');
    expect(readOrientation()).toBe('vertical');
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readOrientation()).toBe('vertical');
    expect(() => writeOrientation('horizontal')).not.toThrow();
  });
});
