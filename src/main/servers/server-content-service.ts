import { randomBytes } from 'node:crypto';
import { copyFile, lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

import {
  normalizeServerContentKind,
  normalizeServerContentName,
  normalizeServerId,
  type ServerContentEntry,
  type ServerContentKind,
} from '../../shared/servers/server-contract';
import { pathExists } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const maximumServerContentBytes = 256 * 1024 * 1024;

export class ServerContentService {
  readonly #archiveRoot: string;

  constructor(
    private readonly store: ServerStore,
    archiveRoot: string,
  ) {
    if (!isAbsolute(archiveRoot)) {
      throw new TypeError('Server content archive must be absolute');
    }
    this.#archiveRoot = resolve(archiveRoot);
  }

  async list(idValue: unknown, kindValue: unknown): Promise<readonly ServerContentEntry[]> {
    const id = normalizeServerId(idValue);
    const kind = normalizeServerContentKind(kindValue);
    const directory = await this.#directory(id, kind);
    const entries = await readdir(directory, { withFileTypes: true });
    const result: ServerContentEntry[] = [];
    for (const entry of entries) {
      if (result.length >= 1_000) {
        break;
      }
      if (!entry.isFile() || entry.isSymbolicLink()) {
        continue;
      }
      try {
        const name = normalizeServerContentName(entry.name);
        const info = await lstat(join(directory, name));
        if (!info.isFile() || info.isSymbolicLink() || info.size > maximumServerContentBytes) {
          continue;
        }
        result.push({
          enabled: name.toLowerCase().endsWith('.jar'),
          kind,
          modifiedAt: info.mtime.toISOString(),
          name,
          size: info.size,
        });
      } catch {
        // Ignore unrelated files in the managed content folders.
      }
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  }

  async import(
    idValue: unknown,
    kindValue: unknown,
    sourcePath: string,
  ): Promise<readonly ServerContentEntry[]> {
    const id = normalizeServerId(idValue);
    const kind = normalizeServerContentKind(kindValue);
    if (!isAbsolute(sourcePath)) {
      throw new TypeError('Server content source must be absolute');
    }
    const source = resolve(sourcePath);
    const info = await lstat(source);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size < 4 ||
      info.size > maximumServerContentBytes
    ) {
      throw new TypeError('Invalid server content JAR');
    }
    await assertZipArchive(source);
    const name = normalizeServerContentName(basename(source));
    if (!name.toLowerCase().endsWith('.jar')) {
      throw new TypeError('Imported server content must be a JAR');
    }
    const directory = await this.#directory(id, kind);
    const target = join(directory, name);
    if (await pathExists(target)) {
      throw new Error('Server content already exists');
    }
    const staging = join(directory, `.import-${randomBytes(6).toString('hex')}.pending`);
    try {
      await copyFile(source, staging);
      const copied = await lstat(staging);
      if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== info.size) {
        throw new Error('Server content copy failed');
      }
      await assertZipArchive(staging);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { force: true });
      throw error;
    }
    return this.list(id, kind);
  }

  async toggle(
    idValue: unknown,
    kindValue: unknown,
    nameValue: unknown,
  ): Promise<readonly ServerContentEntry[]> {
    const id = normalizeServerId(idValue);
    const kind = normalizeServerContentKind(kindValue);
    const name = normalizeServerContentName(nameValue);
    const directory = await this.#directory(id, kind);
    const source = join(directory, name);
    const enabled = name.toLowerCase().endsWith('.jar');
    const targetName = enabled ? `${name.slice(0, -4)}.disabled` : `${name.slice(0, -9)}.jar`;
    const target = join(directory, normalizeServerContentName(targetName));
    if (await pathExists(target)) {
      throw new Error('Server content target already exists');
    }
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Invalid server content file');
    }
    await rename(source, target);
    return this.list(id, kind);
  }

  async archive(
    idValue: unknown,
    kindValue: unknown,
    nameValue: unknown,
  ): Promise<readonly ServerContentEntry[]> {
    const id = normalizeServerId(idValue);
    const kind = normalizeServerContentKind(kindValue);
    const name = normalizeServerContentName(nameValue);
    const directory = await this.#directory(id, kind);
    const source = join(directory, name);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Invalid server content file');
    }
    const archive = join(this.#archiveRoot, id, kind);
    await mkdir(archive, { recursive: true });
    const target = join(archive, `${Date.now()}-${name}`);
    await rename(source, target);
    return this.list(id, kind);
  }

  async directory(idValue: unknown, kindValue: unknown): Promise<string> {
    return this.#directory(normalizeServerId(idValue), normalizeServerContentKind(kindValue));
  }

  async #directory(id: string, kind: ServerContentKind): Promise<string> {
    const root = await this.store.directoryPathInternal(id);
    const directory = join(root, kind);
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new TypeError('Invalid server content directory');
    }
    return directory;
  }
}

async function assertZipArchive(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    const marker = signature.readUInt32LE(0);
    if (bytesRead !== 4 || ![0x04034b50, 0x06054b50, 0x08074b50].includes(marker)) {
      throw new TypeError('Invalid server content JAR');
    }
  } finally {
    await handle.close();
  }
}
