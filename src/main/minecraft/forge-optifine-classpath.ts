import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import type { MinecraftLaunchOptions } from './launcher-adapter';

/** OptiFine's transformer reads vanilla patch inputs through the system classloader. */
export function forgeOptiFineClasspath(
  arguments_: readonly string[],
  options: MinecraftLaunchOptions,
): string[] {
  const loader = options.core?.loader;
  if (!loader?.enabled || loader.type !== 'forge') {
    return [...arguments_];
  }
  const index = arguments_.findIndex((value) =>
    ['-cp', '-classpath', '--class-path'].includes(value),
  );
  if (index < 0 || !arguments_[index + 1]) {
    return [...arguments_];
  }
  const client = join(options.root, 'versions', options.version.id, `${options.version.id}.jar`);
  if (!existsSync(client)) {
    return [...arguments_];
  }
  const mods = join(options.gameDirectory, 'mods');
  let hasOptiFine: boolean;
  try {
    hasOptiFine = readdirSync(mods, { withFileTypes: true }).some(
      (entry) =>
        entry.isFile() &&
        entry.name.replace(/^preview_/, '').startsWith(`OptiFine_${options.version.id}_HD_`) &&
        entry.name.endsWith('.jar'),
    );
  } catch {
    return [...arguments_];
  }
  if (!hasOptiFine) {
    return [...arguments_];
  }
  const entries = arguments_[index + 1].split(delimiter);
  if (entries.some((entry) => resolve(entry) === resolve(client))) {
    return [...arguments_];
  }
  const result = [...arguments_];
  result[index + 1] = [...entries, client].join(delimiter);
  return result;
}
