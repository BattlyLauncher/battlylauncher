import { constants, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';
import { prepareAccessibilityOnboarding } from './accessibility-onboarding';
import { prepareCustomClientSettings } from './custom-client-settings';

/** 1.7's fixed occlusion buffer cannot hold the chunks requested by newer options files. */
export function prepareLegacyGameOptionsBeforeSpawn(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  gameArguments?: readonly unknown[],
): void {
  // Installed profiles can supply a literal --gameDir instead of the placeholder.
  const index = gameArguments?.lastIndexOf('--gameDir') ?? -1;
  const declared = index >= 0 ? gameArguments?.[index + 1] : undefined;
  if (typeof declared === 'string' && isAbsolute(declared)) {
    const directory = resolve(declared);
    const fromRoot = relative(resolve(options.root), directory);
    if (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)) {
      options = { ...options, gameDirectory: directory };
    }
  }
  prepareCustomClientSettings(options);
  prepareAccessibilityOnboarding(options);
  if (options.installOnly || !/^1\.7(?:\.\d+)?$/.test(options.version.id)) {
    return;
  }
  const path = join(options.gameDirectory, 'options.txt');
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const corrected = source.replace(
    /^(renderDistance:)(\d+)(\r?)$/gm,
    (line: string, prefix: string, value: string, ending: string) =>
      Number(value) > 16 ? `${prefix}16${ending}` : line,
  );
  if (corrected === source) {
    return;
  }
  // Keep the first original options file; repeated launches must not replace this backup.
  try {
    copyFileSync(path, `${path}.battly-before-1.7.bak`, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  writeFileSync(path, corrected, 'utf8');
  emit({
    type: 'log',
    stream: 'game',
    message: '[Battly/INFO] Minecraft 1.7 render distance limited to 16 chunks for compatibility',
  });
}

// Keep preparation errors as rejected promises for existing async callers.
// eslint-disable-next-line @typescript-eslint/require-await
export async function prepareLegacyGameOptions(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
): Promise<void> {
  prepareLegacyGameOptionsBeforeSpawn(options, emit);
}
