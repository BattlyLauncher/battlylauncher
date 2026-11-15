import type { DriveTransferProgress } from '../../shared/settings/drive-progress';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface SnapshotFile {
  md5?: string;
  path: string;
  id: string;
  sha256: string;
  size: number;
}
export interface DriveSnapshot {
  format: 'battly-world-snapshot';
  version: 1;
  worldName: string;
  scope: string;
  createdAt: string;
  files: SnapshotFile[];
}

export function validateSnapshot(value: unknown): DriveSnapshot {
  const data = value as DriveSnapshot;
  if (
    !data ||
    data.format !== 'battly-world-snapshot' ||
    data.version !== 1 ||
    typeof data.worldName !== 'string' ||
    data.worldName.length > 255 ||
    typeof data.scope !== 'string' ||
    data.scope.length > 255 ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    !Array.isArray(data.files) ||
    data.files.length > 100000
  ) {
    throw new Error('Invalid world snapshot');
  }
  const names = new Set<string>();
  let total = 0;
  for (const file of data.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      file.path.length > 1024 ||
      file.path
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            /[\\<>:"|?*]/.test(part) ||
            [...part].some((char) => char.charCodeAt(0) < 32) ||
            /[ .]$/.test(part) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(file.id) ||
      !(
        (file.md5 === undefined && /^[a-f0-9]{64}$/.test(file.sha256)) ||
        (file.sha256 === '' && /^[a-f0-9]{32}$/.test(file.md5 ?? ''))
      ) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 4 * 1024 ** 3 ||
      names.has(file.path.toLowerCase())
    ) {
      throw new Error('Invalid snapshot file');
    }
    names.add(file.path.toLowerCase());
    total += file.size;
    if (total > 32 * 1024 ** 3) {
      throw new Error('Snapshot exceeds restore limit');
    }
  }
  for (const name of names) {
    const parts = name.split('/');
    while (parts.length > 1) {
      parts.pop();
      if (names.has(parts.join('/'))) {
        throw new Error('Conflicting snapshot paths');
      }
    }
  }
  if (!names.has('level.dat')) {
    throw new Error('Snapshot does not contain a Minecraft world');
  }
  return data;
}

export async function hashWorldFile(
  path: string,
  onBytes?: (bytes: number) => void,
): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
    onBytes?.(bytes);
  }
  return hash.digest('hex');
}

export async function inventoryWorldFiles(
  root: string,
): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  const inventory: { path: string; size: number; mtimeMs: number }[] = [];
  let bytes = 0;
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      if (entry.name === 'session.lock') {
        continue;
      }
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = join(root, path);
      const before = await lstat(absolute);
      if (before.isSymbolicLink()) {
        throw new Error('World contains a symbolic link');
      }
      if (before.isDirectory()) {
        await walk(path);
      } else if (before.isFile()) {
        bytes += before.size;
        if (inventory.length >= 100000 || bytes > 32 * 1024 ** 3 || before.size > 4 * 1024 ** 3) {
          throw new Error('World exceeds backup limit');
        }
        inventory.push({ path, size: before.size, mtimeMs: before.mtimeMs });
      }
    }
  };
  if ((await lstat(root)).isSymbolicLink()) {
    throw new Error('Invalid world directory');
  }
  await walk('');
  return inventory;
}

export async function collectWorldFiles(
  root: string,
  onProgress?: (progress: {
    path: string;
    completedFiles: number;
    totalFiles: number;
    completedBytes: number;
    totalBytes: number;
  }) => void,
): Promise<{ path: string; size: number; sha256: string }[]> {
  const result: { path: string; size: number; sha256: string }[] = [];
  const inventory = await inventoryWorldFiles(root);
  const bytes = inventory.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  let lastProgress = 0;
  for (const file of inventory) {
    const absolute = join(root, file.path);
    const report = (current: number, force = false): void => {
      if (!force && Date.now() - lastProgress < 100) {
        return;
      }
      lastProgress = Date.now();
      onProgress?.({
        path: file.path,
        completedFiles: result.length,
        totalFiles: inventory.length,
        completedBytes: completedBytes + current,
        totalBytes: bytes,
      });
    };
    report(0, true);
    const before = await lstat(absolute);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.size !== file.size ||
      before.mtimeMs !== file.mtimeMs
    ) {
      throw new Error('World changed while preparing backup');
    }
    const sha256 = await hashWorldFile(absolute, (current) => report(current));
    const after = await lstat(absolute);
    if (after.size !== file.size || after.mtimeMs !== file.mtimeMs || after.isSymbolicLink()) {
      throw new Error('World changed while preparing backup');
    }
    result.push({ path: file.path, size: file.size, sha256 });
    completedBytes += file.size;
    report(0, true);
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Downloads into an unpublished directory, verifies every byte, then exposes a new world. */
export async function restoreSnapshot(
  raw: unknown,
  savesRoot: string,
  download: (id: string, signal?: AbortSignal) => Promise<Response>,
  progress: (message: string, detail?: DriveTransferProgress) => void = () => undefined,
): Promise<string> {
  const manifest = validateSnapshot(raw);
  await mkdir(savesRoot, { recursive: true });
  const base =
    [...manifest.worldName]
      .map((char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .slice(0, 70) || 'World';
  const name = `${base} - restored-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const target = join(resolve(savesRoot), name);
  const staging = join(resolve(savesRoot), `.restore-${randomUUID()}`);
  await mkdir(staging);
  const controller = new AbortController();
  try {
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
    let completedBytes = 0,
      completedFiles = 0,
      cursor = 0,
      failed = false,
      lastReport = 0;
    let firstFailure: { reason: unknown } | undefined;
    const report = (path: string, force = false): void => {
      if (!force && Date.now() - lastReport < 100) {
        return;
      }
      lastReport = Date.now();
      progress(`Restaurando ${path}…`, {
        phase: 'files',
        completedFiles,
        totalFiles: manifest.files.length,
        completedBytes,
        totalBytes,
      });
    };
    const restore = async (file: SnapshotFile): Promise<void> => {
      report(file.path, true);
      const response = await download(file.id, controller.signal);
      if (!response.ok || !response.body) {
        throw new Error('Could not download backup file');
      }
      const path = join(staging, file.path);
      await mkdir(dirname(path), { recursive: true });
      const handle = await open(path, 'wx');
      const hash = createHash(file.md5 ? 'md5' : 'sha256');
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > file.size) {
            throw new Error('Backup file exceeds declared size');
          }
          hash.update(chunk);
          await handle.writeFile(chunk);
          completedBytes += chunk.byteLength;
          report(file.path);
        }
      } finally {
        await handle.close();
      }
      if (bytes !== file.size || hash.digest('hex') !== (file.md5 || file.sha256)) {
        throw new Error('Backup integrity verification failed');
      }
      completedFiles++;
      report(file.path, true);
    };
    await Promise.allSettled(
      Array.from({ length: Math.min(4, manifest.files.length) }, async () => {
        try {
          while (!failed && cursor < manifest.files.length) {
            await restore(manifest.files[cursor++]);
          }
        } catch (error) {
          firstFailure ??= { reason: error };
          failed = true;
          controller.abort();
          throw error;
        }
      }),
    );
    if (firstFailure) {
      throw firstFailure.reason;
    }
    progress(manifest.worldName, {
      phase: 'publishing',
      completedFiles,
      totalFiles: manifest.files.length,
      completedBytes,
      totalBytes,
    });
    await rename(staging, target);
    return name;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
