import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  parseLegacyStorageDocument,
  planLegacyStorageMigration,
  type JsonValue,
} from '../../shared/storage/legacy-storage';
import {
  pathExists,
  readBoundedRegularFile,
  writeExclusiveAndSync,
  writeFileAtomically,
} from '../files/atomic-file';

const maxStoreBytes = 16 * 1024 * 1024;
const maxManifestBytes = 1024 * 1024;

export interface LegacyStoreMigrationOptions {
  readonly backupDirectory: string;
  readonly migrationId?: string;
  readonly now?: Date;
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface LegacyStoreMigrationResult {
  readonly backupPath: string | null;
  readonly importedKeys: readonly string[];
  readonly manifestPath: string;
  readonly targetPath: string;
}

export interface LegacyStoreRollbackOptions {
  readonly allowedBackupDirectory: string;
  readonly expectedTargetPath: string;
}

interface MigrationManifest {
  readonly backupPath: string | null;
  readonly createdAt: string;
  readonly importedKeys: readonly string[];
  readonly migratedSha256: string;
  readonly schemaVersion: 1;
  readonly sourceSha256: string;
  readonly targetBeforeSha256: string | null;
  readonly targetExisted: boolean;
  readonly targetPath: string;
}

function assertAbsolutePath(value: string, label: string): string {
  if (!value || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return resolve(value);
}

function normalizeMigrationId(value: string | undefined): string {
  const id = value ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) {
    throw new TypeError('Invalid migration id');
  }
  return id;
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readStore(path: string): Promise<{
  readonly content: Buffer;
  readonly values: Readonly<Record<string, JsonValue>>;
}> {
  const content = await readBoundedRegularFile(path, maxStoreBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.toString('utf8')) as unknown;
  } catch {
    throw new TypeError(`Invalid JSON store: ${path}`);
  }
  return { content, values: parseLegacyStorageDocument(parsed).values };
}

function parseManifest(value: unknown): MigrationManifest {
  const document = parseLegacyStorageDocument(value).values;
  const manifest = document as Partial<Record<keyof MigrationManifest, JsonValue>>;
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.targetPath !== 'string' ||
    typeof manifest.targetExisted !== 'boolean' ||
    (manifest.backupPath !== null && typeof manifest.backupPath !== 'string') ||
    (manifest.targetBeforeSha256 !== null && typeof manifest.targetBeforeSha256 !== 'string') ||
    typeof manifest.migratedSha256 !== 'string' ||
    typeof manifest.sourceSha256 !== 'string' ||
    typeof manifest.createdAt !== 'string' ||
    !Array.isArray(manifest.importedKeys) ||
    !manifest.importedKeys.every((key) => typeof key === 'string')
  ) {
    throw new TypeError('Invalid legacy migration manifest');
  }
  return manifest as unknown as MigrationManifest;
}

export async function migrateLegacyStoreFiles(
  options: LegacyStoreMigrationOptions,
): Promise<LegacyStoreMigrationResult> {
  const sourcePath = assertAbsolutePath(options.sourcePath, 'sourcePath');
  const targetPath = assertAbsolutePath(options.targetPath, 'targetPath');
  const backupDirectory = assertAbsolutePath(options.backupDirectory, 'backupDirectory');
  if (sourcePath === targetPath) {
    throw new TypeError('Source and target paths must be different');
  }
  const id = normalizeMigrationId(options.migrationId);
  const source = await readStore(sourcePath);
  const targetExisted = await pathExists(targetPath);
  const target = targetExisted ? await readStore(targetPath) : null;
  const plan = planLegacyStorageMigration(source.values, target?.values ?? {});

  await mkdir(backupDirectory, { recursive: true });
  const backupPath = targetExisted
    ? join(backupDirectory, `battly-storage-${id}.backup.json`)
    : null;
  const manifestPath = join(backupDirectory, `battly-storage-${id}.manifest.json`);
  if (backupPath) {
    await copyFile(targetPath, backupPath, constants.COPYFILE_EXCL);
  }

  const nextContent = `${JSON.stringify(plan.nextValues, null, 2)}\n`;
  await writeFileAtomically(targetPath, nextContent, id);

  const manifest: MigrationManifest = {
    schemaVersion: 1,
    targetPath,
    targetExisted,
    backupPath,
    sourceSha256: sha256(source.content),
    targetBeforeSha256: target ? sha256(target.content) : null,
    migratedSha256: sha256(nextContent),
    importedKeys: plan.importedKeys,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  try {
    await writeExclusiveAndSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    if (backupPath) {
      const previous = await readBoundedRegularFile(backupPath, maxStoreBytes);
      await writeFileAtomically(targetPath, previous.toString('utf8'), `${id}-manifest-rollback`);
    } else if (await pathExists(targetPath)) {
      await unlink(targetPath);
    }
    throw error;
  }

  return { backupPath, importedKeys: plan.importedKeys, manifestPath, targetPath };
}

export async function rollbackLegacyStoreMigration(
  manifestPathValue: string,
  options: LegacyStoreRollbackOptions,
): Promise<void> {
  const manifestPath = assertAbsolutePath(manifestPathValue, 'manifestPath');
  const expectedTargetPath = assertAbsolutePath(options.expectedTargetPath, 'expectedTargetPath');
  const allowedBackupDirectory = assertAbsolutePath(
    options.allowedBackupDirectory,
    'allowedBackupDirectory',
  );
  if (dirname(manifestPath) !== allowedBackupDirectory) {
    throw new TypeError('Manifest is outside the allowed backup directory');
  }

  const manifestContent = await readBoundedRegularFile(manifestPath, maxManifestBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestContent.toString('utf8')) as unknown;
  } catch {
    throw new TypeError('Invalid legacy migration manifest JSON');
  }
  const manifest = parseManifest(parsed);
  if (resolve(manifest.targetPath) !== expectedTargetPath) {
    throw new TypeError('Manifest target does not match the expected target');
  }

  if (await pathExists(expectedTargetPath)) {
    const current = await readBoundedRegularFile(expectedTargetPath, maxStoreBytes);
    if (sha256(current) !== manifest.migratedSha256) {
      throw new TypeError('Migration target changed after migration; rollback refused');
    }
  }

  if (!manifest.targetExisted) {
    if (await pathExists(expectedTargetPath)) {
      await unlink(expectedTargetPath);
    }
    return;
  }

  if (!manifest.backupPath || dirname(resolve(manifest.backupPath)) !== allowedBackupDirectory) {
    throw new TypeError('Manifest backup is outside the allowed backup directory');
  }
  const backup = await readBoundedRegularFile(resolve(manifest.backupPath), maxStoreBytes);
  if (sha256(backup) !== manifest.targetBeforeSha256) {
    throw new TypeError('Legacy migration backup hash mismatch');
  }
  await writeFileAtomically(
    expectedTargetPath,
    backup.toString('utf8'),
    `rollback-${randomUUID()}`,
  );
}
