import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';

import { normalizeServerId } from '../../shared/servers/server-contract';
import { pathExists } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const maximumArchiveBytes = 2 * 1024 * 1024 * 1024;
const maximumEntries = 200_000;
const maximumExtractedBytes = 8 * 1024 * 1024 * 1024;

function safePath(value: string): string {
  const path = value.replaceAll('\\', '/').replace(/\/$/, '');
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('World archive contains an unsafe path');
  }
  return path;
}

function symbolicLink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.attr >>> 16) & 0o170000) === 0o120000;
}

function destination(root: string, path: string): string {
  const target = resolve(root, ...path.split('/'));
  const relation = relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new TypeError('World archive contains an unsafe path');
  }
  return target;
}

export class ServerWorldImportService {
  readonly #archiveRoot: string;
  readonly #store: ServerStore;

  constructor(store: ServerStore, archiveRoot: string) {
    if (!isAbsolute(archiveRoot)) {
      throw new TypeError('World archive path must be absolute');
    }
    this.#store = store;
    this.#archiveRoot = resolve(archiveRoot);
  }

  async import(idValue: unknown, archivePath: string): Promise<void> {
    const id = normalizeServerId(idValue);
    if (!isAbsolute(archivePath) || !archivePath.toLowerCase().endsWith('.zip')) {
      throw new TypeError('Invalid world archive');
    }
    const archiveInfo = await lstat(archivePath);
    if (
      !archiveInfo.isFile() ||
      archiveInfo.isSymbolicLink() ||
      archiveInfo.size > maximumArchiveBytes
    ) {
      throw new TypeError('Invalid world archive');
    }
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    if (!entries.length || entries.length > maximumEntries) {
      throw new TypeError('World archive entry limit exceeded');
    }
    let extractedBytes = 0;
    const safeEntries = entries.map((entry) => {
      if (symbolicLink(entry)) {
        throw new TypeError('World symbolic links are not supported');
      }
      extractedBytes += entry.header.size;
      if (extractedBytes > maximumExtractedBytes) {
        throw new TypeError('World archive size limit exceeded');
      }
      return { entry, path: safePath(entry.entryName) };
    });
    const levelData = safeEntries
      .filter(
        ({ entry, path }) =>
          !entry.isDirectory && (path === 'level.dat' || path.endsWith('/level.dat')),
      )
      .sort((left, right) => left.path.length - right.path.length)[0];
    if (!levelData) {
      throw new TypeError('World archive does not contain level.dat');
    }
    const worldPrefix = dirname(levelData.path).replaceAll('\\', '/');
    const prefix = worldPrefix === '.' ? '' : `${worldPrefix}/`;
    const directory = await this.#store.directoryPathInternal(id);
    const operationId = randomUUID().replaceAll('-', '');
    const staging = join(directory, `.world-import-${operationId}`);
    const target = join(directory, 'world');
    const backup = join(this.#archiveRoot, `${id}-${Date.now()}-world`);
    await mkdir(staging);
    try {
      for (const { entry, path } of safeEntries) {
        if (prefix && !path.startsWith(prefix)) {
          continue;
        }
        const worldPath = prefix ? path.slice(prefix.length) : path;
        if (!worldPath) {
          continue;
        }
        const output = destination(staging, worldPath);
        if (entry.isDirectory) {
          await mkdir(output, { recursive: true });
        } else {
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, entry.getData());
        }
      }
      if (await pathExists(target)) {
        await mkdir(this.#archiveRoot, { recursive: true });
        await rename(target, backup);
      }
      try {
        await rename(staging, target);
      } catch (error) {
        if (await pathExists(backup)) {
          await rename(backup, target);
        }
        throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
