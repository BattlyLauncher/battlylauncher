import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MinecraftLaunchOptions } from './launcher-adapter';

const preferenceFiles = ['options.txt', 'optionsof.txt', 'optionsshaders.txt'] as const;

function regularPreference(file: string): string | null {
  try {
    const info = lstatSync(file);
    return info.isFile() && !info.isSymbolicLink() && info.size <= 1024 * 1024
      ? readFileSync(file, 'utf8')
      : null;
  } catch {
    return null;
  }
}

/** Seed an isolated client from the old shared settings without synchronizing profiles. */
export function prepareCustomClientSettings(options: MinecraftLaunchOptions): void {
  if (options.installOnly || !options.version.customId) {
    return;
  }
  const root = resolve(options.root);
  const gameDirectory = resolve(options.gameDirectory);
  const difference = relative(root, gameDirectory);
  if (
    !difference ||
    isAbsolute(difference) ||
    difference === '..' ||
    difference.startsWith(`..${sep}`)
  ) {
    return;
  }
  // Do not follow a profile junction into a different installation or user folder.
  let current = root;
  for (const part of difference.split(sep)) {
    current = join(current, part);
    try {
      const info = lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      mkdirSync(current);
    }
  }
  for (const name of preferenceFiles) {
    const source = join(root, name);
    const saved = regularPreference(source);
    if (saved === null || !saved.trim()) {
      continue;
    }
    const destination = join(gameDirectory, name);
    try {
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
    // Earlier launches created options.txt containing only this acknowledgement.
    // It is not a saved set of gameplay preferences and must not block migration.
    const existing = name === 'options.txt' ? regularPreference(destination) : null;
    if (
      existing === null ||
      !existing.trim() ||
      !existing
        .split(/\r?\n/)
        .every((line) => !line.trim() || /^onboardAccessibility:(true|false)$/.test(line))
    ) {
      continue;
    }
    const updated = /^onboardAccessibility:false\r?$/m.test(existing)
      ? saved.replace(/^onboardAccessibility:[^\r\n]*\r?\n?/gm, '') +
        '\nonboardAccessibility:false\n'
      : saved;
    const temporary = `${destination}.${randomUUID()}.pending`;
    try {
      writeFileSync(temporary, updated, { encoding: 'utf8', flag: 'wx' });
      renameSync(temporary, destination);
    } finally {
      try {
        unlinkSync(temporary);
      } catch {
        // A successful rename has already consumed this temporary file.
      }
    }
  }
}
