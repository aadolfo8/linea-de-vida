import { describe, expect, it } from 'vitest';
import { mediaUrl } from './media';

describe('mediaUrl', () => {
  it('returns root-relative media paths for a production same-origin API', () => {
    expect(mediaUrl('/v1', '/v1/photos/photo-1/thumbnail')).toBe('/v1/photos/photo-1/thumbnail');
    expect(mediaUrl('/v1', 'v1/photos/photo-1/thumbnail')).toBe('/v1/photos/photo-1/thumbnail');
    expect(mediaUrl('/v1', 'photos/photo-1/thumbnail')).toBe('/photos/photo-1/thumbnail');
  });

  it('keeps the API version path exactly once for an absolute API URL', () => {
    expect(mediaUrl('http://localhost:3001/v1', '/v1/photos/photo-1/thumbnail')).toBe(
      'http://localhost:3001/v1/photos/photo-1/thumbnail',
    );
    expect(mediaUrl('http://localhost:3001/v1', 'v1/photos/photo-1/thumbnail')).toBe(
      'http://localhost:3001/v1/photos/photo-1/thumbnail',
    );
  });

  it('accepts an API origin without a version suffix', () => {
    expect(mediaUrl('http://localhost:3001', '/v1/photos/photo-1/thumbnail')).toBe(
      'http://localhost:3001/v1/photos/photo-1/thumbnail',
    );
  });

  it('preserves absolute media URLs', () => {
    expect(mediaUrl('http://localhost:3001/v1', 'https://media.example/photo.jpg')).toBe(
      'https://media.example/photo.jpg',
    );
    expect(mediaUrl('/v1', 'http://media.example/photo.jpg')).toBe(
      'http://media.example/photo.jpg',
    );
  });
});
