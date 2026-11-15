import { join } from 'node:path';
import { readBoundedRegularFile } from '../files/atomic-file';
import { readCrashModInventory } from './crash-mod-inventory';
import type { MinecraftLaunchOptions } from './launcher-adapter';

export class LaunchModDuplicatesError extends Error {
  constructor(
    readonly ids: readonly string[],
    readonly loader: string,
  ) {
    super(`Duplicate mandatory mod ids [${ids.join(', ')}]`);
    this.name = 'LaunchModDuplicatesError';
  }
}

async function launchLoader(options: MinecraftLaunchOptions): Promise<string | null> {
  if (options.core) {
    return options.core.loader.enabled ? options.core.loader.type.toLowerCase() : null;
  }
  if (options.forgePath) {
    return 'forge';
  }
  const id = options.version.customId;
  if (!id || !/^[a-z0-9_.+ -]{1,180}$/i.test(id)) {
    return null;
  }
  try {
    const data = JSON.parse(
      (
        await readBoundedRegularFile(
          join(options.root, 'versions', id, `${id}.json`),
          4 * 1024 * 1024,
        )
      ).toString('utf8'),
    ) as {
      mainClass?: string;
      libraries?: { name?: string }[];
    };
    const libraries = Array.isArray(data.libraries) ? data.libraries : [];
    if (libraries.some((item) => item.name?.startsWith('org.quiltmc:quilt-loader:'))) {
      return 'quilt';
    }
    if (libraries.some((item) => item.name?.startsWith('net.fabricmc:fabric-loader:'))) {
      return 'fabric';
    }
    if (libraries.some((item) => item.name?.startsWith('net.neoforged:neoforge:'))) {
      return 'neoforge';
    }
    if (libraries.some((item) => item.name?.startsWith('net.minecraftforge:forge:'))) {
      return 'forge';
    }
  } catch {
    // Missing installed metadata is handled by the launch adapter, not guessed from its filename.
  }
  return null;
}

/** Inspect enabled top-level JARs before either launch engine can start Java. */
export async function checkLaunchModDuplicates(options: MinecraftLaunchOptions): Promise<void> {
  if (options.installOnly) {
    return;
  }
  const loader = await launchLoader(options);
  if (!loader || !['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) {
    return;
  }
  const inventory = await readCrashModInventory(options.gameDirectory, loader);
  const ids = [...inventory.filesById]
    .filter(([, files]) => files.length > 1)
    .map(([id]) => id)
    .sort();
  // An incomplete inventory may prove a duplicate, but never proves a missing dependency.
  if (ids.length) {
    throw new LaunchModDuplicatesError(ids, loader);
  }
}
