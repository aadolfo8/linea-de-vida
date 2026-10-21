import { drive_v3, google } from 'googleapis';
import { Readable } from 'node:stream';
import { decryptSecret } from './crypto';

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  imageTime?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailLink?: string | null;
  /** Drive's content hash; together with `size` it identifies the bytes across copies. */
  md5Checksum?: string | null;
  size?: string | null;
};

export class DriveRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}
export abstract class DriveAdapter {
  abstract listChildren(
    connection: { refreshTokenCiphertext: string | null },
    folderId: string,
    cursor?: string,
  ): Promise<{ items: DriveItem[]; nextCursor?: string }>;
  abstract getFolder(
    connection: { refreshTokenCiphertext: string | null },
    folderId: string,
  ): Promise<DriveItem | null>;
  abstract getThumbnailStream(
    connection: { refreshTokenCiphertext: string | null },
    fileId: string,
    signal?: AbortSignal,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }>;
  abstract getContentStream(
    connection: { refreshTokenCiphertext: string | null },
    fileId: string,
    signal?: AbortSignal,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }>;
}
const FOLDER = 'application/vnd.google-apps.folder';
export class GoogleDriveProvider implements DriveAdapter {
  private authClient(connection: { refreshTokenCiphertext: string | null; status?: string }) {
    if (connection.status && connection.status !== 'ACTIVE')
      throw new Error('Drive connection is not active.');
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_DRIVE_REDIRECT_URI,
    );
    auth.setCredentials({
      refresh_token: connection.refreshTokenCiphertext
        ? decryptSecret(connection.refreshTokenCiphertext)
        : undefined,
    });
    return auth;
  }
  private client(connection: { refreshTokenCiphertext: string | null }): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: this.authClient(connection) });
  }
  async listChildren(
    connection: { refreshTokenCiphertext: string | null },
    folderId: string,
    cursor?: string,
  ) {
    let response;
    try {
      response = await this.client(connection).files.list({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        pageToken: cursor,
        pageSize: Math.min(1000, Math.max(1, Number(process.env.SYNC_PAGE_SIZE ?? 100))),
        fields:
          'nextPageToken,files(id,name,mimeType,parents,imageMediaMetadata(width,height,time),thumbnailLink,md5Checksum,size)',
      });
    } catch (error) {
      const underlying = error as {
        response?: { status?: number; headers?: Record<string, string> };
        code?: number;
        message?: string;
      };
      const response = underlying.response;
      const retryAfter = response?.headers?.['retry-after'];
      const retryAfterMs = retryAfter
        ? Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : Math.max(0, Date.parse(retryAfter) - Date.now())
        : undefined;
      const status =
        response?.status ??
        (typeof underlying.code === 'number' ? underlying.code : undefined) ??
        (/not active|invalid/i.test(underlying.message ?? '') ? 400 : 500);
      throw new DriveRequestError(status, 'Drive list request failed.', retryAfterMs);
    }
    return {
      items: (response.data.files ?? [])
        .filter(
          (file): file is drive_v3.Schema$File & { id: string; name: string; mimeType: string } =>
            !!file.id && !!file.name && !!file.mimeType,
        )
        .map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          parents: file.parents ?? [],
          imageTime: file.imageMediaMetadata?.time,
          imageWidth: file.imageMediaMetadata?.width,
          imageHeight: file.imageMediaMetadata?.height,
          thumbnailLink: file.thumbnailLink,
          md5Checksum: file.md5Checksum,
          size: file.size,
        })),
      nextCursor: response.data.nextPageToken ?? undefined,
    };
  }
  async getFolder(connection: { refreshTokenCiphertext: string | null }, folderId: string) {
    try {
      const response = await this.client(connection).files.get({
        fileId: folderId,
        fields: 'id,name,mimeType,parents',
      });
      const file = response.data;
      if (!file.id || !file.name || !file.mimeType) return null;
      return { id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents ?? [] };
    } catch (error) {
      const underlying = error as { response?: { status?: number }; code?: number };
      throw new DriveRequestError(
        underlying.response?.status ?? underlying.code ?? 503,
        'Drive folder request failed.',
      );
    }
  }
  async getThumbnailStream(
    connection: { refreshTokenCiphertext: string | null },
    fileId: string,
    signal?: AbortSignal,
  ) {
    try {
      signal?.throwIfAborted();
      const auth = this.authClient(connection);
      const metadata = await google
        .drive({ version: 'v3', auth })
        .files.get({ fileId, fields: 'thumbnailLink' }, { signal });
      signal?.throwIfAborted();
      if (!metadata.data.thumbnailLink)
        throw new DriveRequestError(404, 'Drive thumbnail is unavailable.');
      const url = new URL(metadata.data.thumbnailLink);
      // Only send OAuth credentials to Google's image hosts, never follow redirects.
      if (
        url.protocol !== 'https:' ||
        !url.hostname.endsWith('.googleusercontent.com') ||
        url.username ||
        url.password ||
        url.port
      )
        throw new DriveRequestError(502, 'Drive thumbnail URL was not accepted.');
      const result = await auth.request<Readable>({
        url: url.href,
        method: 'GET',
        responseType: 'stream',
        maxRedirects: 0,
        signal,
      });
      return {
        stream: result.data,
        contentType: String(result.headers['content-type'] ?? 'application/octet-stream'),
        contentLength: Number(result.headers['content-length']) || undefined,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof DriveRequestError) throw error;
      const underlying = error as { response?: { status?: number }; code?: number };
      throw new DriveRequestError(
        underlying.response?.status ?? underlying.code ?? 503,
        'Drive thumbnail request failed.',
      );
    }
  }
  async getContentStream(
    connection: { refreshTokenCiphertext: string | null },
    fileId: string,
    signal?: AbortSignal,
  ) {
    return this.stream(connection, fileId, signal);
  }
  private async stream(
    connection: { refreshTokenCiphertext: string | null },
    fileId: string,
    signal?: AbortSignal,
  ) {
    try {
      const result = await this.client(connection).files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream', signal },
      );
      return {
        stream: result.data as unknown as Readable,
        contentType: String(result.headers['content-type'] ?? 'application/octet-stream'),
        contentLength: Number(result.headers['content-length']) || undefined,
      };
    } catch (error) {
      const underlying = error as { response?: { status?: number }; code?: number };
      throw new DriveRequestError(
        underlying.response?.status ?? underlying.code ?? 503,
        'Drive media request failed.',
      );
    }
  }
}
/** Development/test provider: deliberately no Google credentials, no browser token. */
export class MemoryDriveProvider implements DriveAdapter {
  constructor(private readonly tree: Record<string, DriveItem[]> = {}) {}
  async listChildren(_: { refreshTokenCiphertext: string | null }, folderId: string) {
    return { items: this.tree[folderId] ?? [] };
  }
  async getFolder(_: { refreshTokenCiphertext: string | null }, folderId: string) {
    for (const items of Object.values(this.tree)) {
      const item = items.find((candidate) => candidate.id === folderId);
      if (item && isFolder(item)) return item;
    }
    return null;
  }
  async getThumbnailStream(_: { refreshTokenCiphertext: string | null }, fileId: string) {
    return { stream: Readable.from(Buffer.from(`thumbnail:${fileId}`)), contentType: 'image/jpeg' };
  }
  async getContentStream(_: { refreshTokenCiphertext: string | null }, fileId: string) {
    return {
      stream: Readable.from(Buffer.from(`content:${fileId}`)),
      contentType: 'application/octet-stream',
    };
  }
}
export const isFolder = (item: DriveItem) => item.mimeType === FOLDER;
export const isImage = (item: DriveItem) =>
  /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(item.mimeType);
