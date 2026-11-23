import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileDigest(path: string, algorithm: 'sha1' | 'sha512'): Promise<string> {
  const digest = createHash(algorithm);
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest('hex');
}

export type VerifiedDownload = {
  readonly expectedSize: number;
  readonly url: string;
} & (
  | { readonly expectedSha512: string; readonly expectedSha1?: never }
  | { readonly expectedSha512?: never; readonly expectedSha1: string }
);

export interface VerifiedDownloaderOptions {
  readonly validateUrl?: (url: URL) => void;
  readonly archiveDirectory?: string;
  readonly fetchImplementation?: typeof fetch;
}

export class VerifiedDownloader {
  readonly #archiveDirectory: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #validateUrl: ((url: URL) => void) | undefined;

  constructor(options: VerifiedDownloaderOptions = {}) {
    this.#archiveDirectory = options.archiveDirectory;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#validateUrl = options.validateUrl;
  }

  async #response(url: string, signal?: AbortSignal): Promise<Response> {
    let current = new URL(url);
    for (let redirects = 0; redirects <= 8; redirects += 1) {
      this.#validateUrl?.(current);
      const response = await this.#fetch(current, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return response;
      }
      await response.body?.cancel();
      if (redirects === 8) {
        throw new Error('Verified download has too many redirects');
      }
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Verified download redirect has no destination');
      }
      const next = new URL(location, current);
      const privateHost =
        next.hostname === 'localhost' ||
        next.hostname === '::1' ||
        /^127\./.test(next.hostname) ||
        /^10\./.test(next.hostname) ||
        /^192\.168\./.test(next.hostname) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(next.hostname) ||
        /^169\.254\./.test(next.hostname);
      if (next.protocol !== 'https:' || next.username || next.password || privateHost) {
        throw new Error('Verified download refused an unsafe redirect');
      }
      current = next;
    }
    throw new Error('Verified download has too many redirects');
  }

  async download(
    descriptor: VerifiedDownload,
    destination: string,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const algorithm = descriptor.expectedSha512 === undefined ? 'sha1' : 'sha512';
    const expectedHash = descriptor.expectedSha512 ?? descriptor.expectedSha1;
    if (
      (await exists(destination)) &&
      (await fileDigest(destination, algorithm)) === expectedHash
    ) {
      onProgress?.(descriptor.expectedSize, descriptor.expectedSize);
      return;
    }
    const temporary = join(
      dirname(destination),
      `.${randomBytes(6).toString('hex')}-${destination.split(/[\\/]/).at(-1)}.tmp`,
    );
    const response = await this.#response(descriptor.url, signal);
    if (!response.ok || !response.body) {
      throw new Error(`Verified download failed (${response.status})`);
    }
    const contentLength = response.headers.get('content-length');
    const declaredLength = contentLength === null ? null : Number(contentLength);
    if (
      declaredLength !== null &&
      Number.isFinite(declaredLength) &&
      declaredLength !== descriptor.expectedSize
    ) {
      throw new Error('Verified download size mismatch');
    }
    try {
      const handle = await open(temporary, 'wx');
      const digest = createHash(algorithm);
      let bytes = 0;
      onProgress?.(0, descriptor.expectedSize);
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          bytes += value.byteLength;
          if (bytes > descriptor.expectedSize) {
            await reader.cancel();
            throw new Error('Verified download size mismatch');
          }
          digest.update(value);
          await handle.write(value);
          onProgress?.(bytes, descriptor.expectedSize);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (bytes !== descriptor.expectedSize || digest.digest('hex') !== expectedHash) {
        throw new Error('Verified download hash mismatch');
      }
      let archivedPath: string | undefined;
      if (await exists(destination)) {
        if (!this.#archiveDirectory) {
          throw new Error('Verified download destination already exists');
        }
        await mkdir(this.#archiveDirectory, { recursive: true });
        archivedPath = join(
          this.#archiveDirectory,
          `${Date.now()}-${randomBytes(4).toString('hex')}-${destination.split(/[\\/]/).at(-1)}`,
        );
        await rename(destination, archivedPath);
      }
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (archivedPath) {
          await rename(archivedPath, destination).catch(() => undefined);
        }
        throw error;
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
