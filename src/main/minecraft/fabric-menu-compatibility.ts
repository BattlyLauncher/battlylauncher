import { existsSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import type { MinecraftLaunchOptions } from './launcher-adapter';

/** The custom Fabric menu patch uses local zero after vanilla 1.15.2 chops it
 * out of the StackMapTable. Disable only that optional patch, never verification. */
export function fabricMenuCompatibility(options: MinecraftLaunchOptions): MinecraftLaunchOptions {
  if (options.version.id !== '1.15.2') {
    return options;
  }
  const loader = options.core?.loader;
  const build =
    loader?.enabled && loader.type === 'fabric'
      ? loader.build
      : /^fabric-loader-([^-]+)-1\.15\.2$/.exec(options.version.customId ?? '')?.[1];
  if (!build || !/^[\w.+-]+$/.test(build)) {
    return options;
  }
  const jars = ['loader/libraries', 'libraries'].map((root) =>
    join(options.root, root, 'net/fabricmc/fabric-loader', build, `fabric-loader-${build}.jar`),
  );
  if (
    build !== '0.19.5' &&
    !jars.some((file) => {
      try {
        return (
          existsSync(file) &&
          !!new AdmZip(file).getEntry(
            'net/fabricmc/loader/impl/game/minecraft/patch/ModsMenuPatch.class',
          )
        );
      } catch {
        return false;
      }
    })
  ) {
    return options;
  }
  return {
    ...options,
    javaArguments: [
      ...options.javaArguments.filter((arg) => !arg.startsWith('-Dfabric.modsMenu=')),
      '-Dfabric.modsMenu=false',
    ],
  };
}
