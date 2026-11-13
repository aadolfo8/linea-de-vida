import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Bump to invalidate every stored thumbnail when the resize recipe changes. */
const RECIPE = 'v1';
const PRUNE_EVERY_WRITES = 50;
const PRUNE_TARGET = 0.9;

export type StoredThumbnail = { body: Buffer; contentType: string };

/**
 * Persistent thumbnails on disk. A thumbnail is a pure function of the photo's `contentKey`, the
 * width and the recipe, so that triple names both the file and the HTTP ETag: a changed photo gets a
 * new name, and a repeat visit never has to ask Google again. Disabled when no directory is set.
 */
export class ThumbnailStore {
  private readonly dir?: string;
  private readonly maxBytes: number;
  private writesSinceCheck = 0;
  private pruning?: Promise<void>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.dir = env.THUMBNAIL_DIR || undefined;
    const megabytes = Number(env.THUMBNAIL_MAX_MB);
    this.maxBytes = (Number.isFinite(megabytes) && megabytes > 0 ? megabytes : 2048) * 1024 * 1024;
  }

  get enabled() {
    return Boolean(this.dir);
  }

  /** Stable validator for a photo copy at a width; also the file's identity. */
  etag(contentKey: string, width: number) {
    const digest = createHash('sha256').update(`${RECIPE}:${contentKey}`).digest('base64url');
    return `"${digest.slice(0, 22)}-${width}"`;
  }

  private file(userId: string, photoId: string, contentKey: string, width: number) {
    const name = this.etag(contentKey, width).slice(1, -1);
    // Ids come from our database, but never let one steer the path.
    return join(this.dir!, safe(userId), safe(photoId), `${name}.webp`);
  }

  async get(
    userId: string,
    photoId: string,
    contentKey: string,
    width: number,
  ): Promise<StoredThumbnail | null> {
    if (!this.dir) return null;
    const path = this.file(userId, photoId, contentKey, width);
    try {
      const body = await readFile(path);
      const now = new Date();
      void utimes(path, now, now).catch(() => undefined); // recency drives eviction
      return { body, contentType: 'image/webp' };
    } catch {
      return null;
    }
  }

  async set(userId: string, photoId: string, contentKey: string, width: number, body: Buffer) {
    if (!this.dir) return;
    const path = this.file(userId, photoId, contentKey, width);
    const folder = join(this.dir, safe(userId), safe(photoId));
    try {
      await mkdir(folder, { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, body);
      await rename(temporary, path);
      // Older versions of this width belong to a previous contentKey: drop them.
      const suffix = `-${width}.webp`;
      for (const entry of await readdir(folder))
        if (entry.endsWith(suffix) && join(folder, entry) !== path)
          await rm(join(folder, entry), { force: true });
    } catch {
      return; // a full or read-only disk must never fail the request
    }
    if (++this.writesSinceCheck >= PRUNE_EVERY_WRITES) {
      this.writesSinceCheck = 0;
      this.pruning ??= this.prune().finally(() => (this.pruning = undefined));
    }
  }

  /** Deletes the least recently used files until the store is back under 90% of its limit. */
  async prune() {
    if (!this.dir) return;
    const files: { path: string; size: number; used: number }[] = [];
    let total = 0;
    const walk = async (folder: string) => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith('.webp')) {
          const info = await stat(path);
          files.push({ path, size: info.size, used: info.mtimeMs });
          total += info.size;
        }
      }
    };
    try {
      await walk(this.dir);
    } catch {
      return;
    }
    if (total <= this.maxBytes) return;
    files.sort((a, b) => a.used - b.used);
    for (const file of files) {
      if (total <= this.maxBytes * PRUNE_TARGET) break;
      await rm(file.path, { force: true });
      total -= file.size;
    }
  }
}

const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
