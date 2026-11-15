import type { JsonValue } from '../storage/legacy-storage';

export interface MinecraftCorePackage {
  readonly sha256: string;
  readonly url: string;
  readonly version: string;
}

const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const sha256Pattern = /^[0-9a-f]{64}$/i;

function own(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? (descriptor.value as unknown)
    : undefined;
}

export function normalizeMinecraftCorePackage(value: unknown): MinecraftCorePackage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Minecraft core package descriptor must be an object');
  }
  const source = value as Record<string, unknown>;
  const version = own(source, 'version');
  const urlValue = own(source, 'url');
  const sha256 = own(source, 'sha256');
  if (typeof version !== 'string' || !versionPattern.test(version)) {
    throw new TypeError('Invalid Minecraft core version');
  }
  if (typeof sha256 !== 'string' || !sha256Pattern.test(sha256)) {
    throw new TypeError('Invalid Minecraft core checksum');
  }
  if (typeof urlValue !== 'string' || urlValue.length > 2048) {
    throw new TypeError('Invalid Minecraft core URL');
  }
  const url = new URL(urlValue);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const trusted =
    (url.protocol === 'https:' && url.hostname === 'cdn.battlylauncher.com') ||
    (url.protocol === 'http:' && loopback);
  if (!trusted || url.username || url.password) {
    throw new TypeError('Untrusted Minecraft core URL');
  }
  return { version, url: url.toString(), sha256: sha256.toLowerCase() };
}

export function minecraftCorePackageFromLauncherConfig(
  rawConfig: Readonly<Record<string, JsonValue>>,
): MinecraftCorePackage {
  const libraries = rawConfig.libraries;
  if (libraries === null || typeof libraries !== 'object' || Array.isArray(libraries)) {
    throw new TypeError('Launcher configuration has no libraries object');
  }
  return normalizeMinecraftCorePackage(libraries.package_mimbpyzw_s52o);
}
