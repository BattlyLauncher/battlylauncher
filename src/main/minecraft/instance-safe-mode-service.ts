import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

const backupDirectoryName = '.battly-safe-mode-backup';
const journalFileName = 'journal.json';
const isolatedEntries = ['mods', 'shaderpacks', 'config', 'options.txt'] as const;
const temporaryDirectories = ['mods', 'shaderpacks', 'config'] as const;

interface SafeModeJournal {
  readonly entries: readonly string[];
  readonly version: 1;
}

export interface InstanceSafeModeContext {
  readonly instanceDirectory: string;
}

function absoluteDirectory(path: string): string {
  if (!path || !isAbsolute(path)) {
    throw new TypeError('Instance directory must be absolute');
  }
  return resolve(path);
}

async function assertRealDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError('Safe mode requires a real instance directory');
  }
}

async function renameRecoverably(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== 'EBUSY' && code !== 'EPERM')) {
        throw error;
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25 * (attempt + 1)));
    }
  }
}

async function removeRecoverably(path: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== 'EBUSY' && code !== 'EPERM')) {
        throw error;
      }
      await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50 * (attempt + 1)));
    }
  }
}

function journalPath(root: string): string {
  return join(root, backupDirectoryName, journalFileName);
}

async function readJournal(root: string): Promise<SafeModeJournal | null> {
  const path = journalPath(root);
  if (!(await pathExists(path))) {
    return null;
  }
  const content = await readBoundedRegularFile(path, 16 * 1024);
  const value = JSON.parse(content.toString('utf8')) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Safe mode journal is invalid');
  }
  const source = value as Record<string, unknown>;
  if (
    source.version !== 1 ||
    !Array.isArray(source.entries) ||
    !source.entries.every((entry) =>
      (isolatedEntries as readonly string[]).includes(typeof entry === 'string' ? entry : ''),
    )
  ) {
    throw new TypeError('Safe mode journal is invalid');
  }
  return { version: 1, entries: [...new Set(source.entries as string[])] };
}

export class InstanceSafeModeService {
  async recover(instanceDirectory: string): Promise<boolean> {
    const root = absoluteDirectory(instanceDirectory);
    await assertRealDirectory(root);
    const backupRoot = join(root, backupDirectoryName);
    if (!(await pathExists(backupRoot))) {
      return false;
    }
    await assertRealDirectory(backupRoot);
    const journal = await readJournal(root);
    if (!journal) {
      const entries = await readdir(backupRoot);
      if (entries.length === 0) {
        await removeRecoverably(backupRoot);
      }
      return false;
    }

    for (const entry of isolatedEntries) {
      await removeRecoverably(join(root, entry));
    }
    for (const entry of journal.entries) {
      const backup = join(backupRoot, entry);
      if (await pathExists(backup)) {
        await renameRecoverably(backup, join(root, entry));
      }
    }
    await removeRecoverably(backupRoot);
    return true;
  }

  async prepare(instanceDirectory: string): Promise<InstanceSafeModeContext> {
    const root = absoluteDirectory(instanceDirectory);
    await assertRealDirectory(root);
    await this.recover(root);
    const entries: string[] = [];
    for (const entry of isolatedEntries) {
      if (await pathExists(join(root, entry))) {
        entries.push(entry);
      }
    }
    const backupRoot = join(root, backupDirectoryName);
    await mkdir(backupRoot);
    await writeFileAtomically(
      journalPath(root),
      `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
    );
    try {
      for (const entry of entries) {
        await renameRecoverably(join(root, entry), join(backupRoot, entry));
      }
      for (const entry of temporaryDirectories) {
        await mkdir(join(root, entry));
      }
      await writeFile(join(root, 'options.txt'), 'graphicsMode:1\nrenderDistance:8\n', 'utf8');
      return { instanceDirectory: root };
    } catch (error) {
      await this.recover(root);
      throw error;
    }
  }

  restore(context: InstanceSafeModeContext): Promise<boolean> {
    return this.recover(context.instanceDirectory);
  }
}
