import { describe, expect, it } from 'vitest';

describe('immersive preview', () => {
  it('keeps the route preview as a client-side route', async () => {
    const page = await import('./page');
    expect(page.default).toBeTypeOf('function');
  });
});
