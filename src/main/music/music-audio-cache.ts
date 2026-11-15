import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readdir, rename, rm, utimes } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const maximumTrackBytes = 128 * 1024 * 1024;
const maximumCacheBytes = 1024 * 1024 * 1024;

/** Completed audio survives restarts; interrupted downloads are never cache hits. */
export class MusicAudioCache {
  readonly #pending = new Map<string, Promise<void>>();
  #maintenance = Promise.resolve();
  readonly #revisions = new Map<string, number>();

  async invalidate(id: string, quality: string): Promise<void> {
    const key = createHash('sha256')
      .update(JSON.stringify([id, quality]))
      .digest('hex');
    this.#revisions.set(key, (this.#revisions.get(key) ?? 0) + 1);
    await rm(join(this.directory, `${key}.audio`), { force: true });
  }

  constructor(
    readonly directory: string,
    readonly fetchAudio: typeof fetch = fetch,
  ) {
    if (!isAbsolute(directory)) {
      throw new TypeError('Music cache path must be absolute');
    }
  }

  async file(key: string): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      return null;
    }
    const path = join(this.directory, `${key}.audio`);
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.size < 1 || info.size > maximumTrackBytes) {
      return null;
    }
    await utimes(path, new Date(), new Date()).catch(() => undefined);
    return path;
  }

  async resolve(id: string, quality: string, source: () => Promise<string>): Promise<string> {
    const key = createHash('sha256')
      .update(JSON.stringify([id, quality]))
      .digest('hex');
    if (await this.file(key)) {
      return `battly-audio://cache/${key}`;
    }
    const url = await source();
    if (!this.#pending.has(key)) {
      const pending = this.#download(key, url)
        .catch(() => undefined) // Caching is optional; streaming must continue on disk/network errors.
        .finally(() => this.#pending.delete(key));
      this.#pending.set(key, pending);
    }
    return url;
  }

  async #download(key: string, url: string): Promise<void> {
    const revision = this.#revisions.get(key) ?? 0;
    await mkdir(this.directory, { recursive: true });
    const temporary = join(this.directory, `${key}-${randomUUID()}.pending`);
    try {
      const response = await this.fetchAudio(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || response.status === 206 || !response.body) {
        return;
      }
      const length = Number(response.headers.get('content-length'));
      if (length > maximumTrackBytes) {
        await response.body.cancel();
        return;
      }
      const mime = response.headers.get('content-type') ?? '';
      if (!/^(audio\/|video\/|application\/octet-stream)/i.test(mime)) {
        await response.body.cancel();
        return;
      }
      const handle = await open(temporary, 'wx');
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > maximumTrackBytes) {
            throw new Error('Music cache track too large');
          }
          await handle.writeFile(chunk);
        }
        if (!size || (length > 0 && length !== size)) {
          throw new Error('Incomplete audio');
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if ((this.#revisions.get(key) ?? 0) !== revision) {
        return;
      }
      await rename(temporary, join(this.directory, `${key}.audio`));
      if ((this.#revisions.get(key) ?? 0) !== revision) {
        await rm(join(this.directory, `${key}.audio`), { force: true });
        return;
      }
      this.#maintenance = this.#maintenance.then(() => this.#prune(key)).catch(() => undefined);
      await this.#maintenance;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async #prune(keep: string): Promise<void> {
    const entries = await readdir(this.directory);
    const files = [];
    for (const name of entries) {
      if (/^[a-f0-9]{64}-[a-f0-9-]{36}\.pending$/.test(name)) {
        const path = join(this.directory, name);
        const info = await lstat(path).catch(() => null);
        if (info?.isFile() && Date.now() - info.mtimeMs > 24 * 60 * 60 * 1000) {
          await rm(path).catch(() => undefined);
        }
        continue;
      }
      if (!/^[a-f0-9]{64}\.audio$/.test(name)) {
        continue;
      }
      const path = join(this.directory, name);
      const info = await lstat(path).catch(() => null);
      if (info?.isFile()) {
        files.push({ path, name, size: info.size, time: info.mtimeMs });
      }
    }
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= maximumCacheBytes) {
        break;
      }
      if (file.name === `${keep}.audio`) {
        continue;
      }
      await rm(file.path);
      total -= file.size;
    }
  }
}
