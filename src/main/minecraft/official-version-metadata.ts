import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { networkAvailable } from '../network/connectivity';
import { readBoundedResponseBytes } from '../network/read-bounded-response';

const manifestUrl = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const maxJsonBytes = 8 * 1024 * 1024;
const validId = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;
const validHash = /^[a-f0-9]{40}$/;

interface ManifestEntry {
  readonly id: string;
  readonly sha1: string;
  readonly url: string;
}

function sha1(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class OfficialVersionMetadata {
  #manifest?: Promise<readonly ManifestEntry[]>;
  readonly #refreshes = new Map<string, Promise<boolean>>();

  constructor(private readonly fetchJson: typeof fetch = fetch) {}

  async refresh(root: string, version: string): Promise<boolean> {
    if (!networkAvailable() || !validId.test(version)) {
      return false;
    }
    const path = join(root, 'versions', version, `${version}.json`);
    const existing = this.#refreshes.get(path);
    if (existing) {
      return existing;
    }
    const refresh = this.#refresh(path, version);
    this.#refreshes.set(path, refresh);
    try {
      return await refresh;
    } finally {
      this.#refreshes.delete(path);
    }
  }

  async #refresh(path: string, version: string): Promise<boolean> {
    const manifest = await this.#loadManifest().catch(() => undefined);
    const entry = manifest?.find(({ id }) => id === version);
    if (!entry) {
      return false;
    }

    const current = await readBoundedRegularFile(path, maxJsonBytes).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      return undefined;
    });
    if (current && sha1(current) === entry.sha1) {
      return false;
    }

    const url = new URL(entry.url);
    if (
      !['https://piston-meta.mojang.com', 'https://launchermeta.mojang.com'].includes(url.origin) ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/v1/packages/${entry.sha1}/`)
    ) {
      throw new Error('Invalid official Minecraft metadata URL');
    }
    const updated = await this.#download(url.href);
    if (
      sha1(updated) !== entry.sha1 ||
      asRecord(JSON.parse(updated.toString('utf8')))?.id !== version
    ) {
      throw new Error('Official Minecraft metadata failed integrity verification');
    }
    await writeFileAtomically(path, updated);
    return true;
  }

  async #loadManifest(): Promise<readonly ManifestEntry[]> {
    if (this.#manifest) {
      return this.#manifest;
    }
    const load = this.#download(manifestUrl).then((bytes) => {
      const versions = asRecord(JSON.parse(bytes.toString('utf8')))?.versions;
      if (!Array.isArray(versions)) {
        throw new Error('Invalid official Minecraft version manifest');
      }
      return (versions as unknown[]).filter((entry): entry is ManifestEntry => {
        const record = asRecord(entry);
        return (
          typeof record?.id === 'string' &&
          typeof record.url === 'string' &&
          typeof record.sha1 === 'string' &&
          validHash.test(record.sha1)
        );
      });
    });
    this.#manifest = load;
    try {
      return await load;
    } finally {
      this.#manifest = undefined;
    }
  }

  async #download(url: string): Promise<Buffer> {
    const response = await this.fetchJson(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Official Minecraft metadata returned HTTP ${response.status}`);
    }
    return readBoundedResponseBytes(response, maxJsonBytes);
  }
}
