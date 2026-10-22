import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
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
  thumbnailSizes: (number | undefined)[] = [];
  async getThumbnailStream(
    _connection?: unknown,
    _fileId?: string,
    _signal?: unknown,
    size?: number,
  ) {
    this.thumbnailCalls++;
    this.thumbnailSizes.push(size);
    return { stream: this.thumbnailStream, contentType: 'image/jpeg' };
  }
  contentFileIds: string[] = [];
  async getContentStream(_connection?: unknown, fileId?: string) {
    this.contentCalls++;
    if (fileId) this.contentFileIds.push(fileId);
    return { stream: this.contentStream, contentType: 'image/jpeg' };
  }
}

const request = (query: Record<string, string> = {}) =>
  Object.assign(new EventEmitter(), { query }) as unknown as import('express').Request;
const activeSource = () => ({
  status: 'ACTIVE',
  connection: { status: 'ACTIVE', refreshTokenCiphertext: null },
});
const copy = (driveFileId: string, extra: Record<string, unknown> = {}) => ({
  id: `file-${driveFileId}`,
  driveFileId,
  mimeType: 'image/jpeg',
  status: 'ACTIVE',
  createdAt: new Date(0),
  source: activeSource(),
  ...extra,
});
const ownerPhoto = (overrides: Record<string, unknown> = {}) => {
  const photo: any = {
    id: 'photo-owner',
    userId: 'owner',
    driveFileId: 'drive-owner',
    mimeType: 'image/jpeg',
    status: 'ACTIVE',
    source: activeSource(),
    ...overrides,
  };
  return {
    files: [copy(photo.driveFileId, { mimeType: photo.mimeType, source: photo.source })],
    ...photo,
  };
};

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

  it('falls back to the original when Drive gives no usable preview for a small tile', async () => {
    const source = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#6b8e23' },
    })
      .jpeg()
      .toBuffer();
    const { service: proxy, drive } = service(ownerPhoto());
    drive.getContentStream = async () => {
      drive.contentCalls++;
      return { stream: Readable.from(source), contentType: 'image/jpeg' };
    };
    const response = new ResponseMock();

    await proxy.thumbnail('owner', 'photo-owner', request({ width: '640' }), response as any);

    const output = Buffer.concat(response.chunks);
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 640, height: 427 });
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400, no-transform');
    expect(drive.contentCalls).toBe(1);
    // The fake preview is not an image: it was tried, rejected by the resize and replaced.
    expect(drive.thumbnailCalls).toBe(1);
  });

  describe('small tiles cut from the Drive preview', () => {
    const preview = () =>
      sharp({ create: { width: 960, height: 640, channels: 3, background: '#445566' } })
        .jpeg()
        .toBuffer();

    it('asks Drive for a slightly larger preview and never downloads the original', async () => {
      const image = await preview();
      const { service: proxy, drive } = service(ownerPhoto());
      drive.getThumbnailStream = async (_c?: unknown, _f?: string, _s?: unknown, size?: number) => {
        drive.thumbnailCalls++;
        drive.thumbnailSizes.push(size);
        return { stream: Readable.from(image), contentType: 'image/jpeg' };
      };
      const response = new ResponseMock();

      await proxy.thumbnail('owner', 'photo-owner', request({ width: '640' }), response as any);

      expect(drive.thumbnailSizes).toEqual([960]);
      expect(drive.contentCalls).toBe(0);
      const metadata = await sharp(Buffer.concat(response.chunks)).metadata();
      expect(metadata).toMatchObject({ format: 'webp', width: 640, height: 427 });
      expect(response.headers.get('Cache-Control')).toBe('private, max-age=86400, no-transform');
    });

    it('uses the original when the preview is refused or is not an image', async () => {
      const original = await sharp({
        create: { width: 1800, height: 1200, channels: 3, background: '#6b8e23' },
      })
        .jpeg()
        .toBuffer();
      for (const failure of [
        () =>
          Promise.reject(new DriveRequestError(404, 'Drive thumbnail size cannot be adjusted.')),
        async () => ({ stream: Readable.from('<html></html>'), contentType: 'text/html' }),
      ]) {
        const { service: proxy, drive } = service(ownerPhoto());
        drive.getThumbnailStream = failure as never;
        drive.getContentStream = async () => {
          drive.contentCalls++;
          return { stream: Readable.from(original), contentType: 'image/jpeg' };
        };
        const response = new ResponseMock();

        await proxy.thumbnail('owner', 'photo-owner', request({ width: '640' }), response as any);

        expect(drive.contentCalls).toBe(1);
        expect((await sharp(Buffer.concat(response.chunks)).metadata()).width).toBe(640);
      }
    });

    it('keeps the large width on the original image', async () => {
      const original = await sharp({
        create: { width: 1800, height: 1200, channels: 3, background: '#6b8e23' },
      })
        .jpeg()
        .toBuffer();
      const { service: proxy, drive } = service(ownerPhoto());
      drive.getContentStream = async () => {
        drive.contentCalls++;
        return { stream: Readable.from(original), contentType: 'image/jpeg' };
      };
      const response = new ResponseMock();

      await proxy.thumbnail('owner', 'photo-owner', request({ width: '1280' }), response as any);

      expect(drive.thumbnailCalls).toBe(0);
      expect(drive.contentCalls).toBe(1);
    });

    it('does not fall back to the original when the client left', async () => {
      const { service: proxy, drive } = service(ownerPhoto());
      const client = request({ width: '640' });
      drive.getThumbnailStream = async () => {
        client.emit('aborted');
        throw new Error('aborted');
      };
      await proxy.thumbnail('owner', 'photo-owner', client, new ResponseMock() as any);
      expect(drive.contentCalls).toBe(0);
    });
  });

  it('keeps responsive cache variants separate by requested width', async () => {
    const previous = process.env.MEDIA_THUMBNAIL_CACHE_ENABLED;
    process.env.MEDIA_THUMBNAIL_CACHE_ENABLED = 'true';
    const source = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#6b8e23' },
    })
      .jpeg()
      .toBuffer();
    const { service: proxy, drive } = service(ownerPhoto());
    drive.getContentStream = async () => {
      drive.contentCalls++;
      return { stream: Readable.from(source), contentType: 'image/jpeg' };
    };

    const first640 = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request({ width: '640' }), first640 as any);
    const cached640 = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request({ width: '640' }), cached640 as any);
    const image1280 = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request({ width: '1280' }), image1280 as any);

    expect(drive.contentCalls).toBe(2);
    expect(cached640.chunks).toEqual(first640.chunks);
    expect((await sharp(Buffer.concat(image1280.chunks)).metadata()).width).toBe(1280);
    if (previous === undefined) delete process.env.MEDIA_THUMBNAIL_CACHE_ENABLED;
    else process.env.MEDIA_THUMBNAIL_CACHE_ENABLED = previous;
  });

  it('rejects arbitrary responsive widths before requesting Drive', async () => {
    const { service: proxy, drive } = service(ownerPhoto());
    await expect(
      proxy.thumbnail(
        'owner',
        'photo-owner',
        request({ width: '999999' }),
        new ResponseMock() as any,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(drive.contentCalls + drive.thumbnailCalls).toBe(0);
  });

  it('uses Drive-generated browser thumbnails for HEIC responsive requests', async () => {
    const { service: proxy, drive } = service(ownerPhoto({ mimeType: 'image/heic' }));
    const response = new ResponseMock();

    await proxy.thumbnail('owner', 'photo-owner', request({ width: '1280' }), response as any);

    expect(drive.contentCalls).toBe(1);
    expect(drive.thumbnailCalls).toBe(1);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it.each(['image/heic', 'image/heif'])(
    'uses Drive-converted browser thumbnails for %s originals',
    async (mimeType) => {
      const { service: proxy, drive } = service(ownerPhoto({ mimeType }));
      const response = new ResponseMock();
      await proxy.thumbnail('owner', 'photo-owner', request(), response as any);
      expect(drive.thumbnailCalls).toBe(1);
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      expect(response.body()).toBe('thumbnail-stream');
    },
  );

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

  it('serves browser-supported GIF originals inline', async () => {
    const { service: proxy } = service(ownerPhoto({ mimeType: 'image/gif' }));
    const response = new ResponseMock();

    await proxy.content('owner', 'photo-owner', request(), response as any);

    expect(response.headers.get('Content-Type')).toBe('image/gif');
    expect(response.headers.get('Content-Disposition')).toBe('inline');
    expect(response.body()).toBe('original-stream');
  });

  it('shows a browser thumbnail for HEIC and keeps its original downloadable', async () => {
    const { service: proxy, drive } = service(ownerPhoto({ mimeType: 'image/heic' }));
    const thumbnail = new ResponseMock();
    await proxy.thumbnail('owner', 'photo-owner', request(), thumbnail as any);
    expect(thumbnail.headers.get('Content-Type')).toBe('image/jpeg');
    expect(thumbnail.body()).toBe('thumbnail-stream');
    const response = new ResponseMock();
    await proxy.content('owner', 'photo-owner', request(), response as any);
    expect(response.headers.get('Content-Disposition')).toBe('attachment');
    expect(drive.thumbnailCalls).toBe(1);
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

  it('serves the content through an active copy when the primary copy is no longer active', async () => {
    const drive = new FakeDrive();
    // The lookup only loads ACTIVE copies: the deleted old export is not among them.
    const { service: proxy } = service(
      ownerPhoto({ driveFileId: 'old-export', files: [copy('new-export')] }),
      drive,
    );
    await proxy.content('owner', 'photo-owner', request(), new ResponseMock() as any);
    expect(drive.contentFileIds).toEqual(['new-export']);
  });

  it('prefers the primary copy and skips copies whose source is disconnected', async () => {
    const drive = new FakeDrive();
    const disconnected = { status: 'DISCONNECTED', connection: { status: 'ACTIVE' } };
    const first = service(
      ownerPhoto({
        driveFileId: 'second',
        files: [
          copy('first', { createdAt: new Date(1) }),
          copy('second', { createdAt: new Date(2) }),
        ],
      }),
      drive,
    );
    await first.service.content('owner', 'photo-owner', request(), new ResponseMock() as any);
    const skipped = service(
      ownerPhoto({
        driveFileId: 'second',
        files: [
          copy('first', { createdAt: new Date(1) }),
          copy('second', { createdAt: new Date(2), source: disconnected }),
        ],
      }),
      drive,
    );
    await skipped.service.content('owner', 'photo-owner', request(), new ResponseMock() as any);
    expect(drive.contentFileIds).toEqual(['second', 'first']);

    const none = service(
      ownerPhoto({ files: [copy('only', { source: disconnected })], driveFileId: 'only' }),
    );
    await expect(
      none.service.content('owner', 'photo-owner', request(), new ResponseMock() as any),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('reports a photo with no active copy as gone', async () => {
    const gone = service(ownerPhoto({ files: [] }));
    await expect(
      gone.service.thumbnail('owner', 'photo-owner', request(), new ResponseMock() as any),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('uses only bounded, expiring hashed thumbnail entries', () => {
    vi.useFakeTimers();
    const cache = new PrivateThumbnailCache({
      MEDIA_THUMBNAIL_CACHE_ENABLED: 'true',
      MEDIA_THUMBNAIL_CACHE_TTL_MS: '1000',
      MEDIA_THUMBNAIL_CACHE_MAX_BYTES: '16384',
      MEDIA_THUMBNAIL_CACHE_MAX_ENTRIES: '1',
      MEDIA_THUMBNAIL_CACHE_TOTAL_MAX_BYTES: '16384',
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
