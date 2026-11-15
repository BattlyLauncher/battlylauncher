import { parseLegacyStorageDocument, type JsonValue } from '../storage/legacy-storage';

export interface LauncherLoaderConfig {
  readonly build: string;
  readonly enabled: boolean;
  readonly type: string;
}

export interface LauncherConfig {
  readonly christmasTheme: {
    readonly enabled: boolean;
    readonly songEnabled: boolean;
  };
  readonly clientId: string;
  readonly gameArguments: readonly string[];
  readonly installJava: boolean;
  readonly latestVersion: string;
  readonly loader: LauncherLoaderConfig;
  readonly maintenance: boolean;
  readonly maintenanceMessage: string;
  readonly raw: Readonly<Record<string, JsonValue>>;
  readonly verifyInstall: boolean;
}

function requireObject(
  value: JsonValue | undefined,
  field: string,
): Readonly<Record<string, JsonValue>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Launcher configuration field must be an object: ${field}`);
  }
  return value;
}

function requireString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new TypeError(`Launcher configuration field must be a non-empty string: ${field}`);
  }
  return value;
}

function requireBoolean(value: JsonValue | undefined, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Launcher configuration field must be a boolean: ${field}`);
  }
  return value;
}

export function validateLauncherConfig(value: unknown): LauncherConfig {
  const raw = parseLegacyStorageDocument(value).values;
  const gameArgumentsValue = raw.game_args;
  if (
    !Array.isArray(gameArgumentsValue) ||
    !gameArgumentsValue.every((item) => typeof item === 'string')
  ) {
    throw new TypeError('Launcher configuration game_args must be an array of strings');
  }

  const loader = requireObject(raw.loader, 'loader');
  const christmasTheme = requireObject(raw.christmasTheme, 'christmasTheme');
  const maintenanceMessage = raw.maintenance_message;
  if (maintenanceMessage !== undefined && typeof maintenanceMessage !== 'string') {
    throw new TypeError('Launcher configuration maintenance_message must be a string');
  }

  return {
    maintenance: requireBoolean(raw.maintenance, 'maintenance'),
    maintenanceMessage: maintenanceMessage ?? '',
    latestVersion: requireString(raw.latestVersion, 'latestVersion'),
    clientId: requireString(raw.client_id, 'client_id'),
    verifyInstall: requireBoolean(raw.verify, 'verify'),
    installJava: requireBoolean(raw.java, 'java'),
    gameArguments: [...gameArgumentsValue],
    loader: {
      type: requireString(loader.type, 'loader.type'),
      build: requireString(loader.build, 'loader.build'),
      enabled: requireBoolean(loader.enable, 'loader.enable'),
    },
    christmasTheme: {
      enabled: requireBoolean(christmasTheme.enabled, 'christmasTheme.enabled'),
      songEnabled: requireBoolean(christmasTheme.songEnabled, 'christmasTheme.songEnabled'),
    },
    raw,
  };
}
