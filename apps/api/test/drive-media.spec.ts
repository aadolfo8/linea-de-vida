import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  request: vi.fn(),
  credentials: vi.fn(),
}));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials = transport.credentials;
    request = transport.request;
  },
}));
vi.mock('@googleapis/drive', () => ({
  drive: () => ({ files: { get: transport.get, list: transport.list } }),
}));

import { GoogleDriveProvider } from '../src/drive';

describe('Google Drive media transport', () => {
  const connection = { refreshTokenCiphertext: null };
  const thumbnailLink = 'https://lh3.googleusercontent.com/private-thumbnail';
  beforeEach(() => {
    vi.resetAllMocks();
    transport.get.mockResolvedValue({ data: { thumbnailLink } });
    transport.request.mockResolvedValue({
      data: Readable.from('small-thumbnail'),
      headers: { 'content-type': 'image/jpeg', 'content-length': '15' },
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('requests a private thumbnail instead of downloading original media', async () => {
    const signal = new AbortController().signal;
    const media = await new GoogleDriveProvider().getThumbnailStream(connection, 'photo', signal);
    expect(transport.get).toHaveBeenCalledExactlyOnceWith(
      { fileId: 'photo', fields: 'thumbnailLink' },
      { signal },
    );
    expect(transport.request).toHaveBeenCalledExactlyOnceWith({
      url: thumbnailLink,
      method: 'GET',
      responseType: 'stream',
      maxRedirects: 0,
      signal,
    });
    expect(media.contentType).toBe('image/jpeg');
    expect(media.contentLength).toBe(15);
    let body = '';
    for await (const chunk of media.stream) body += chunk;
    expect(body).toBe('small-thumbnail');
  });

  describe('preview size', () => {
    const sized = 'https://lh3.googleusercontent.com/private-thumbnail=s220';

    it('rewrites only the size suffix of the link', async () => {
      transport.get.mockResolvedValue({ data: { thumbnailLink: sized } });
      await new GoogleDriveProvider().getThumbnailStream(connection, 'photo', undefined, 960);
      expect(transport.request).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          url: 'https://lh3.googleusercontent.com/private-thumbnail=s960',
          maxRedirects: 0,
        }),
      );
    });

    it('keeps the default preview when no size is requested', async () => {
      transport.get.mockResolvedValue({ data: { thumbnailLink: sized } });
      await new GoogleDriveProvider().getThumbnailStream(connection, 'photo');
      expect(transport.request).toHaveBeenCalledWith(expect.objectContaining({ url: sized }));
    });

    it.each([
      ['a link without a size suffix', thumbnailLink, 960],
      ['a size that is too large', sized, 100_000],
      ['a size that is not an integer', sized, 12.5],
    ])('refuses %s without calling Google', async (_name, link, size) => {
      transport.get.mockResolvedValue({ data: { thumbnailLink: link } });
      await expect(
        new GoogleDriveProvider().getThumbnailStream(connection, 'photo', undefined, size),
      ).rejects.toMatchObject({ status: 404 });
      expect(transport.request).not.toHaveBeenCalled();
    });

    it('still refuses a resized link that leaves Google image hosts', async () => {
      transport.get.mockResolvedValue({ data: { thumbnailLink: 'https://evil.example/x=s220' } });
      await expect(
        new GoogleDriveProvider().getThumbnailStream(connection, 'photo', undefined, 960),
      ).rejects.toMatchObject({ status: 502 });
      expect(transport.request).not.toHaveBeenCalled();
    });
  });

  it('requests and maps image dimensions from Drive metadata', async () => {
    transport.list.mockResolvedValue({
      data: {
        files: [
          {
            id: 'photo',
            name: 'photo.heic',
            mimeType: 'image/heic',
            parents: ['folder'],
            imageMediaMetadata: { width: 4032, height: 3024, time: '2024-01-02T03:04:05Z' },
          },
        ],
      },
    });

    const page = await new GoogleDriveProvider().listChildren(connection, 'folder');

    expect(transport.list).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.stringContaining('imageMediaMetadata(width,height,time)'),
      }),
    );
    expect(page.items[0]).toMatchObject({
      imageWidth: 4032,
      imageHeight: 3024,
      imageTime: '2024-01-02T03:04:05Z',
    });
  });

  it('does not fall back to the original when no thumbnail exists', async () => {
    transport.get.mockResolvedValue({ data: {} });
    await expect(
      new GoogleDriveProvider().getThumbnailStream(connection, 'photo'),
    ).rejects.toMatchObject({ status: 404 });
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.request).not.toHaveBeenCalled();
  });

  it.each([
    'http://lh3.googleusercontent.com/image',
    'https://googleusercontent.com.evil.test/image',
    'https://localhost/image',
    'https://user:password@lh3.googleusercontent.com/image',
    'https://lh3.googleusercontent.com:8443/image',
  ])('rejects unsafe thumbnail URL %s before sending credentials', async (url) => {
    transport.get.mockResolvedValue({ data: { thumbnailLink: url } });
    await expect(
      new GoogleDriveProvider().getThumbnailStream(connection, 'photo'),
    ).rejects.toMatchObject({ status: 502 });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('preserves upstream failure status without exposing the private URL', async () => {
    transport.request.mockRejectedValue({ response: { status: 403 }, message: thumbnailLink });
    await expect(
      new GoogleDriveProvider().getThumbnailStream(connection, 'photo'),
    ).rejects.toMatchObject({ status: 403, message: 'Drive thumbnail request failed.' });
  });

  it('does not start requests when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new GoogleDriveProvider().getThumbnailStream(connection, 'photo', controller.signal),
    ).rejects.toThrow();
    expect(transport.get).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('does not download a thumbnail if cancelled while resolving metadata', async () => {
    const controller = new AbortController();
    transport.get.mockImplementation(async () => {
      controller.abort();
      return { data: { thumbnailLink } };
    });
    await expect(
      new GoogleDriveProvider().getThumbnailStream(connection, 'photo', controller.signal),
    ).rejects.toThrow();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('keeps original downloads on the original media endpoint', async () => {
    transport.get.mockResolvedValue({
      data: Readable.from('original'),
      headers: { 'content-type': 'image/png' },
    });
    const signal = new AbortController().signal;
    const media = await new GoogleDriveProvider().getContentStream(connection, 'photo', signal);
    expect(transport.get).toHaveBeenCalledExactlyOnceWith(
      { fileId: 'photo', alt: 'media' },
      { responseType: 'stream', signal },
    );
    expect(media.contentType).toBe('image/png');
    expect(transport.request).not.toHaveBeenCalled();
  });
});
