import { describe, expect, it } from 'vitest';
import { previewSources } from './Constellation';

describe('previewSources', () => {
  const url = '/v1/photos/p1/thumbnail';

  it('serves small tiles from the 640 variant only, even on dense screens', () => {
    const sources = previewSources('https://api.test', url, 300);
    expect(sources).toEqual({ src: expect.stringContaining('width=640') });
    expect('srcSet' in sources).toBe(false);
  });

  it('offers the 1280 variant to tiles big enough to need it', () => {
    const sources = previewSources('https://api.test', url, 520) as {
      src: string;
      srcSet: string;
      sizes: string;
    };
    expect(sources.srcSet).toMatch(/width=640.* 640w, .*width=1280.* 1280w/);
    expect(sources.sizes).toBe('520px');
  });
});
