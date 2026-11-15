import type { LauncherVersionEntry } from './play-version-contract';

export type MinecraftManifestVersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha';

export interface MinecraftManifestVersion {
  readonly id: string;
  readonly type: MinecraftManifestVersionType;
}

export interface DownloadCatalogSnapshot {
  readonly hotVersions?: readonly string[];
  readonly launcher: readonly LauncherVersionEntry[];
  readonly minecraft: readonly MinecraftManifestVersion[];
}

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;

export function validateHotVersions(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid hot versions');
  }
  const source = value as Record<string, unknown>;
  if (source.success !== true || !Array.isArray(source.data)) {
    throw new TypeError('Invalid hot versions');
  }
  return [
    ...new Set(
      source.data.slice(0, 100).flatMap((entry: unknown) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const version = (entry as Record<string, unknown>).version;
        return typeof version === 'string' && idPattern.test(version) ? [version] : [];
      }),
    ),
  ];
}

export function validateMinecraftVersionManifest(
  value: unknown,
): readonly MinecraftManifestVersion[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Minecraft version manifest');
  }
  const versions = (value as Record<string, unknown>).versions;
  if (!Array.isArray(versions) || versions.length > 5000) {
    throw new TypeError('Invalid Minecraft version manifest');
  }
  return versions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const source = candidate as Record<string, unknown>;
    const id = source.id;
    const type = source.type;
    if (typeof id !== 'string' || !idPattern.test(id)) {
      return [];
    }
    if (type !== 'release' && type !== 'snapshot' && type !== 'old_beta' && type !== 'old_alpha') {
      return [];
    }
    return [{ id, type }];
  });
}
