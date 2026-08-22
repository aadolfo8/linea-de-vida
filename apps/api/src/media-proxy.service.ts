import {
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Request, Response } from 'express';
import { DriveAdapter, DriveRequestError } from './drive';
import { PrismaService } from './prisma.service';

const BROWSER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CONTENT_TYPES = new Set([...BROWSER_IMAGE_TYPES, 'image/heic', 'image/heif']);
type ThumbnailCacheEntry = { expiresAt: number; body: Buffer; contentType: string };

export class PrivateThumbnailCache {
  private readonly entries = new Map<string, ThumbnailCacheEntry>();
  private readonly enabled: boolean;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.enabled = env.MEDIA_THUMBNAIL_CACHE_ENABLED === 'true';
    this.ttlMs = boundedNumber(env.MEDIA_THUMBNAIL_CACHE_TTL_MS, 60_000, 1_000, 300_000);
    this.maxBytes = boundedNumber(
      env.MEDIA_THUMBNAIL_CACHE_MAX_BYTES,
      1_048_576,
      16_384,
      5_242_880,
    );
    this.maxEntries = boundedNumber(env.MEDIA_THUMBNAIL_CACHE_MAX_ENTRIES, 100, 1, 1_000);
  }

  get(photoId: string) {
    if (!this.enabled) return undefined;
    const key = this.key(photoId);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  set(photoId: string, body: Buffer, contentType: string) {
    if (!this.enabled || body.length > this.maxBytes) return;
    this.prune();
    const oldestKey = this.entries.keys().next().value;
    if (this.entries.size >= this.maxEntries && oldestKey) this.entries.delete(oldestKey);
    this.entries.set(this.key(photoId), { body, contentType, expiresAt: Date.now() + this.ttlMs });
  }

  canStore(size: number) {
    return this.enabled && size <= this.maxBytes;
  }

  private key(photoId: string) {
    return createHash('sha256').update(`thumbnail:${photoId}`).digest('base64url');
  }

  private prune() {
    const now = Date.now();
    for (const [key, value] of this.entries) if (value.expiresAt <= now) this.entries.delete(key);
  }
}

@Injectable()
export class MediaProxyService {
  private readonly thumbnailCache = new PrivateThumbnailCache();
  private readonly timeoutMs = boundedNumber(
    process.env.MEDIA_PROXY_TIMEOUT_MS,
    20_000,
    1_000,
    60_000,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: DriveAdapter,
  ) {}

  async thumbnail(userId: string, photoId: string, request: Request, response: Response) {
    const photo = await this.authorize(userId, photoId);
    const mimeType = normalizeMimeType(photo.mimeType);
    if (!BROWSER_IMAGE_TYPES.has(mimeType)) {
      throw new UnsupportedMediaTypeException({
        code: 'HEIC_UNSUPPORTED',
        message:
          'This photo remains indexed. Download the original to view it in a compatible app.',
      });
    }
    const cached = this.thumbnailCache.get(photo.id);
    if (cached) {
      this.headers(response, cached.contentType, true);
      response.end(cached.body);
      return;
    }
    await this.stream(request, response, photo, 'thumbnail', mimeType, (body, contentType) =>
      this.thumbnailCache.set(photo.id, body, contentType),
    );
  }

  async content(userId: string, photoId: string, request: Request, response: Response) {
    const photo = await this.authorize(userId, photoId);
    const mimeType = normalizeMimeType(photo.mimeType);
    if (!CONTENT_TYPES.has(mimeType)) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA',
        message: 'This indexed file cannot be served as an original image.',
      });
    }
    response.set(
      'Content-Disposition',
      BROWSER_IMAGE_TYPES.has(mimeType) ? 'inline' : 'attachment',
    );
    await this.stream(request, response, photo, 'content', mimeType);
  }

  private async authorize(userId: string, photoId: string) {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, userId },
      include: { source: { include: { connection: true } } },
    });
    if (!photo)
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    if (photo.status === 'MISSING')
      throw new GoneException({
        code: 'PHOTO_MISSING',
        message: 'This photo is no longer available in Drive.',
      });
    if (photo.status !== 'ACTIVE')
      throw new NotFoundException({ code: 'PHOTO_UNAVAILABLE', message: 'Photo is unavailable.' });
    if (photo.source.status !== 'ACTIVE' || photo.source.connection.status !== 'ACTIVE')
      throw new ServiceUnavailableException({
        code: 'DRIVE_DISCONNECTED',
        message: 'Drive access is disconnected. Reconnect it before loading media.',
      });
    return photo;
  }

  private async stream(
    request: Request,
    response: Response,
    photo: any,
    variant: 'thumbnail' | 'content',
    contentType: string,
    onThumbnailComplete?: (body: Buffer, contentType: string) => void,
  ) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    try {
      const media = await withAbort(
        variant === 'thumbnail'
          ? this.drive.getThumbnailStream(
              photo.source.connection,
              photo.driveFileId,
              controller.signal,
            )
          : this.drive.getContentStream(
              photo.source.connection,
              photo.driveFileId,
              controller.signal,
            ),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      this.headers(response, contentType, variant === 'thumbnail');
      const collector =
        variant === 'thumbnail'
          ? this.collectThumbnail(onThumbnailComplete, contentType)
          : undefined;
      const abortStream = () =>
        media.stream.destroy(new Error('Client disconnected or media request timed out.'));
      controller.signal.addEventListener('abort', abortStream, { once: true });
      try {
        if (collector) await pipeline(media.stream, collector, response);
        else await pipeline(media.stream, response);
      } finally {
        controller.signal.removeEventListener('abort', abortStream);
      }
    } catch (error) {
      if (response.headersSent || (controller.signal.aborted && !timedOut)) return;
      throw this.driveError(error);
    } finally {
      clearTimeout(timeout);
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
    }
  }

  private collectThumbnail(
    onComplete: ((body: Buffer, contentType: string) => void) | undefined,
    contentType: string,
  ) {
    const parts: Buffer[] = [];
    let size = 0;
    let cacheable = true;
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        if (cacheable) {
          size += chunk.length;
          if (this.thumbnailCache.canStore(size)) parts.push(Buffer.from(chunk));
          else {
            cacheable = false;
            parts.length = 0;
          }
        }
        callback(null, chunk);
      },
      flush: (callback) => {
        if (cacheable && parts.length) onComplete?.(Buffer.concat(parts), contentType);
        callback();
      },
    });
  }

  private headers(response: Response, contentType: string, thumbnail: boolean) {
    response.set({
      'Content-Type': contentType,
      'Cache-Control': thumbnail ? 'private, max-age=60, no-transform' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie',
    });
  }

  private driveError(error: unknown) {
    if (error instanceof DriveRequestError && [401, 403].includes(error.status))
      return new ServiceUnavailableException({
        code: 'DRIVE_ACCESS_REVOKED',
        message: 'Drive denied access. Reconnect Drive and try again.',
      });
    return new ServiceUnavailableException({
      code: 'DRIVE_UNAVAILABLE',
      message: 'Drive media is temporarily unavailable. Try again shortly.',
    });
  }
}

function normalizeMimeType(value: string) {
  return value.toLowerCase().split(';', 1)[0];
}

function boundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new Error('Media request aborted.'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Media request aborted.'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
