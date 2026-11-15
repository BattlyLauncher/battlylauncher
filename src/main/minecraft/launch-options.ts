import { isAbsolute, relative, resolve } from 'node:path';

import {
  isMinecraftLaunchEngine,
  normalizeLaunchWindow,
  type MinecraftDirectConnectServer,
} from '../../shared/minecraft/launch-contract';
import { normalizeMinecraftCorePackage } from '../../shared/minecraft/core-package';
import { parseLegacyStorageDocument } from '../../shared/storage/legacy-storage';
import type { MinecraftAuthorization, MinecraftLaunchOptions } from './launcher-adapter';

export function withDirectConnectArguments(
  options: MinecraftLaunchOptions,
  server: MinecraftDirectConnectServer | null,
): MinecraftLaunchOptions {
  if (!server) {
    return options;
  }
  const release = /^(\d+)\.(\d+)/.exec(options.version.id);
  const snapshot = /^(\d{2})w(\d{2})[a-z]/.exec(options.version.id);
  const quickPlay = release
    ? Number(release[1]) > 1 || (Number(release[1]) === 1 && Number(release[2]) >= 20)
    : !!snapshot &&
      (Number(snapshot[1]) > 23 || (Number(snapshot[1]) === 23 && Number(snapshot[2]) >= 14));
  const host =
    server.host.includes(':') && !server.host.startsWith('[') ? `[${server.host}]` : server.host;
  return {
    ...options,
    gameArguments: [
      ...options.gameArguments,
      ...(quickPlay
        ? ['--quickPlayMultiplayer', `${host}:${server.port}`]
        : ['--server', server.host, '--port', String(server.port)]),
    ],
  };
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;
const accountIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function stringField(source: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = own(source, key);
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.includes('\0')
  ) {
    throw new TypeError(`Invalid ${key}`);
  }
  return value;
}

function identifier(source: Record<string, unknown>, key: string): string {
  const value = own(source, key);
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new TypeError(`Invalid ${key}`);
  }
  return value;
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || !isAbsolute(value) || value.includes('\0')) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return resolve(value);
}

function pathInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value as number;
}

function argumentList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value.map((argument) => {
    if (typeof argument !== 'string' || argument.length > 2048 || argument.includes('\0')) {
      throw new TypeError(`Invalid ${label}`);
    }
    return argument;
  });
}

function httpsOrLoopbackUrl(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > 2048) {
    throw new TypeError(`Invalid ${label}`);
  }
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  return url.toString();
}

function coreOptions(value: unknown): NonNullable<MinecraftLaunchOptions['core']> {
  const source = record(value, 'core');
  const loader = record(own(source, 'loader'), 'core.loader');
  const beforeLaunch = parseLegacyStorageDocument({ beforeLaunch: own(source, 'beforeLaunch') })
    .values.beforeLaunch;
  return {
    beforeLaunch: beforeLaunch ?? null,
    descriptor: normalizeMinecraftCorePackage(own(source, 'descriptor')),
    downloadConcurrency: integer(
      own(source, 'downloadConcurrency'),
      'core.downloadConcurrency',
      1,
      500,
    ),
    ignored: argumentList(own(source, 'ignored'), 'core.ignored'),
    loader: {
      type: identifier({ 'core.loader.type': own(loader, 'type') }, 'core.loader.type'),
      build: identifier({ 'core.loader.build': own(loader, 'build') }, 'core.loader.build'),
      enabled: own(loader, 'enabled') === true,
      ...(own(loader, 'path') === undefined ? {} : { path: stringField(loader, 'path', 512) }),
    },
    resourceUrl: httpsOrLoopbackUrl(own(source, 'resourceUrl'), 'core.resourceUrl'),
    timeoutMs: integer(own(source, 'timeoutMs'), 'core.timeoutMs', 1_000, 120_000),
    verify: own(source, 'verify') === true,
  };
}

function authorization(value: unknown): MinecraftAuthorization {
  const source = record(value, 'authorization');
  const type = own(source, 'type');
  if (type !== 'battly' && type !== 'microsoft' && type !== 'offline') {
    throw new TypeError('Invalid authorization.type');
  }
  const uuid = stringField(source, 'uuid', 64);
  if (!accountIdPattern.test(uuid)) {
    throw new TypeError('Invalid authorization.uuid');
  }
  return {
    type,
    uuid,
    name: stringField(source, 'name', 64),
    accessToken: stringField(source, 'accessToken', 16_384),
    clientToken: stringField(source, 'clientToken', 16_384),
    userProperties: own(source, 'userProperties'),
  };
}

export function normalizeMinecraftLaunchOptions(value: unknown): MinecraftLaunchOptions {
  const source = record(value, 'launch options');
  const engine = own(source, 'engine');
  if (!isMinecraftLaunchEngine(engine)) {
    throw new TypeError('Invalid engine');
  }
  const root = absolutePath(own(source, 'root'), 'root');
  const gameDirectory = absolutePath(own(source, 'gameDirectory'), 'gameDirectory');
  if (!pathInside(root, gameDirectory)) {
    throw new TypeError('gameDirectory must stay inside root');
  }
  const version = record(own(source, 'version'), 'version');
  const memory = record(own(source, 'memory'), 'memory');
  const minimumMiB = integer(own(memory, 'minimumMiB'), 'memory.minimumMiB', 256, 65_536);
  const maximumMiB = integer(own(memory, 'maximumMiB'), 'memory.maximumMiB', 256, 65_536);
  if (minimumMiB > maximumMiB) {
    throw new TypeError('minimumMiB cannot exceed maximumMiB');
  }

  const customIdValue = own(version, 'customId');
  const instanceIdValue = own(source, 'instanceId');
  const javaPathValue = own(source, 'javaPath');
  const forgePathValue = own(source, 'forgePath');
  const coreValue = own(source, 'core');
  const forgePath =
    forgePathValue === undefined ? undefined : absolutePath(forgePathValue, 'forgePath');
  if (forgePath && !pathInside(root, forgePath)) {
    throw new TypeError('forgePath must stay inside root');
  }
  return {
    authorization: authorization(own(source, 'authorization')),
    engine,
    ...(coreValue === undefined ? {} : { core: coreOptions(coreValue) }),
    root,
    gameDirectory,
    ...(own(source, 'installOptiForge') === true ? { installOptiForge: true } : {}),
    ...(own(source, 'installOnly') === true ? { installOnly: true } : {}),
    ...(instanceIdValue === undefined
      ? {}
      : { instanceId: identifier({ instanceId: instanceIdValue }, 'instanceId') }),
    version: {
      id: identifier({ 'version.id': own(version, 'id') }, 'version.id'),
      type: identifier({ 'version.type': own(version, 'type') }, 'version.type'),
      ...(customIdValue === undefined
        ? {}
        : { customId: identifier({ customId: customIdValue }, 'customId') }),
    },
    memory: { minimumMiB, maximumMiB },
    javaArguments: argumentList(own(source, 'javaArguments'), 'javaArguments'),
    gameArguments: argumentList(own(source, 'gameArguments'), 'gameArguments'),
    ...(javaPathValue === undefined ? {} : { javaPath: absolutePath(javaPathValue, 'javaPath') }),
    ...(forgePath ? { forgePath } : {}),
    window: normalizeLaunchWindow(
      own(source, 'window') as Partial<MinecraftLaunchOptions['window']> | undefined,
    ),
  };
}
