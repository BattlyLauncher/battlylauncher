export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const legacyIndexedDbStoreNames = [
  'accounts',
  'accounts-selected',
  'java-path',
  'java-args',
  'launcher',
  'profile',
  'ram',
  'screen',
  'version',
] as const;

export const knownLegacyRootKeys = [
  'WelcomePremiumShown',
  'accounts',
  'activeThemeCloud_v1',
  'autoSyncEnabled',
  'autofix-auto-apply',
  'b-auto-ram-enabled',
  'background-img',
  'background-loading-screen-color',
  'background-video',
  'backupHistory',
  'baseTutorialCompleted',
  'christmas-music-disabled',
  'dataDirectory',
  'dbStores',
  'friendsTutorialCompleted',
  'googleTokens',
  'java-installed',
  'java-path',
  'java-selected-major',
  'jvm-args-by-version',
  'jvm-args-instance',
  'lang',
  'langVersion',
  'language',
  'lastMinecraftLaunch',
  'latest3Versions',
  'launchboost',
  'launcher-update-settings',
  'launcher',
  'legacy-indexeddb-migrated-v1',
  'loading-color',
  'modsTutorialCompleted',
  'musicVolume',
  'musicSettingsV2',
  'mybattlyTutorialCompleted',
  'news_shown_v1.7',
  'news_shown_v2.0',
  'news_shown_v3.0',
  'offline-mode',
  'pendingInstanceToOpen',
  'privacy-security-settings',
  'recentWorlds',
  'selected-account',
  'socket.sessionId',
  'songPlaying',
  'sonido-inicio',
  'sonido-inicio-volumen',
  'sound-click',
  'startup-sound-enabled',
  'theme-color',
  'theme-color-bottom-bar',
  'theme-color-hover',
  'theme-opacity-bottom-bar',
  'verify-install',
] as const;

const knownRootKeySet = new Set<string>(knownLegacyRootKeys);
const unsafeObjectKeys = new Set(['__proto__', 'constructor', 'prototype']);
const maxDepth = 32;
const maxNodes = 100_000;

export interface LegacyStorageSnapshot {
  readonly schemaVersion: 1;
  readonly unknownKeys: readonly string[];
  readonly values: Readonly<Record<string, JsonValue>>;
}

export interface LegacyStorageMigrationPlan {
  readonly schemaVersion: 1;
  readonly importedKeys: readonly string[];
  readonly nextValues: Readonly<Record<string, JsonValue>>;
  readonly preservedTargetKeys: readonly string[];
  readonly unknownSourceKeys: readonly string[];
}

interface CloneBudget {
  nodes: number;
}

function cloneJsonValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: CloneBudget,
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > maxNodes || depth > maxDepth) {
    throw new TypeError('Legacy storage exceeds the supported JSON limits');
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Legacy storage must contain JSON values');
  }
  if (seen.has(value)) {
    throw new TypeError('Legacy storage must not contain circular values');
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const clonedItems: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Legacy storage arrays must contain JSON data properties');
      }
      const item: unknown = descriptor.value as unknown;
      clonedItems.push(cloneJsonValue(item, depth + 1, seen, budget));
    }
    return clonedItems;
  }

  const prototype: unknown = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Legacy storage must contain plain JSON objects');
  }

  const cloned: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) {
    if (!key || key.length > 256 || unsafeObjectKeys.has(key) || key.includes('\0')) {
      throw new TypeError(`Unsafe legacy storage key: ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`Legacy storage key must be a data property: ${key}`);
    }
    const childValue: unknown = descriptor.value as unknown;
    cloned[key] = cloneJsonValue(childValue, depth + 1, seen, budget);
  }
  return cloned;
}

export function parseLegacyStorageDocument(value: unknown): LegacyStorageSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Legacy storage root must be a JSON object');
  }

  const values = cloneJsonValue(value, 0, new WeakSet<object>(), { nodes: 0 });
  if (values === null || Array.isArray(values) || typeof values !== 'object') {
    throw new TypeError('Legacy storage root must be a JSON object');
  }

  return {
    schemaVersion: 1,
    values,
    unknownKeys: Object.keys(values)
      .filter((key) => !knownRootKeySet.has(key))
      .sort(),
  };
}

export function planLegacyStorageMigration(
  sourceValue: unknown,
  targetValue: unknown = {},
): LegacyStorageMigrationPlan {
  const source = parseLegacyStorageDocument(sourceValue);
  const target = parseLegacyStorageDocument(targetValue);
  const nextValues: Record<string, JsonValue> = { ...target.values };
  const importedKeys: string[] = [];

  for (const key of Object.keys(source.values).sort()) {
    if (Object.hasOwn(nextValues, key)) {
      continue;
    }
    nextValues[key] = source.values[key];
    importedKeys.push(key);
  }

  return {
    schemaVersion: 1,
    importedKeys,
    nextValues,
    preservedTargetKeys: Object.keys(target.values).sort(),
    unknownSourceKeys: source.unknownKeys,
  };
}
