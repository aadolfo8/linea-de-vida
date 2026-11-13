import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

const request = (cookie?: string) =>
  new NextRequest('https://example.test/timeline/2020', {
    headers: cookie ? { cookie } : {},
  });

describe('session middleware', () => {
  it('sends a visitor without a session cookie to the start', () => {
    const response = middleware(request());
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://example.test/');
  });

  it('lets a request with a session cookie through', () => {
    const response = middleware(request('lv_session=abc'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
