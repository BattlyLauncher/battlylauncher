import { lstat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { readCrashModIds } from './crash-mod-metadata';

export interface CrashModInventory {
  readonly filesById: ReadonlyMap<string, readonly string[]>;
  readonly complete: boolean;
}

/** One bounded metadata pass per diagnosis. Incomplete scans cannot prove absence. */
export async function readCrashModInventory(
  root: string,
  loader?: string,
): Promise<CrashModInventory> {
  const filesById = new Map<string, string[]>();
  let complete = true;
  try {
    const directory = join(root, 'mods'),
      info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return { filesById, complete: false };
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const jars = entries.filter((entry) => extname(entry.name).toLowerCase() === '.jar');
    if (jars.length > 1000 || jars.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
      complete = false;
    }
    const candidates = jars
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .slice(0, 1000);
    const deadline = Date.now() + 5000;
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < candidates.length && Date.now() < deadline) {
          const entry = candidates[next++],
            path = join(directory, entry.name);
          const ids = await readCrashModIds(path, loader);
          if (!ids.size) {
            complete = false;
          }
          for (const id of ids) {
            const paths = filesById.get(id) ?? [];
            paths.push(path);
            filesById.set(id, paths);
          }
        }
      }),
    );
    if (next < candidates.length) {
      complete = false;
    }
  } catch {
    complete = false;
  }
  return { filesById, complete };
}
