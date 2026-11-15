import { resolveDisplay } from '../../shared/settings/game-preferences';
import { isAbsolute } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { recommendAutoRam } from '../../shared/settings/auto-ram';

import type { LauncherConfig } from '../../shared/config/launcher-config';
import { minecraftCorePackageFromLauncherConfig } from '../../shared/minecraft/core-package';
import { normalizeInstanceDraft } from '../../shared/minecraft/instance';
import type { JsonValue } from '../../shared/storage/legacy-storage';
import type { MinecraftLaunchOptions } from './launcher-adapter';
import { normalizeMinecraftLaunchOptions } from './launch-options';

const injectorArguments = [
  '-javaagent:authlib-injector.jar=https://api.battlylauncher.com',
  '-Dauthlibinjector.mojangAntiFeatures=enabled',
  '-Dauthlibinjector.noShowServerName',
  '-Dauthlibinjector.disableHttpd',
  '-Xbootclasspath/a:authlib-injector.jar',
] as const;

export interface InstanceLaunchProfileInput {
  readonly account: Readonly<Record<string, JsonValue>>;
  readonly config: LauncherConfig;
  readonly instanceDirectory: string;
  readonly instanceId?: string;
  readonly instanceMetadata: Readonly<Record<string, unknown>>;
  readonly profileValues: Readonly<Record<string, JsonValue>>;
  readonly systemMemory?: { readonly totalBytes: number; readonly freeBytes: number };
}

function own(source: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function databaseStoreValue(
  values: Readonly<Record<string, JsonValue>>,
  storeName: string,
): Readonly<Record<string, unknown>> | null {
  const stores = object(values.dbStores);
  const store = object(stores ? own(stores, storeName) : undefined);
  if (!store) {
    return null;
  }
  for (const entryValue of Object.values(store)) {
    const entry = object(entryValue);
    const value = object(entry ? own(entry, 'value') : undefined);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseJvmArguments(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseJvmArguments(entry));
  }
  const raw = string(value).trim();
  if (!raw) {
    return [];
  }
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) ?? [];
  return tokens
    .map((token) => {
      const quoted =
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"));
      return (quoted ? token.slice(1, -1) : token).replace(/\\(["'\\])/g, '$1').trim();
    })
    .filter(Boolean);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function positiveGb(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(string(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boundedMiB(gigabytes: number): number {
  return Math.min(65_536, Math.max(256, Math.round(gigabytes * 1024)));
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(string(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function accountAuthorization(
  account: Readonly<Record<string, JsonValue>>,
): Record<string, unknown> {
  const uuid = string(own(account, 'uuid'));
  const type = own(account, 'type');
  if (type !== 'battly' && type !== 'microsoft' && type !== 'offline') {
    throw new TypeError('Selected account has an invalid type');
  }
  return {
    uuid,
    name: string(own(account, 'name')),
    type,
    accessToken: string(own(account, 'access_token')) || string(own(account, 'token')) || uuid,
    clientToken: string(own(account, 'client_token')) || uuid,
    userProperties: own(account, 'user_properties'),
  };
}

export function buildInstanceLaunchOptions(
  input: InstanceLaunchProfileInput,
): MinecraftLaunchOptions {
  const metadata = input.instanceMetadata;
  const draft = normalizeInstanceDraft(metadata);
  const launchProfile = object(own(metadata, 'launchProfile')) ?? {};
  const ramStore = databaseStoreValue(input.profileValues, 'ram');
  const screenStore = databaseStoreValue(input.profileValues, 'screen');
  const screen = object(screenStore ? own(screenStore, 'screen') : undefined) ?? {};
  const launcherStore = databaseStoreValue(input.profileValues, 'launcher');
  const launcher = object(launcherStore ? own(launcherStore, 'launcher') : undefined) ?? {};
  const legacyJavaArguments = databaseStoreValue(input.profileValues, 'java-args');

  const automatic = [true, 1, 'true', '1'].includes(
    input.profileValues['b-auto-ram-enabled'] as string | number | boolean,
  );
  const availableMemory = input.systemMemory ?? { totalBytes: totalmem(), freeBytes: freemem() };
  const recommendation = automatic
    ? recommendAutoRam(availableMemory.totalBytes, availableMemory.freeBytes)
    : null;
  const defaultMinimumGb =
    recommendation?.minimumGb ?? positiveGb(ramStore ? own(ramStore, 'ramMin') : undefined) ?? 0.5;
  const defaultMaximumGb =
    recommendation?.maximumGb ?? positiveGb(ramStore ? own(ramStore, 'ramMax') : undefined) ?? 2;
  const requestedMinimumGb = positiveGb(own(launchProfile, 'ramMinGb')) ?? defaultMinimumGb;
  const requestedMaximumGb = positiveGb(own(launchProfile, 'ramMaxGb')) ?? defaultMaximumGb;
  const minimumGb = Math.min(requestedMinimumGb, requestedMaximumGb);
  const maximumGb = requestedMaximumGb;

  const versionKey = draft.version.toLowerCase();
  const byVersion = object(input.profileValues['jvm-args-by-version']) ?? {};
  const versionArguments = own(byVersion, versionKey) ?? own(byVersion, versionKey.split('-')[0]);
  const javaArguments = unique([
    ...injectorArguments,
    ...parseJvmArguments(legacyJavaArguments ? own(legacyJavaArguments, 'args') : undefined),
    ...parseJvmArguments(input.profileValues['jvm-args-instance']),
    ...parseJvmArguments(versionArguments),
    ...parseJvmArguments(own(launchProfile, 'jvmArgs') ?? own(metadata, 'jvmArgs')),
  ]);

  const configuredJavaPath =
    string(own(launchProfile, 'javaVersion')) === 'custom-path'
      ? string(own(launchProfile, 'javaPath'))
      : string(own(launchProfile, 'javaVersion')) === 'automatic'
        ? ''
        : string(input.profileValues['java-path']);
  const javaPath =
    configuredJavaPath && isAbsolute(configuredJavaPath) ? configuredJavaPath : undefined;
  const loader = draft.loader;
  const suffix = loader ? `-${loader}` : '';
  const version =
    suffix && draft.version.toLowerCase().endsWith(suffix.toLowerCase())
      ? draft.version.slice(0, -suffix.length)
      : draft.version;
  const downloadConcurrency = Math.min(
    500,
    Math.max(1, Math.round(numberValue(own(launcher, 'downloadFileMultiple'), 50))),
  );

  return normalizeMinecraftLaunchOptions({
    authorization: accountAuthorization(input.account),
    engine: 'minecraft-java-core',
    root: input.instanceDirectory,
    gameDirectory: input.instanceDirectory,
    version: { id: version, type: 'release' },
    memory: {
      minimumMiB: boundedMiB(minimumGb),
      maximumMiB: boundedMiB(maximumGb),
    },
    javaArguments,
    gameArguments: [...input.config.gameArguments],
    ...(javaPath ? { javaPath } : {}),
    window: resolveDisplay(
      screen,
      input.profileValues['minecraft-display-overrides'],
      version,
      input.instanceId,
    ),
    core: {
      beforeLaunch: input.config.raw.beforeLaunch ?? null,
      descriptor: minecraftCorePackageFromLauncherConfig(input.config.raw),
      downloadConcurrency,
      ignored: own(input.account, 'type') === 'microsoft' ? ['libraries/com/mojang/authlib'] : [],
      loader: {
        type: loader ?? 'vanilla',
        build: draft.loaderVersion ?? 'latest',
        enabled: loader !== null && loader !== 'vanilla',
      },
      resourceUrl:
        typeof input.config.raw.game_url === 'string'
          ? input.config.raw.game_url
          : 'https://api.battlylauncher.com/battlylauncher/files',
      timeoutMs: 10_000,
      verify: false,
    },
  });
}
