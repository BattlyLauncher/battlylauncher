import { safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, open } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import {
  configureProtectedData,
  isEncryptedData,
  isProtectedDataPath,
  privateDataPolicy,
  registerPrivateMetadataRoot,
} from './protected-data';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

export async function initializePrivateStorage(
  root: string,
  extraFiles: readonly string[],
  logRoots: readonly string[],
  readOnlyFiles: readonly string[] = [],
): Promise<void> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend()))
  ) {
    throw new Error(
      'Secure storage is unavailable. Unlock your system keychain (GNOME Keyring or KWallet on Linux) and restart Battly. No data has been overwritten.',
    );
  }
  await mkdir(root, { recursive: true });
  const keyPath = join(root, 'private-storage.key');
  const markerPath = join(root, '.private-storage-v1');
  let key: Buffer;
  try {
    const stat = await lstat(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) {
      throw new Error('Invalid storage key file');
    }
    key = Buffer.from(safeStorage.decryptString(await readFile(keyPath)), 'base64');
    if (key.length !== 32) {
      throw new Error('Invalid storage key');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        'Battly could not unlock its local data. Unlock the original system account/keychain and retry. Do not delete private-storage.key.',
        { cause: error },
      );
    }
    try {
      await lstat(markerPath);
      throw new Error(
        'The local storage key is missing. Restore private-storage.key; existing data has not been reset.',
        { cause: error },
      );
    } catch (markerError) {
      if ((markerError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw markerError;
      }
    }
    key = randomBytes(32);
    const handle = await open(keyPath, 'wx', 0o600);
    try {
      await handle.writeFile(safeStorage.encryptString(key.toString('base64')));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  configureProtectedData(key, privateDataPolicy(root, [...extraFiles, ...readOnlyFiles], logRoots));
  key.fill(0);
  try {
    const marker = await open(markerPath, 'wx', 0o600);
    await marker.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  const migrate = async (file: string): Promise<void> => {
    if (!isProtectedDataPath(file)) {
      return;
    }
    let stat;
    try {
      stat = await lstat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Private data must be a regular file');
    }
    const handle = await open(file, 'r');
    const header = Buffer.alloc(32);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    // Existing logs/caches are authenticated on use, not reread in full at every startup.
    if (isEncryptedData(header)) {
      if (extraFiles.includes(file) || resolve(dirname(file)) === resolve(root)) {
        await readBoundedRegularFile(file, 128 * 1024 * 1024);
      }
      return;
    }
    const bytes = await readBoundedRegularFile(file, 128 * 1024 * 1024);
    await writeFileAtomically(file, bytes);
  };
  const walk = async (directory: string, depth = 0): Promise<void> => {
    if (depth > 12) {
      throw new Error('Private data directory nesting limit exceeded');
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isFile()) {
        await migrate(path);
      } else if (entry.isDirectory()) {
        await walk(path, depth + 1);
      }
    }
  };
  // Do not walk game content, downloaded runtimes, Chromium profiles or exported backups.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile()) {
      await migrate(join(root, entry.name));
    }
  }
  for (const name of [
    'cache',
    'mesa-profiles',
    'migration-backups',
    'instance-artwork-cache',
    'logs',
    'battlyworlds/invitations',
  ]) {
    await walk(join(root, name));
  }
  await migrate(join(root, 'battlyworlds', 'overlay.json'));
  for (const file of extraFiles) {
    await migrate(file);
    await migrate(file + '.previous');
  }
  for (const directory of logRoots) {
    await walk(directory);
  }
}

export async function migratePrivateMetadata(
  root: string,
  names: readonly string[],
): Promise<void> {
  registerPrivateMetadataRoot(root, names);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    for (const name of names) {
      const file = join(root, entry.name, name);
      try {
        const content = await readBoundedRegularFile(file, 16 * 1024 * 1024);
        if (!isEncryptedData(await readFile(file))) {
          await writeFileAtomically(file, content);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
}
