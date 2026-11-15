import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import {
  decodePrivateData,
  encodePrivateData,
  isProtectedDataPath,
} from '../storage/protected-data';
import { basename, dirname, join } from 'node:path';

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function readBoundedRegularFile(path: string, maxBytes: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new TypeError(`Expected a regular file: ${path}`);
  }
  if (info.size > (isProtectedDataPath(path) ? maxBytes * 2 + 4096 : maxBytes)) {
    throw new TypeError(`File exceeds size limit: ${path}`);
  }
  const content = decodePrivateData(path, await readFile(path));
  if (content.byteLength > maxBytes) {
    throw new TypeError(`File exceeds size limit: ${path}`);
  }
  return content;
}

export async function writeExclusiveAndSync(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(encodePrivateData(path, content));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeFileAtomically(
  targetPath: string,
  content: string | Uint8Array,
  operationId: string = randomUUID(),
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(operationId)) {
    throw new TypeError('Invalid atomic file operation id');
  }
  const parent = dirname(targetPath);
  await mkdir(parent, { recursive: true });
  const pendingPath = join(parent, `.${basename(targetPath)}.${operationId}.pending`);
  const displacedPath = join(parent, `.${basename(targetPath)}.${operationId}.displaced`);
  // Encrypt using the destination policy, never the temporary filename.
  const handle = await open(pendingPath, 'wx', 0o600);
  try {
    await handle.writeFile(encodePrivateData(targetPath, content));
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (isProtectedDataPath(targetPath)) {
    // Replace directly: never leave a displaced plaintext copy during the first migration.
    try {
      await rename(pendingPath, targetPath);
    } catch (error) {
      await unlink(pendingPath).catch(() => undefined);
      throw error;
    }
    return;
  }
  const targetExisted = await pathExists(targetPath);

  try {
    if (targetExisted) {
      await rename(targetPath, displacedPath);
    }
    await rename(pendingPath, targetPath);
  } catch (error) {
    if (await pathExists(pendingPath)) {
      await unlink(pendingPath);
    }
    if (targetExisted && (await pathExists(displacedPath))) {
      await rename(displacedPath, targetPath);
    }
    throw error;
  }
  if (targetExisted) {
    await unlink(displacedPath).catch(() => undefined);
  }
}

export async function appendPrivateData(path: string, content: string): Promise<void> {
  await appendFile(path, encodePrivateData(path, content), { mode: 0o600 });
}
