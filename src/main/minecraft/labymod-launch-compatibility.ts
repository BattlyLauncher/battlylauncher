import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MinecraftLaunchOptions } from './launcher-adapter';

/** Resolve both legacy installed IDs and profiles selected through their vanilla parent. */
export function labyModLaunchOptions(
  options: MinecraftLaunchOptions,
): MinecraftLaunchOptions | null {
  const id = options.version.customId || options.version.id;
  if (!/^LabyMod-[a-zA-Z0-9._-]+$/.test(id)) {
    return null;
  }
  try {
    const profile = JSON.parse(
      readFileSync(join(options.root, 'versions', id, `${id}.json`), 'utf8'),
    ) as { inheritsFrom?: unknown; labymod_data?: { commitReference?: unknown } };
    if (
      typeof profile.labymod_data?.commitReference !== 'string' ||
      !/^[a-f0-9]{7,64}$/i.test(profile.labymod_data.commitReference) ||
      typeof profile.inheritsFrom !== 'string' ||
      !/^[a-zA-Z0-9._-]+$/.test(profile.inheritsFrom)
    ) {
      return null;
    }
    return { ...options, version: { ...options.version, id: profile.inheritsFrom, customId: id } };
  } catch {
    return null;
  }
}
