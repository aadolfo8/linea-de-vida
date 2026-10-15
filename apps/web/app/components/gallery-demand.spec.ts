import { describe, expect, it } from 'vitest';
import { galleryEagerIndexes } from './TimelinePhotoViewer';

describe('gallery eager image demand', () => {
  it('prioritizes only the selected preview and its adjacent previews', () => {
    expect([...galleryEagerIndexes(4, 10)].sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it('does not wrap eager requests at the ends of a non-looping viewer', () => {
    expect([...galleryEagerIndexes(0, 8)].sort((a, b) => a - b)).toEqual([0, 1]);
    expect([...galleryEagerIndexes(7, 8)].sort((a, b) => a - b)).toEqual([6, 7]);
  });

  it('rejects invalid indexes and empty galleries', () => {
    expect([...galleryEagerIndexes(-1, 2)]).toEqual([]);
    expect([...galleryEagerIndexes(2, 2)]).toEqual([]);
    expect([...galleryEagerIndexes(0, 0)]).toEqual([]);
  });
});
