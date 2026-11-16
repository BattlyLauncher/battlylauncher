import { copyFile, lstat, mkdir, readFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { PrivateDataDecryptionError, decodePrivateData, isEncryptedData } from './protected-data';
import { writeFileAtomically } from '../files/atomic-file';

function localFile(root: string, file: string): string | null {
  const part = relative(resolve(root), resolve(file)).replaceAll('\\', '/');
  return part && !part.startsWith('..') && !isAbsolute(part) ? part : null;
}

export function canResetPrivateFile(
  root: string,
  error: unknown,
): error is PrivateDataDecryptionError {
  if (!(error instanceof PrivateDataDecryptionError)) {
    return false;
  }
  const part = localFile(root, error.filePath);
  // Never reset a key, game content, instance metadata or another profile.
  return !!part && !part.includes('/') && /^[a-zA-Z][a-zA-Z0-9_-]*\.json$/.test(part);
}

async function backup(root: string, file: string, move = false): Promise<string> {
  if (!localFile(root, file)) {
    throw new Error('Recovery file is outside the active profile');
  }
  for (let parent = dirname(resolve(file)); ; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('Invalid recovery path');
    }
    if (parent === resolve(root)) {
      break;
    }
    if (parent === dirname(parent)) {
      throw new Error('Invalid recovery root');
    }
  }
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('Recovery requires a regular file');
  }
  const directory = join(root, 'private-recovery');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) {
    throw new Error('Invalid recovery directory');
  }
  const target = join(directory, `${basename(file)}-${randomUUID()}.encrypted`);
  if (move) {
    await rename(file, target);
  } else {
    await copyFile(file, target, constants.COPYFILE_EXCL);
  }
  return target;
}

export async function restorePrivateFile(root: string, error: unknown): Promise<boolean> {
  if (!(error instanceof PrivateDataDecryptionError) || !localFile(root, error.filePath)) {
    return false;
  }
  const previous = `${error.filePath}.previous`;
  try {
    const info = await lstat(previous);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) {
      return false;
    }
    const raw = await readFile(previous);
    if (!isEncryptedData(raw)) {
      return false;
    }
    const bytes = decodePrivateData(error.filePath, raw);
    JSON.parse(bytes.toString('utf8'));
    await backup(root, error.filePath);
    await writeFileAtomically(error.filePath, bytes);
    return true;
  } catch (failure) {
    if (
      failure instanceof PrivateDataDecryptionError ||
      failure instanceof SyntaxError ||
      (failure as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }
    throw failure;
  }
}

export async function resetPrivateFile(
  root: string,
  error: PrivateDataDecryptionError,
): Promise<string> {
  if (!canResetPrivateFile(root, error)) {
    throw new Error('This file cannot be reset automatically');
  }
  const saved = await backup(root, error.filePath, true);
  return dirname(saved);
}

export async function recoverDisposablePrivateFile(root: string, error: unknown): Promise<boolean> {
  if (!(error instanceof PrivateDataDecryptionError)) {
    return false;
  }
  const part = localFile(root, error.filePath);
  if (
    !part ||
    !/^(?:cache\/|instance-artwork-cache\/|notifications\.json$|updates\.json$)/.test(part)
  ) {
    return false;
  }
  await backup(root, error.filePath, true);
  return true;
}
