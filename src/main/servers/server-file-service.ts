import { lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  normalizeServerId,
  normalizeServerRelativePath,
  type ServerFileContent,
  type ServerFileEntry,
} from '../../shared/servers/server-contract';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const maximumEntries = 2_000;
const maximumEditableBytes = 2 * 1024 * 1024;
const archiveDirectoryName = '.battly-file-archive';
const atomicTemporaryFilePattern = /^\..+\.[a-zA-Z0-9_-]{1,120}\.(?:pending|displaced)$/;
const editableExtensions = new Set([
  '.cfg',
  '.conf',
  '.json',
  '.log',
  '.md',
  '.properties',
  '.toml',
  '.txt',
  '.yaml',
  '.yml',
]);

export class ServerFileService {
  readonly #store: ServerStore;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(store: ServerStore) {
    this.#store = store;
  }

  async list(idValue: unknown, pathValue: unknown = ''): Promise<ServerFileEntry[]> {
    const id = normalizeServerId(idValue);
    const relativePath = normalizeServerRelativePath(pathValue, true);
    await this.#writeQueue;
    const { root, target } = await this.#target(id, relativePath);
    const targetInfo = await lstat(target);
    if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
      throw new TypeError('Server path must be a real directory');
    }
    const entries = await readdir(target, { withFileTypes: true });
    const result: ServerFileEntry[] = [];
    for (const entry of entries.slice(0, maximumEntries)) {
      if (entry.name === archiveDirectoryName || atomicTemporaryFilePattern.test(entry.name)) {
        continue;
      }
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        continue;
      }
      const fullPath = join(target, entry.name);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) {
        continue;
      }
      const path = relative(root, fullPath).replaceAll('\\', '/');
      result.push({
        path,
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? info.size : null,
        modifiedAt: info.mtime.toISOString(),
        editable: entry.isFile() && editableExtensions.has(extname(entry.name).toLowerCase()),
      });
    }
    return result.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }

  async read(idValue: unknown, pathValue: unknown): Promise<ServerFileContent> {
    const id = normalizeServerId(idValue);
    const path = normalizeServerRelativePath(pathValue);
    const compressedLog = path.toLowerCase().endsWith('.log.gz');
    if (!compressedLog && !editableExtensions.has(extname(path).toLowerCase())) {
      throw new TypeError('Server file type is not editable');
    }
    await this.#writeQueue;
    const { target } = await this.#target(id, path);
    const content = await readBoundedRegularFile(target, maximumEditableBytes);
    return {
      path,
      content: (compressedLog
        ? gunzipSync(content, { maxOutputLength: 16 * 1024 * 1024 })
        : content
      ).toString('utf8'),
    };
  }

  write(idValue: unknown, pathValue: unknown, contentValue: unknown): Promise<ServerFileContent> {
    const id = normalizeServerId(idValue);
    const path = normalizeServerRelativePath(pathValue);
    if (!editableExtensions.has(extname(path).toLowerCase())) {
      throw new TypeError('Server file type is not editable');
    }
    if (
      typeof contentValue !== 'string' ||
      Buffer.byteLength(contentValue) > maximumEditableBytes
    ) {
      throw new TypeError('Server file content exceeds its limit');
    }
    if (extname(path).toLowerCase() === '.json') {
      JSON.parse(contentValue);
    }
    return this.#enqueue(async () => {
      const { target } = await this.#target(id, path);
      await readBoundedRegularFile(target, maximumEditableBytes);
      await writeFileAtomically(target, contentValue);
      return { path, content: contentValue };
    });
  }

  async absoluteFilePath(idValue: unknown, pathValue: unknown): Promise<string> {
    const id = normalizeServerId(idValue);
    const path = normalizeServerRelativePath(pathValue);
    const { target } = await this.#target(id, path);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Server path must be a file');
    }
    return target;
  }

  archive(idValue: unknown, pathValue: unknown): Promise<void> {
    const id = normalizeServerId(idValue);
    const path = normalizeServerRelativePath(pathValue);
    return this.#enqueue(async () => {
      const { root, target } = await this.#target(id, path);
      const info = await lstat(target);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        throw new TypeError('Server path must be a real file or directory');
      }
      const archiveRoot = join(root, archiveDirectoryName);
      await mkdir(archiveRoot, { recursive: true });
      const archivedName = `${Date.now()}-${randomUUID()}-${path.replaceAll('/', '__')}`;
      await rename(target, join(archiveRoot, archivedName));
    });
  }

  async #target(id: string, relativePath: string): Promise<{ root: string; target: string }> {
    const root = resolve(await this.#store.directoryPathInternal(id));
    const target = resolve(root, relativePath);
    const relation = relative(root, target);
    if ((relation && relation.startsWith('..')) || isAbsolute(relation)) {
      throw new TypeError('Server path escapes its directory');
    }
    const normalizedRelation = relation.replaceAll('\\', '/');
    if (
      normalizedRelation === archiveDirectoryName ||
      normalizedRelation.startsWith(`${archiveDirectoryName}/`)
    ) {
      throw new TypeError('Server archive is not directly accessible');
    }
    return { root, target };
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
