import { describe, expect, it } from 'vitest';
import { photoDimensions, readPhotoDimensions } from '../src/photo-dimensions';

describe('photo dimensions', () => {
  it('accepts bounded positive integer dimensions', () => {
    expect(photoDimensions(4032, 3024)).toEqual({ width: 4032, height: 3024 });
  });

  it.each([
    [0, 1200],
    [-1, 1200],
    [1200, 0],
    [1.5, 100],
    ['1200', 100],
    [100_001, 100],
  ])('rejects invalid dimensions %j × %j', (width, height) => {
    expect(photoDimensions(width, height)).toBeNull();
  });

  it('reads valid dimensions from persisted image metadata', () => {
    expect(readPhotoDimensions({ width: 1080, height: 1920 })).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(readPhotoDimensions(null)).toBeNull();
    expect(readPhotoDimensions(['1080', '1920'])).toBeNull();
  });
});
