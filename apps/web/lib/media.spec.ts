import { describe, expect, it } from 'vitest';
import { mediaUrl } from './media';

describe('mediaUrl', () => {
  it('keeps the API version path exactly once', () => {
    expect(mediaUrl('http://localhost:3001/v1', '/v1/photos/photo-1/thumbnail')).toBe(
      'http://localhost:3001/v1/photos/photo-1/thumbnail',
    );
  });

  it('accepts an API origin without a version suffix and absolute URLs', () => {
    expect(mediaUrl('http://localhost:3001', '/v1/photos/photo-1/thumbnail')).toBe(
      'http://localhost:3001/v1/photos/photo-1/thumbnail',
    );
    expect(mediaUrl('http://localhost:3001/v1', 'https://media.example/photo.jpg')).toBe(
      'https://media.example/photo.jpg',
    );
  });
});
