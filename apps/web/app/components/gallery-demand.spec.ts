import { describe, expect, it } from 'vitest';
import { galleryOriginalIndexes } from './TimelineExperience';

describe('gallery original demand', () => {
  it('loads originals only for the selected and adjacent slides', () => {
    expect([...galleryOriginalIndexes(4, 10)].sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it('wraps adjacent slides without requesting every original', () => {
    expect([...galleryOriginalIndexes(0, 8)].sort((a, b) => a - b)).toEqual([0, 1, 7]);
  });
});
