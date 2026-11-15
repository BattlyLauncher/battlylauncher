import { isAbsolute, resolve } from 'node:path';

import { pathExists, writeFileAtomically } from '../files/atomic-file';
import { migrateLegacyStoreFiles } from './legacy-store-migration';

export interface ProfileStorePaths {
  readonly backupDirectory: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface ProfileStoreBootstrapResult {
  readonly status: 'created' | 'existing' | 'migrated';
  readonly targetPath: string;
}

function absolutePath(value: string, label: string): string {
  if (!value || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return resolve(value);
}

export async function ensureProfileStore(
  paths: ProfileStorePaths,
): Promise<ProfileStoreBootstrapResult> {
  const sourcePath = absolutePath(paths.sourcePath, 'sourcePath');
  const targetPath = absolutePath(paths.targetPath, 'targetPath');
  const backupDirectory = absolutePath(paths.backupDirectory, 'backupDirectory');
  if (sourcePath === targetPath) {
    throw new TypeError('Source and target profiles must be different');
  }
  if (await pathExists(targetPath)) {
    return { status: 'existing', targetPath };
  }

  if (await pathExists(sourcePath)) {
    await migrateLegacyStoreFiles({ sourcePath, targetPath, backupDirectory });
    return { status: 'migrated', targetPath };
  }

  await writeFileAtomically(targetPath, '{}\n');
  return { status: 'created', targetPath };
}
