import { normalizeDirectConnectServer, type MinecraftDirectConnectServer } from './launch-contract';
export interface LauncherVersionEntry {
  readonly folderName: string | null;
  readonly name: string;
  readonly realVersion: string;
  readonly requiredJavaVersion: string | null;
  readonly type: string;
  readonly version: string;
}

export interface PlayRecentVersion {
  readonly customVersion: string;
  readonly dateOpened: string;
  readonly isExtra: boolean;
  readonly loader: string;
  readonly loaderVersion: string;
  readonly requiredJavaVersion: string;
  readonly version: string;
}

export interface InstalledPlayVersion {
  readonly installedAt?: number;
  readonly compatibleLoaders: readonly string[];
  readonly custom: boolean;
  readonly id: string;
  readonly loader: string;
  readonly loaderVersion: string;
  readonly requiredJavaVersion: string | null;
  readonly version: string;
}

export interface PlayVersionSnapshot {
  readonly installed: readonly InstalledPlayVersion[];
  readonly recent: readonly PlayRecentVersion[];
}

export interface PlayVersionLaunchRequest {
  readonly allowDuplicateMods?: boolean;
  readonly instanceId?: string;
  readonly directConnect?: MinecraftDirectConnectServer | null;
  readonly installedVersionId?: string;
  readonly custom: boolean;
  readonly customVersion: string;
  readonly loader: string;
  readonly loaderVersion: string;
  readonly installOptiForge?: boolean;
  readonly installOnly?: boolean;
  readonly requiredJavaVersion: string;
  readonly safeMode: boolean;
  readonly version: string;
}

const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > 128 || value.includes('\0')) {
    throw new TypeError(`Invalid play ${label}`);
  }
  const result = value.trim();
  if (!allowEmpty && !result) {
    throw new TypeError(`Invalid play ${label}`);
  }
  return result;
}

export function normalizePlayVersionLaunchRequest(value: unknown): PlayVersionLaunchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid play version request');
  }
  const source = value as Record<string, unknown>;
  const own = (key: string): unknown => Object.getOwnPropertyDescriptor(source, key)?.value;
  if (own('allowDuplicateMods') !== undefined && typeof own('allowDuplicateMods') !== 'boolean') {
    throw new TypeError('Invalid duplicate mod override');
  }
  const instanceId = own('instanceId');
  if (
    instanceId !== undefined &&
    (typeof instanceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId))
  ) {
    throw new TypeError('Invalid instance id');
  }
  const version = text(own('version'), 'version');
  let customVersion = text(own('customVersion') ?? '', 'custom version', true);
  const loader = text(own('loader') ?? 'vanilla', 'loader');
  const loaderVersion = text(own('loaderVersion') ?? '', 'loader version', true);
  if (!versionPattern.test(version) || (customVersion && !versionPattern.test(customVersion))) {
    throw new TypeError('Invalid play version identifier');
  }
  if (!/^[a-zA-Z0-9._+-]{1,64}$/.test(loader)) {
    throw new TypeError('Invalid play loader');
  }
  const custom = own('custom') === true;
  let installedVersionId = text(own('installedVersionId') ?? '', 'installed version', true);
  if (!custom && loader === 'optifine' && customVersion) {
    installedVersionId ||= customVersion;
    customVersion = '';
  }
  if (installedVersionId && !versionPattern.test(installedVersionId)) {
    throw new TypeError('Invalid installed version');
  }
  if (custom !== Boolean(customVersion)) {
    throw new TypeError('Invalid custom play version');
  }
  return {
    ...(own('allowDuplicateMods') === true ? { allowDuplicateMods: true } : {}),
    ...(instanceId ? { instanceId } : {}),
    installedVersionId,
    directConnect: normalizeDirectConnectServer(own('directConnect')),
    version,
    custom,
    customVersion,
    loader,
    loaderVersion,
    installOptiForge: own('installOptiForge') === true,
    installOnly: own('installOnly') === true,
    requiredJavaVersion: text(own('requiredJavaVersion') ?? '', 'Java version', true),
    safeMode: own('safeMode') === true,
  };
}
