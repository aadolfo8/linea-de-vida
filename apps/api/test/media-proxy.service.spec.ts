import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DriveAdapter, DriveRequestError } from '../src/drive';
import { MediaProxyService, PrivateThumbnailCache } from '../src/media-proxy.service';

class ResponseMock extends Writable {
  readonly headers = new Map<string, string>();
  readonly chunks: Buffer[] = [];
  set(name: string | Record<string, string>, value?: string) {
    if (typeof name === 'string') this.headers.set(name, value!);
    else Object.entries(name).forEach(([key, header]) => this.headers.set(key, header));
    return this;
  }
  _write(chunk: Buffer, _: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
  body() {
    return Buffer.concat(this.chunks).toString();
  }
}

class FakeDrive extends DriveAdapter {
  thumbnailCalls = 0;
  contentCalls = 0;
  contentStream = Readable.from('original-stream');
  thumbnailStream = Readable.from('thumbnail-stream');
  async listChildren() {
    return { items: [] };
  }
  async getFolder() {
    return null;
  }
  async getThumbnailStream() {
    this.thumbnailCalls++;
    return { stream: this.thumbnailStream, contentType: 'image/jpeg' };
  }
  async getContentStream() {
    this.contentCalls++;
    return { stream: this.contentStream, contentType: 'image/jpeg' };
  }
}

const request = () => new EventEmitter() as unknown as import('express').Request;
const ownerPhoto = (overrides: Record<string, unknown> = {}) => ({
  id: 'photo-owner',
  userId: 'owner',
  driveFileId: 'drive-owner',
  mimeType: 'image/jpeg',
  status: 'ACTIVE',
  source: { status: 'ACTIVE', connection: { status: 'ACTIVE', refreshTokenCiphertext: null } },
  ...overrides,
});

function service(photo: any, drive = new FakeDrive()) {
  return {
    drive,
    service: new MediaProxyService(
      {
        photo: { findFirst: vi.fn(async ({ where }) => (where.userId === 'owner' ? photo : null)) },
      } as any,
      drive,
    ),
  };
}

describe('media proxy', () => {
  it('uses the actual thumbnail MIME rather than the original photo MIME', async () => {
    const { service: proxy } = service(ownerPhoto({ mimeType: 'image/png' }));
    const response = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request(), response as any);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.body()).toBe('thumbnail-stream');
  });

  it('rejects non-image thumbnail responses before sending headers or bytes', async () => {
    const { service: proxy, drive } = service(ownerPhoto());
    const stream = Readable.from('<html>not an image</html>');
    drive.getThumbnailStream = async () => ({ stream, contentType: 'text/html' });
    const response = new ResponseMock();
    await expect(
      proxy.thumbnail('owner', 'photo-owner', request(), response as any),
    ).rejects.toMatchObject({ status: 503 });
    expect(response.body()).toBe('');
    expect(response.headers.has('Content-Type')).toBe(false);
    expect(stream.destroyed).toBe(true);
  });

  it.each(['thumbnail', 'content'] as const)(
    'denies horizontal %s access before Drive',
    async (variant) => {
      const { service: proxy, drive } = service(ownerPhoto());
      await expect(
        proxy[variant]('other', 'photo-owner', request(), new ResponseMock() as any),
      ).rejects.toMatchObject({ status: 404 });
      expect(drive.thumbnailCalls + drive.contentCalls).toBe(0);
    },
  );

  it('streams content without buffering it and uses private no-store headers', async () => {
    const { service: proxy, drive } = service(ownerPhoto());
    const response = new ResponseMock();
    await proxy.content('owner', 'photo-owner', request(), response as any);
    expect(response.body()).toBe('original-stream');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(drive.contentCalls).toBe(1);
  });

  it('keeps HEIC downloadable but gives its thumbnail an accessible compatibility error', async () => {
    const { service: proxy, drive } = service(ownerPhoto({ mimeType: 'image/heic' }));
    await expect(
      proxy.thumbnail('owner', 'photo-owner', request(), new ResponseMock() as any),
    ).rejects.toMatchObject({ status: 415 });
    const response = new ResponseMock();
    await proxy.content('owner', 'photo-owner', request(), response as any);
    expect(response.headers.get('Content-Disposition')).toBe('attachment');
    expect(drive.thumbnailCalls).toBe(0);
  });

  it('maps revoked Drive access and missing photos without requesting media', async () => {
    const denied = service(ownerPhoto());
    denied.drive.getContentStream = async () => {
      throw new DriveRequestError(403, 'forbidden');
    };
    await expect(
      denied.service.content('owner', 'photo-owner', request(), new ResponseMock() as any),
    ).rejects.toMatchObject({ status: 503 });
    const missing = service(ownerPhoto({ status: 'MISSING' }));
    await expect(
      missing.service.content('owner', 'photo-owner', request(), new ResponseMock() as any),
    ).rejects.toMatchObject({ status: 410 });
    expect(missing.drive.contentCalls).toBe(0);
  });

  it('uses only bounded, expiring hashed thumbnail entries', () => {
    vi.useFakeTimers();
    const cache = new PrivateThumbnailCache({
      MEDIA_THUMBNAIL_CACHE_ENABLED: 'true',
      MEDIA_THUMBNAIL_CACHE_TTL_MS: '1000',
      MEDIA_THUMBNAIL_CACHE_MAX_BYTES: '16384',
      MEDIA_THUMBNAIL_CACHE_MAX_ENTRIES: '1',
    });
    cache.set('private-photo-id', Buffer.from('thumbnail'), 'image/jpeg');
    expect(cache.get('private-photo-id')?.body.toString()).toBe('thumbnail');
    cache.set('too-large', Buffer.alloc(16_385), 'image/jpeg');
    expect(cache.get('too-large')).toBeUndefined();
    vi.advanceTimersByTime(1001);
    expect(cache.get('private-photo-id')).toBeUndefined();
    vi.useRealTimers();
  });

  it('serves thumbnail cache hits, misses again after TTL, and never caches originals', async () => {
    vi.useFakeTimers();
    const previous = process.env.MEDIA_THUMBNAIL_CACHE_ENABLED;
    process.env.MEDIA_THUMBNAIL_CACHE_ENABLED = 'true';
    const { service: proxy, drive } = service(ownerPhoto());
    drive.getThumbnailStream = async () => {
      drive.thumbnailCalls++;
      return {
        stream: Readable.from(`thumbnail-${drive.thumbnailCalls}`),
        contentType: 'image/jpeg',
      };
    };
    const first = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request(), first as any);
    const cached = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request(), cached as any);
    expect(first.body()).toBe('thumbnail-1');
    expect(cached.body()).toBe('thumbnail-1');
    expect(drive.thumbnailCalls).toBe(1);
    await proxy.content('owner', 'photo-owner', request(), new ResponseMock() as any);
    expect(drive.contentCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_001);
    const expired = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request(), expired as any);
    expect(expired.body()).toBe('thumbnail-2');
    expect(drive.thumbnailCalls).toBe(2);
    if (previous === undefined) delete process.env.MEDIA_THUMBNAIL_CACHE_ENABLED;
    else process.env.MEDIA_THUMBNAIL_CACHE_ENABLED = previous;
    vi.useRealTimers();
  });

  it.each(['thumbnail', 'content'] as const)(
    'destroys a late %s stream after the client has aborted',
    async (variant) => {
      const { service: proxy, drive } = service(ownerPhoto());
      const stream = new Readable({ read() {} });
      let complete!: (media: { stream: Readable; contentType: string }) => void;
      const operation = new Promise<{ stream: Readable; contentType: string }>((resolve) => {
        complete = resolve;
      });
      const download = vi.fn(() => operation);
      if (variant === 'thumbnail') drive.getThumbnailStream = download;
      else drive.getContentStream = download;
      const client = request();
      const response = new ResponseMock();
      const pending = proxy[variant]('owner', 'photo-owner', client, response as any);
      await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
      client.emit('aborted');
      await pending;
      complete({ stream, contentType: 'image/jpeg' });
      await operation;
      expect(stream.destroyed).toBe(true);
      expect(response.body()).toBe('');
      expect(response.headers.has('Content-Type')).toBe(false);
    },
  );

  it('destroys a slow Drive stream when the client aborts', async () => {
    const { service: proxy, drive } = service(ownerPhoto());
    const slow = new Readable({ read() {} });
    const destroyed = vi.spyOn(slow, 'destroy');
    drive.contentStream = slow;
    const client = request();
    const pending = proxy.content('owner', 'photo-owner', client, new ResponseMock() as any);
    await vi.waitFor(() => expect(drive.contentCalls).toBe(1));
    client.emit('aborted');
    await pending;
    expect(destroyed).toHaveBeenCalled();
  });

  it('cancels a slow Drive stream at the configured timeout', async () => {
    vi.useFakeTimers();
    const previous = process.env.MEDIA_PROXY_TIMEOUT_MS;
    process.env.MEDIA_PROXY_TIMEOUT_MS = '1000';
    const { service: proxy, drive } = service(ownerPhoto());
    const slow = new Readable({ read() {} });
    const destroyed = vi.spyOn(slow, 'destroy');
    drive.contentStream = slow;
    const pending = proxy.content('owner', 'photo-owner', request(), new ResponseMock() as any);
    const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
    await vi.waitFor(() => expect(drive.contentCalls).toBe(1));
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(destroyed).toHaveBeenCalled();
    if (previous === undefined) delete process.env.MEDIA_PROXY_TIMEOUT_MS;
    else process.env.MEDIA_PROXY_TIMEOUT_MS = previous;
    vi.useRealTimers();
  });
});
