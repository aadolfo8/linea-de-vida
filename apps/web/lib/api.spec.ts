import { describe, expect, it } from 'vitest';
import { routeForSession, settingsEndpoint } from './api';

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
  });
});
