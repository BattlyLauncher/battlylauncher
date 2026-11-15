import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { readBoundedRegularFile } from '../files/atomic-file';

import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import type { MinecraftCoreInstaller } from './minecraft-core-installer';

export interface MicrosoftAuthenticator {
  getAuth(): Promise<unknown>;
  refresh?(account: unknown): Promise<unknown>;
}

export interface MinecraftCoreLauncher {
  start?(): unknown;
  DownloadGame?(): unknown;
  Launch(options: unknown): unknown;
  on(event: string, listener: (...arguments_: never[]) => void): this;
  once(event: string, listener: (...arguments_: never[]) => void): this;
}

export interface MinecraftCoreModule {
  readonly Launch?: new () => MinecraftCoreLauncher;
  readonly Microsoft: new (clientId: string) => MicrosoftAuthenticator;
  readonly [key: string]: unknown;
}

export type CoreModuleLoader = (packagePath: string) => unknown;

function defaultModuleLoader(packagePath: string): unknown {
  const localRequire = createRequire(join(packagePath, 'package.json'));
  const entry = localRequire.resolve(packagePath);
  for (const cachedPath of Object.keys(localRequire.cache)) {
    if (cachedPath === entry || cachedPath.startsWith(`${packagePath}${sep}`)) {
      delete localRequire.cache[cachedPath];
    }
  }
  return localRequire(entry) as unknown;
}

function validateCoreModule(value: unknown): MinecraftCoreModule {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new TypeError('minecraft-java-core did not export a module object');
  }
  const microsoft = Reflect.get(value, 'Microsoft') as unknown;
  if (typeof microsoft !== 'function') {
    throw new TypeError('minecraft-java-core has no Microsoft authenticator');
  }
  return value as MinecraftCoreModule;
}

export class MinecraftCoreRuntime {
  readonly #installer: MinecraftCoreInstaller;
  readonly #moduleLoader: CoreModuleLoader;
  #loaded: {
    readonly path: string;
    readonly version: string;
    readonly installation: string;
    readonly module: MinecraftCoreModule;
  } | null = null;

  constructor(
    installer: MinecraftCoreInstaller,
    moduleLoader: CoreModuleLoader = defaultModuleLoader,
  ) {
    this.#installer = installer;
    this.#moduleLoader = moduleLoader;
  }

  get installedPath(): string | null {
    return this.#loaded?.path ?? null;
  }

  async load(descriptor: MinecraftCorePackage): Promise<MinecraftCoreModule> {
    const path = await this.#installer.ensureInstalled(descriptor, { offlineFallback: true });
    const installation = await readBoundedRegularFile(join(path, 'version.json'), 1024 * 1024).then(
      (bytes) => bytes.toString('utf8'),
      () => '',
    );
    if (
      installation &&
      this.#loaded?.path === path &&
      this.#loaded.version === descriptor.version &&
      this.#loaded.installation === installation
    ) {
      return this.#loaded.module;
    }
    const module = validateCoreModule(this.#moduleLoader(path));
    this.#loaded = { path, version: descriptor.version, installation, module };
    return module;
  }
}
