import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';

import {
  normalizeMinecraftCorePackage,
  type MinecraftCorePackage,
} from '../../shared/minecraft/core-package';
import { pathExists, readBoundedRegularFile } from '../files/atomic-file';
import { networkAvailable, OfflineError } from '../network/connectivity';

const maxArchiveBytes = 64 * 1024 * 1024;
const maxExtractedBytes = 256 * 1024 * 1024;
const maxEntries = 20_000;
const maxPackageBytes = 1024 * 1024;
class CoreDownloadUnavailable extends Error {}

export interface MinecraftCoreInstallerOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly libraryPath: string;
  readonly timeoutMs?: number;
  readonly retryDelayMs?: number;
}

export interface MinecraftCoreInstallOptions {
  readonly offlineFallback?: boolean;
}

interface VersionManifest extends MinecraftCorePackage {
  readonly installedAt: string;
}

function isWithin(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference !== '' &&
    !difference.startsWith(`..${sep}`) &&
    difference !== '..' &&
    !isAbsolute(difference)
  );
}

async function responseBuffer(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) {
    throw new Error(`Minecraft core download failed: HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxArchiveBytes) {
    throw new TypeError('Minecraft core archive is too large');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxArchiveBytes) {
      await reader.cancel();
      throw new TypeError('Minecraft core archive is too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
}

function safeEntryName(value: string, rootFolder: string | null): string | null {
  const normalized = value.replaceAll('\\', '/');
  const stripped =
    rootFolder && normalized.startsWith(`${rootFolder}/`)
      ? normalized.slice(rootFolder.length + 1)
      : normalized;
  if (!stripped || stripped.endsWith('/')) {
    return null;
  }
  const parts = stripped.split('/');
  if (
    parts.some(
      (part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes(':'),
    )
  ) {
    throw new TypeError('Minecraft core archive contains an unsafe path');
  }
  return parts.join('/');
}

async function extractArchive(archive: Buffer, destination: string): Promise<void> {
  const entries = new AdmZip(archive).getEntries();
  if (!entries.length || entries.length > maxEntries) {
    throw new TypeError('Minecraft core archive has an invalid entry count');
  }
  const firstRoot = entries[0]?.entryName.replaceAll('\\', '/').split('/')[0] ?? '';
  const rootFolder =
    firstRoot &&
    entries.every((entry) => entry.entryName.replaceAll('\\', '/').startsWith(`${firstRoot}/`))
      ? firstRoot
      : null;
  let extractedBytes = 0;
  for (const entry of entries) {
    const name = safeEntryName(entry.entryName, rootFolder);
    if (!name) {
      continue;
    }
    extractedBytes += entry.header.size;
    if (extractedBytes > maxExtractedBytes) {
      throw new TypeError('Minecraft core archive expands beyond its limit');
    }
    const target = resolve(destination, name);
    if (!isWithin(destination, target)) {
      throw new TypeError('Minecraft core archive escaped its destination');
    }
    const data = entry.getData();
    if (data.byteLength !== entry.header.size) {
      throw new TypeError('Minecraft core archive entry size mismatch');
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { mode: 0o600 });
  }
}

async function validateInstallation(path: string): Promise<void> {
  const packageContent = await readBoundedRegularFile(
    resolve(path, 'package.json'),
    maxPackageBytes,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageContent.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Minecraft core package.json is invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Minecraft core package.json is invalid');
  }
  const main = Object.getOwnPropertyDescriptor(parsed, 'main')?.value as unknown;
  if (typeof main !== 'string' || !main || main.length > 256) {
    throw new TypeError('Minecraft core package has no valid main entry');
  }
  const mainPath = resolve(path, main);
  if (!isWithin(path, mainPath)) {
    throw new TypeError('Minecraft core main entry escapes its package');
  }
  await readBoundedRegularFile(mainPath, maxPackageBytes);
}

export class MinecraftCoreInstaller {
  readonly #fetch: typeof fetch;
  readonly #libraryPath: string;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: MinecraftCoreInstallerOptions) {
    if (!isAbsolute(options.libraryPath)) {
      throw new TypeError('Minecraft core path must be absolute');
    }
    this.#libraryPath = resolve(options.libraryPath);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
    if (!Number.isSafeInteger(this.#retryDelayMs) || this.#retryDelayMs < 0) {
      throw new TypeError('Minecraft core retryDelayMs must be a non-negative integer');
    }
  }

  ensureInstalled(value: unknown, options: MinecraftCoreInstallOptions = {}): Promise<string> {
    const descriptor = normalizeMinecraftCorePackage(value);
    let result = '';
    const operation = this.#queue.then(async () => {
      if (await this.#isCurrent(descriptor)) {
        result = this.#libraryPath;
        return;
      }
      if (!networkAvailable()) {
        if (!options.offlineFallback || !(await this.#hasValidInstallation())) {
          throw new OfflineError();
        }
        result = this.#libraryPath;
        return;
      }
      try {
        await this.#install(descriptor);
      } catch (error) {
        if (
          !(error instanceof CoreDownloadUnavailable) ||
          !options.offlineFallback ||
          !(await this.#hasValidInstallation())
        ) {
          throw error;
        }
      }
      result = this.#libraryPath;
    });
    this.#queue = operation.catch(() => undefined);
    return operation.then(() => result);
  }

  async #hasValidInstallation(): Promise<boolean> {
    try {
      await validateInstallation(this.#libraryPath);
      return true;
    } catch {
      return false;
    }
  }

  async #isCurrent(descriptor: MinecraftCorePackage): Promise<boolean> {
    try {
      const content = await readBoundedRegularFile(
        resolve(this.#libraryPath, 'version.json'),
        maxPackageBytes,
      );
      const manifest = JSON.parse(content.toString('utf8')) as Partial<VersionManifest>;
      if (manifest.version !== descriptor.version || manifest.sha256 !== descriptor.sha256) {
        return false;
      }
      await validateInstallation(this.#libraryPath);
      return true;
    } catch {
      return false;
    }
  }

  async #install(descriptor: MinecraftCorePackage): Promise<void> {
    const parent = dirname(this.#libraryPath);
    const id = randomUUID();
    const staging = resolve(parent, `.minecraft-core-${id}.staging`);
    const displaced = resolve(parent, `.minecraft-core-${id}.previous`);
    if (!isWithin(parent, staging) || !isWithin(parent, displaced)) {
      throw new TypeError('Unsafe Minecraft core staging path');
    }
    await mkdir(staging, { recursive: true });
    let displacedExisting = false;
    try {
      const archive = await this.#download(descriptor.url);
      const checksum = createHash('sha256').update(archive).digest('hex');
      if (checksum !== descriptor.sha256) {
        throw new TypeError('Minecraft core checksum mismatch');
      }
      await extractArchive(archive, staging);
      await validateInstallation(staging);
      const manifest: VersionManifest = { ...descriptor, installedAt: new Date().toISOString() };
      await writeFile(resolve(staging, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o600,
      });
      if (await pathExists(this.#libraryPath)) {
        await rename(this.#libraryPath, displaced);
        displacedExisting = true;
      }
      await rename(staging, this.#libraryPath);
      if (displacedExisting) {
        await rm(displaced, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (displacedExisting && !(await pathExists(this.#libraryPath))) {
        await rename(displaced, this.#libraryPath);
      }
      throw error;
    }
  }

  async #download(url: string): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await this.#fetch(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        return await responseBuffer(response);
      } catch (error) {
        lastError = error;
        if (attempt < 3 && this.#retryDelayMs > 0) {
          await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, this.#retryDelayMs));
        }
      }
    }
    throw new CoreDownloadUnavailable('Minecraft core download failed after 3 attempts', {
      cause: lastError,
    });
  }
}
