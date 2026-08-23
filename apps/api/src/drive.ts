import { drive_v3, google } from 'googleapis';
import { Readable } from 'node:stream';
import { decryptSecret } from './crypto';

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  imageTime?: string | null;
  thumbnailLink?: string | null;
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
  private client(connection: {
    refreshTokenCiphertext: string | null;
    status?: string;
  }): drive_v3.Drive {
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
    return google.drive({ version: 'v3', auth });
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
          'nextPageToken,files(id,name,mimeType,parents,imageMediaMetadata(time),thumbnailLink)',
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
          thumbnailLink: file.thumbnailLink,
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
    return this.stream(connection, fileId, signal);
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
