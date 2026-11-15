import {
  lstatSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MinecraftLaunchOptions } from './launcher-adapter';

function readOptions(directory: string): string | null {
  try {
    const file = join(directory, 'options.txt');
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
      return null;
    }
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Share the completed first-run acknowledgement, never narrator or gameplay preferences. */
export function prepareAccessibilityOnboarding(options: MinecraftLaunchOptions): void {
  if (options.installOnly) {
    return;
  }
  const target = readOptions(options.gameDirectory);
  if (target !== null && /^onboardAccessibility:false\r?$/m.test(target)) {
    return;
  }
  const directories = [options.root];
  // Battly Client profiles may use game-<version> rather than client-profiles.
  try {
    for (const entry of readdirSync(options.root, { withFileTypes: true }).slice(0, 512)) {
      if (entry.name.startsWith('game-') && entry.isDirectory() && !entry.isSymbolicLink()) {
        directories.push(join(options.root, entry.name));
      }
    }
  } catch {
    /* An installation may not have created its root yet. */
  }
  const clients = join(options.root, 'client-profiles');
  try {
    for (const entry of readdirSync(clients, { withFileTypes: true }).slice(0, 512)) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        directories.push(join(clients, entry.name));
      }
    }
  } catch {
    /* The first custom launch has no client-profiles directory yet. */
  }
  const completed = directories.some(
    (directory) =>
      resolve(directory) !== resolve(options.gameDirectory) &&
      /^onboardAccessibility:false\r?$/m.test(readOptions(directory) ?? ''),
  );
  if (!completed) {
    return;
  }
  const file = join(options.gameDirectory, 'options.txt');
  // Do not replace a symlink, oversized file or another unreadable existing file.
  if (target === null) {
    try {
      lstatSync(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return;
      }
    }
  }
  const newline = target?.includes('\r\n') ? '\r\n' : '\n';
  const updated =
    target && /^onboardAccessibility:.*$/m.test(target)
      ? target.replace(/^onboardAccessibility:[^\r\n]*/gm, 'onboardAccessibility:false')
      : `${target ?? ''}${target && !target.endsWith('\n') ? newline : ''}onboardAccessibility:false${newline}`;
  mkdirSync(options.gameDirectory, { recursive: true });
  const pending = `${file}.${randomUUID()}.pending`;
  try {
    writeFileSync(pending, updated, { encoding: 'utf8', flag: 'wx' });
    renameSync(pending, file);
  } finally {
    try {
      unlinkSync(pending);
    } catch {
      /* rename consumed the temporary file. */
    }
  }
}
