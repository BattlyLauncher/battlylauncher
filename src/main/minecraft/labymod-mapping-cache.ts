import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { readBoundedRegularFile } from '../files/atomic-file';

export function hasLabyMappingCollision(mapping: string, classes: readonly string[]): boolean {
  const names = new Map<string, string>();
  for (const line of mapping.split(/\r?\n/)) {
    if (!line || /^\s|^tsrg2\s/.test(line)) {
      continue;
    }
    const [source, target] = line.split(/\s+/);
    if (source && target) {
      names.set(source, target);
    }
  }
  const mapped = new Set<string>();
  for (const name of classes) {
    let target = names.get(name);
    if (!target) {
      const parent = name.lastIndexOf('$');
      target =
        parent > 0 && names.has(name.slice(0, parent))
          ? names.get(name.slice(0, parent)) + name.slice(parent)
          : name;
    }
    if (mapped.has(target)) {
      return true;
    }
    mapped.add(target);
  }
  return false;
}

/** Keep a backup; LabyMod regenerates only the invalid derived mapping caches. */
export async function repairLabyMappingCache(
  root: string,
  gameDirectory: string,
  version: string,
  minecraftJar = join(root, 'versions', version, `${version}.jar`),
): Promise<boolean> {
  if (!['1.8.9', '1.12.2'].includes(version)) {
    return false;
  }
  const paths = ['mcp', 'searge'].map((kind) =>
    join(gameDirectory, 'labymod-neo', 'mappings', `${version}-${kind}.tsrg2`),
  );
  const mappings = await Promise.all(
    paths.map((path) =>
      readBoundedRegularFile(path, 16 * 1024 * 1024)
        .then((bytes) => bytes.toString('utf8'))
        .catch(() => null),
    ),
  );
  if (!mappings.some(Boolean)) {
    return false;
  }
  let classes: string[];
  try {
    const bytes = await readBoundedRegularFile(minecraftJar, 128 * 1024 * 1024);
    classes = new AdmZip(bytes)
      .getEntries()
      .filter((entry) => entry.entryName.endsWith('.class'))
      .map((entry) => entry.entryName.slice(0, -6));
  } catch {
    // Inspection is optional: an absent or unreadable game JAR cannot prove a bad cache.
    return false;
  }
  if (!mappings.some((mapping) => mapping && hasLabyMappingCollision(mapping, classes))) {
    return false;
  }
  const suffix = `.invalid-${Date.now()}-${randomUUID()}.bak`;
  let repaired = false;
  for (let i = 0; i < paths.length; i++) {
    if (mappings[i] !== null) {
      try {
        await rename(paths[i], paths[i] + suffix);
        repaired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
  return repaired;
}
