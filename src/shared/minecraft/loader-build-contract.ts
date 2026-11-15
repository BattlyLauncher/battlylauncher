export type MinecraftLoaderKind =
  'fabric' | 'forge' | 'legacyfabric' | 'neoforge' | 'quilt' | 'optifine';

export interface LoaderBuild {
  readonly isStable: boolean;
  readonly version: string;
}

export interface LoaderBuildSnapshot {
  readonly builds: readonly LoaderBuild[];
  readonly loader: MinecraftLoaderKind;
  readonly minecraftVersion: string;
}

export interface LoaderGameVersion {
  readonly stable: boolean;
  readonly version: string;
}

export interface LoaderGameVersionSnapshot {
  readonly loader: MinecraftLoaderKind;
  readonly versions: readonly LoaderGameVersion[];
}

const minecraftVersionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;

export function normalizeLoaderBuildRequest(
  loader: unknown,
  minecraftVersion: unknown,
): { readonly loader: MinecraftLoaderKind; readonly minecraftVersion: string } {
  if (
    loader !== 'fabric' &&
    loader !== 'forge' &&
    loader !== 'legacyfabric' &&
    loader !== 'neoforge' &&
    loader !== 'optifine' &&
    loader !== 'quilt'
  ) {
    throw new TypeError('Invalid Minecraft loader');
  }
  if (typeof minecraftVersion !== 'string' || !minecraftVersionPattern.test(minecraftVersion)) {
    throw new TypeError('Invalid Minecraft version');
  }
  return { loader, minecraftVersion };
}
