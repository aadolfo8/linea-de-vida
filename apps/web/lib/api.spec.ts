import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiJson, isUnauthenticated, routeForSession, settingsEndpoint } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('route decisions', () => {
  it('sends an authenticated visitor directly to the timeline', () => {
    expect(routeForSession(true)).toBe('/timeline');
    expect(routeForSession(false)).toBe('/');
  });
});

describe('settings API interactions', () => {
  it('uses the authenticated Drive and sync contracts', () => {
    expect(settingsEndpoint.folderChildren('connection', 'folder/id')).toBe(
      '/oauth-connections/connection/drive/folders/folder%2Fid/children',
    );
    expect(settingsEndpoint.createSource).toBe('/photo-sources');
    expect(settingsEndpoint.sync('source')).toBe('/photo-sources/source/sync-runs');
    expect(settingsEndpoint.run('run')).toBe('/sync-runs/run');
    expect(settingsEndpoint.issues('run')).toBe('/sync-runs/run/issues?limit=30');
    expect(settingsEndpoint.disconnect('connection')).toBe('/oauth-connections/connection');
    expect(
      settingsEndpoint.sourcePhotos('source/id', {
        query: 'summer trip',
        folderId: 'folder/id',
        classification: 'MANUAL',
        cursor: 'opaque token',
      }),
    ).toBe(
      '/photo-sources/source%2Fid/photos?limit=30&q=summer+trip&folderId=folder%2Fid&classification=MANUAL&cursor=opaque+token',
    );
    expect(settingsEndpoint.photoExclusions()).toBe('/photo-exclusions?limit=30');
    expect(settingsEndpoint.restorePhotoExclusion('exclusion/id')).toBe(
      '/photo-exclusions/exclusion%2Fid',
    );
  });
});

describe('structured API failures', () => {
  it('preserves status, code, request ID and Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: 'RATE_LIMITED', message: 'Wait.', requestId: 'request-1' }),
            { status: 429, headers: { 'Retry-After': '7', 'Content-Type': 'application/json' } },
          ),
      ),
    );
    await expect(apiJson('/me')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'request-1',
      retryAfterSeconds: 7,
    });
  });

  it('treats only HTTP 401 as signed out', () => {
    expect(isUnauthenticated(new ApiError(401, 'UNAUTHENTICATED', 'No session', null, null))).toBe(
      true,
    );
    expect(isUnauthenticated(new ApiError(429, 'RATE_LIMITED', 'Wait', null, 3))).toBe(false);
    expect(isUnauthenticated(new ApiError(503, 'UNAVAILABLE', 'Retry', null, null))).toBe(false);
  });
});
