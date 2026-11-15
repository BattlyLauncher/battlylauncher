import { readBoundedResponseBytes } from '../network/read-bounded-response';
import { fabricMenuCompatibility } from './fabric-menu-compatibility';
import { repairLabyMappingCache } from './labymod-mapping-cache';
import {
  normalizeLegacyLibraryRepositories,
  isNativeOnlyLibrary,
  normalizeLegacyForgeLibraries,
  verifyLauncherLibraries,
} from './legacy-forge-libraries';
import { configuredHeapArguments, isHeapArgument } from './launch-memory';
import { writeFileAtomically } from '../files/atomic-file';
import {
  checkModernAssets,
  reusableMojangObject,
  cachedLauncherVersion,
  type CachedVersionHandler,
} from './launcher-file-reuse';
import { networkAvailable, OfflineError } from '../network/connectivity';
import { assertOfflineFiles } from './offline-files';
import { parseWorldsVersion } from '../../shared/social/worlds-version';
import { ensureOptiFine, isOptiFineInstalled } from './optifine-installer';
import { prepareLegacyGameOptionsBeforeSpawn } from './legacy-game-options';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { Client } from 'minecraft-launcher-core';

import { normalizeLaunchProgress } from '../../shared/minecraft/launch-contract';

import type {
  MinecraftLaunchEventSink,
  MinecraftLaunchHandle,
  MinecraftLaunchOptions,
  MinecraftLauncherAdapter,
} from './launcher-adapter';
import { repairKnownCustomClient } from './custom-client-compatibility';
import { prepareLwjglNatives } from './lwjgl-native-compatibility';
import { inspectJavaRuntime } from './java-executable';
import { systemArchitecture } from '../settings/system-architecture';
import { MinecraftLogParser } from './launch-events';
import { LabyModService, labyLwjglModules, type LabyModInstallResult } from './labymod-service';
import {
  observeLauncherProcesses,
  type ObservedLauncherProcess,
} from './launcher-process-observer';

export interface LauncherProcess extends EventEmitter {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface LauncherCoreClient extends EventEmitter {
  launch(options: unknown): Promise<LauncherProcess | null>;
}

export type LauncherCoreClientFactory = () => LauncherCoreClient;

type ForgeInstallerDownloader = (url: string) => Promise<Buffer>;
type LabyModRepairInstaller = (
  minecraftVersion: string,
  root: string,
  progress: (message: string, current: number, total: number) => void,
) => Promise<LabyModInstallResult | void>;
type ForgeInstallerRunner = (
  javaPath: string,
  installerPath: string,
  installRoot: string,
) => Promise<void>;

async function validJar(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size <= 100_000) {
      return false;
    }
    const handle = await open(path, 'r');
    try {
      const signature = Buffer.alloc(2);
      await handle.read(signature, 0, signature.length, 0);
      return signature[0] === 0x50 && signature[1] === 0x4b;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

const labyAssetNames = [
  'shader',
  'common',
  'fonts',
  'vanilla-theme',
  'fancy-theme',
  'i18n',
] as const;
const labyManifestUrl = 'https://releases.r2.labymod.net/api/v1/manifest/production/latest.json';

async function validLabyAsset(path: string, sha1: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    return (
      bytes.length > 2 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      createHash('sha1').update(bytes).digest('hex') === sha1
    );
  } catch {
    return false;
  }
}

async function downloadForgeInstaller(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Forge installer: HTTP ${response.status}`);
  }
  return readBoundedResponseBytes(response, 512 * 1024 * 1024, 'Forge installer is too large');
}

function labyModClientArtifact(options: MinecraftLaunchOptions): {
  readonly path: string;
  readonly url: string;
} | null {
  const customId = options.version.customId;
  if (!customId?.startsWith('LabyMod-')) {
    return null;
  }
  try {
    const manifest = JSON.parse(
      readFileSync(join(options.root, 'versions', customId, `${customId}.json`), 'utf8'),
    ) as Record<string, unknown>;
    const data = manifest.labymod_data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const commit = (data as Record<string, unknown>).commitReference;
    if (typeof commit !== 'string' || !/^[a-f0-9]{7,64}$/i.test(commit)) {
      return null;
    }
    return {
      path: join(options.root, 'labymod-neo', 'clients', `${commit}.jar`),
      url: `https://releases.r2.labymod.net/api/v1/download/labymod4/production/${encodeURIComponent(commit)}.jar`,
    };
  } catch {
    return null;
  }
}

export async function ensureLabyModClientArtifact(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  downloader: ForgeInstallerDownloader = downloadForgeInstaller,
): Promise<void> {
  const artifact = labyModClientArtifact(options);
  if (!artifact || (await validJar(artifact.path))) {
    return;
  }
  emit({ type: 'phase', phase: 'labymod' });
  emit({
    type: 'log',
    stream: 'game',
    message: '[LabyMod] Reparando el cliente específico de esta versión',
  });
  const bytes = await downloader(artifact.url);
  if (bytes.length <= 100_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('LabyMod devolvió un cliente no válido');
  }
  await mkdir(dirname(artifact.path), { recursive: true });
  const temporary = `${artifact.path}.download`;
  await writeFile(temporary, bytes);
  await unlink(artifact.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  await rename(temporary, artifact.path);
}

function installedLabyMetadata(options: MinecraftLaunchOptions): {
  readonly commit: string;
  readonly assets: Record<string, string>;
  readonly librariesSynced: boolean;
  readonly lwjglVersion: string | null;
} | null {
  const customId = options.version.customId;
  if (!customId?.startsWith('LabyMod-')) {
    return null;
  }
  try {
    const manifest = JSON.parse(
      readFileSync(join(options.root, 'versions', customId, `${customId}.json`), 'utf8'),
    ) as Record<string, unknown>;
    const data = manifest.labymod_data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const record = data as Record<string, unknown>;
    const commit = record.commitReference;
    if (typeof commit !== 'string' || !/^[a-f0-9]{7,64}$/i.test(commit)) {
      return null;
    }
    const assets: Record<string, string> = {};
    if (record.assets && typeof record.assets === 'object' && !Array.isArray(record.assets)) {
      for (const name of labyAssetNames) {
        const hash = (record.assets as Record<string, unknown>)[name];
        if (typeof hash === 'string' && /^[a-f0-9]{40}$/i.test(hash)) {
          assets[name] = hash.toLowerCase();
        }
      }
    }
    const lwjglVersion =
      typeof record.lwjglVersion === 'string' && /^[a-zA-Z0-9._+-]+$/.test(record.lwjglVersion)
        ? record.lwjglVersion
        : null;
    return {
      commit,
      assets,
      lwjglVersion,
      librariesSynced:
        record.librariesSynced === true && record.runtimeRevision === 1 && lwjglVersion !== null,
    };
  } catch {
    return null;
  }
}

export async function ensureLabyModAssetArtifacts(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  downloader: ForgeInstallerDownloader = downloadForgeInstaller,
  reinstall: LabyModRepairInstaller = async (minecraftVersion, root, progress) => {
    return new LabyModService().install(minecraftVersion, root, progress);
  },
): Promise<void> {
  let metadata = installedLabyMetadata(options);
  if (!metadata) {
    return;
  }
  let commit = metadata.commit;
  let assets = metadata.assets;
  if (!metadata.librariesSynced || labyAssetNames.some((name) => !assets[name])) {
    const manifestBytes = await downloader(labyManifestUrl);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
    if (
      typeof manifest.commitReference !== 'string' ||
      !/^[a-f0-9]{7,64}$/i.test(manifest.commitReference)
    ) {
      throw new TypeError('LabyMod devolvió una versión no válida');
    }
    const supported = Array.isArray(manifest.minecraftVersions)
      ? manifest.minecraftVersions.some(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            (entry as Record<string, unknown>).version === options.version.id,
        )
      : false;
    if (!supported) {
      throw new Error('La versión instalada ya no está soportada por LabyMod');
    }
    if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
      throw new TypeError('LabyMod devolvió recursos no válidos');
    }
    const manifestAssets: Record<string, string> = {};
    for (const name of labyAssetNames) {
      const hash = (manifest.assets as Record<string, unknown>)[name];
      if (typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) {
        throw new TypeError(`LabyMod devolvió un recurso ${name} no válido`);
      }
      manifestAssets[name] = hash.toLowerCase();
    }
    if (!metadata.librariesSynced || manifest.commitReference !== metadata.commit) {
      emit({
        type: 'log',
        stream: 'game',
        message: `[LabyMod] Sincronizando cliente, librerías y recursos ${metadata.commit} → ${manifest.commitReference}`,
      });
      const installed = await reinstall(
        options.version.id,
        options.root,
        (message, current, total) => {
          emit({ type: 'phase', phase: 'labymod' });
          emit({ type: 'log', stream: 'game', message: `[LabyMod] ${message}` });
          if (total > 0) {
            emit({ type: 'progress', current, total, item: message });
          }
        },
      );
      const oldId = options.version.customId;
      if (installed && oldId && installed.customVersion !== oldId) {
        // Historical shortcuts keep their ID; migrate their profile to the installed
        // manifest so verification and the eventual launch use the same libraries.
        for (const id of [oldId, installed.customVersion]) {
          if (!/^LabyMod-[a-zA-Z0-9._-]+$/.test(id)) {
            throw new TypeError('Invalid LabyMod profile ID');
          }
        }
        const profile = JSON.parse(
          await readFile(
            join(
              options.root,
              'versions',
              installed.customVersion,
              `${installed.customVersion}.json`,
            ),
            'utf8',
          ),
        ) as Record<string, unknown>;
        if (
          profile.inheritsFrom !== options.version.id ||
          installed.minecraftVersion !== options.version.id
        ) {
          throw new Error('LabyMod migration version mismatch');
        }
        profile.id = oldId;
        await writeFileAtomically(
          join(options.root, 'versions', oldId, `${oldId}.json`),
          `${JSON.stringify(profile, null, 2)}\n`,
        );
      }
      metadata = installedLabyMetadata(options);
      if (
        !metadata?.librariesSynced ||
        metadata.commit !== manifest.commitReference ||
        labyAssetNames.some((name) => !metadata?.assets[name])
      ) {
        throw new Error('LabyMod no pudo sincronizar todos sus componentes');
      }
      commit = metadata.commit;
      assets = metadata.assets;
    } else {
      commit = manifest.commitReference;
      assets = manifestAssets;
    }
  }

  for (const name of labyAssetNames) {
    const hash = assets[name];
    const destination = join(options.root, 'labymod-neo', 'assets', `${name}.jar`);
    if (await validLabyAsset(destination, hash)) {
      continue;
    }
    emit({ type: 'phase', phase: 'labymod' });
    emit({
      type: 'log',
      stream: 'game',
      message: `[LabyMod] Reparando recurso ${name}`,
    });
    const bytes = await downloader(
      `https://laby-releases.s3.de.io.cloud.ovh.net/api/v1/download/assets/labymod4/production/${encodeURIComponent(commit)}/${encodeURIComponent(name)}/${hash}.jar`,
    );
    if (
      bytes.length <= 2 ||
      bytes[0] !== 0x50 ||
      bytes[1] !== 0x4b ||
      createHash('sha1').update(bytes).digest('hex') !== hash
    ) {
      throw new Error(`LabyMod devolvió un recurso ${name} no válido`);
    }
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.download`;
    await writeFile(temporary, bytes);
    await unlink(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
    await rename(temporary, destination);
  }
}

function consoleJavaPath(javaPath: string): string {
  return /javaw\.exe$/i.test(javaPath) ? javaPath.replace(/javaw\.exe$/i, 'java.exe') : javaPath;
}

function runForgeInstaller(
  javaPath: string,
  installerPath: string,
  installRoot: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      consoleJavaPath(javaPath),
      ['-jar', installerPath, '--installClient', installRoot],
      {
        cwd: installRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    const collect = (chunk: Buffer | string): void => {
      output = `${output}${String(chunk)}`.slice(-8_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const detail = [...output]
        .map((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code < 32 || code === 127 ? ' ' : character;
        })
        .join('')
        .trim();
      reject(
        new Error(
          `El instalador de Forge terminó con código ${String(code)}${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
  });
}

function safeLibraryPath(root: string, artifactPath: string): string {
  if (isAbsolute(artifactPath)) {
    throw new TypeError('Invalid Forge client artifact path');
  }
  const libraries = resolve(root, 'libraries');
  const destination = resolve(libraries, artifactPath);
  const fromLibraries = relative(libraries, destination);
  if (!fromLibraries || fromLibraries.startsWith('..') || isAbsolute(fromLibraries)) {
    throw new TypeError('Invalid Forge client artifact path');
  }
  return destination;
}

export async function ensureForgeClientArtifact(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  downloader: ForgeInstallerDownloader = downloadForgeInstaller,
  installer: ForgeInstallerRunner = runForgeInstaller,
): Promise<void> {
  const customId = options.version.customId;
  if (!customId || !/-forge-/i.test(customId)) {
    return;
  }

  const versionPath = join(options.root, 'versions', customId, `${customId}.json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(versionPath, 'utf8')) as unknown;
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return;
  }
  const libraries = (parsed as Record<string, unknown>).libraries;
  if (!Array.isArray(libraries)) {
    return;
  }

  let build = '';
  let artifactPath = '';
  for (const value of libraries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const library = value as Record<string, unknown>;
    const name = library.name;
    const match =
      typeof name === 'string'
        ? /^net\.minecraftforge:forge:([A-Za-z0-9._+-]+):client$/.exec(name)
        : null;
    if (!match) {
      continue;
    }
    const downloads = library.downloads;
    const artifact =
      downloads && typeof downloads === 'object' && !Array.isArray(downloads)
        ? (downloads as Record<string, unknown>).artifact
        : null;
    const path =
      artifact && typeof artifact === 'object' && !Array.isArray(artifact)
        ? (artifact as Record<string, unknown>).path
        : null;
    if (typeof path !== 'string' || !path.trim()) {
      continue;
    }
    build = match[1];
    artifactPath = path;
    break;
  }
  if (!build || !artifactPath) {
    return;
  }

  const clientPath = safeLibraryPath(options.root, artifactPath);
  if (await validJar(clientPath)) {
    return;
  }
  if (!options.javaPath) {
    throw new Error(`Forge ${build} necesita el Java administrado de Battly para repararse`);
  }

  emit({ type: 'phase', phase: 'loader' });
  emit({
    type: 'log',
    stream: 'game',
    message: `[Forge] Falta el cliente parcheado ${build}; reparando la instalación`,
  });
  const installerDirectory = join(options.root, 'forge-installer');
  const installerPath = join(installerDirectory, `forge-${build}-installer.jar`);
  await mkdir(installerDirectory, { recursive: true });
  if (!(await validJar(installerPath))) {
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${build}/forge-${build}-installer.jar`;
    const bytes = await downloader(url);
    if (bytes.length <= 100_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error(`Forge ${build}: el instalador descargado no es un JAR válido`);
    }
    const temporary = `${installerPath}.download`;
    await writeFile(temporary, bytes);
    await unlink(installerPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
    await rename(temporary, installerPath);
  }

  await mkdir(dirname(clientPath), { recursive: true });
  await installer(options.javaPath, installerPath, options.root);
  if (!(await validJar(clientPath))) {
    throw new Error(`Forge ${build} no generó su cliente parcheado`);
  }
  emit({
    type: 'log',
    stream: 'game',
    message: `[Forge] Cliente parcheado ${build} verificado`,
  });
}

export function inheritLauncherGameArguments(
  base: Record<string, unknown>,
  modification: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!modification || modification.minecraftArguments) {
    return modification;
  }
  const inherited = base.arguments as { game?: unknown[] } | undefined;
  const custom = modification.arguments as { game?: unknown[] } | undefined;
  if (Array.isArray(custom?.game) || !Array.isArray(inherited?.game)) {
    return modification;
  }
  // MCLC shallow-merges arguments, losing game flags for JVM-only child profiles.
  // Clone because getLaunchOptions replaces placeholders and deletes rule entries.
  return {
    ...modification,
    arguments: { ...custom, game: structuredClone(inherited.game) },
  };
}

function createDefaultClient(): LauncherCoreClient {
  const loadModule = createRequire(__filename);
  const Handler = loadModule('minecraft-launcher-core/components/handler') as {
    prototype: {
      checkSum(hash: string, file: string): Promise<boolean>;
      [key: string]: unknown;
    };
  };
  const versionMethod = Handler.prototype.getVersion as ((
    ...args: unknown[]
  ) => Promise<unknown>) & { battlyCache?: boolean };
  const librariesMethod = Handler.prototype.downloadToDirectory as ((
    directory: string,
    libraries: unknown[],
    event: string,
  ) => Promise<string[]>) & { battlyLibraries?: boolean };
  if (!librariesMethod.battlyLibraries) {
    const libraries = async function (
      this: unknown,
      directory: string,
      entries: unknown[],
      event: string,
    ) {
      const classpath = entries.filter((entry) => !isNativeOnlyLibrary(entry));
      const files = await librariesMethod.call(
        this,
        directory,
        normalizeLegacyLibraryRepositories(normalizeLegacyForgeLibraries(classpath)),
        event,
      );
      verifyLauncherLibraries(files);
      return files;
    };
    Object.assign(libraries, { battlyLibraries: true });
    Handler.prototype.downloadToDirectory = libraries;
  }
  const launchOptionsMethod = Handler.prototype.getLaunchOptions as ((
    modification?: unknown,
  ) => Promise<unknown>) & { battlyInheritance?: boolean };
  if (!launchOptionsMethod.battlyInheritance) {
    const launchOptions = async function (
      this: { version: Record<string, unknown> },
      modification?: Record<string, unknown>,
    ) {
      return launchOptionsMethod.call(
        this,
        inheritLauncherGameArguments(this.version, modification),
      );
    };
    Object.assign(launchOptions, { battlyInheritance: true });
    Handler.prototype.getLaunchOptions = launchOptions;
  }
  if (!versionMethod.battlyCache) {
    const version = async function (this: CachedVersionHandler, ...args: unknown[]) {
      const cached = await cachedLauncherVersion(this);
      if (cached) {
        return cached;
      }
      if (!networkAvailable()) {
        throw new OfflineError();
      }
      return versionMethod.apply(this, args);
    };
    Object.assign(version, { battlyCache: true });
    Handler.prototype.getVersion = version;
  }

  if (!(Handler.prototype.checkSum as unknown as { battlyOptimized?: boolean }).battlyOptimized) {
    const checkExistingFile = (_hash: string, file: string): Promise<boolean> =>
      Promise.resolve(existsSync(file));

    (checkExistingFile as unknown as { battlyOptimized: boolean }).battlyOptimized = true;
    Handler.prototype.checkSum = checkExistingFile;
  }

  const downloadMethod = Handler.prototype.downloadAsync as ((
    ...args: unknown[]
  ) => Promise<unknown>) & { battlyReuse?: boolean };
  if (!downloadMethod.battlyReuse) {
    const download = async function (
      this: unknown,
      url: string,
      directory: string,
      name: string,
      ...rest: unknown[]
    ) {
      if (rest[1] === 'log4j' && (await reusableMojangObject(url, join(directory, name)))) {
        return true;
      }
      return downloadMethod.apply(this, [url, directory, name, ...rest]);
    };
    Object.assign(download, { battlyReuse: true });
    Handler.prototype.downloadAsync = download;
  }
  const assetMethod = Handler.prototype.getAssets as ((...args: unknown[]) => Promise<unknown>) & {
    battlyReuse?: boolean;
  };
  if (!assetMethod.battlyReuse) {
    const assets = async function (
      this: ThisParameterType<typeof checkModernAssets>,
      ...args: unknown[]
    ) {
      if (this.isLegacy()) {
        return assetMethod.apply(this, args);
      }
      return checkModernAssets.call(this);
    };
    Object.assign(assets, { battlyReuse: true });
    Handler.prototype.getAssets = assets;
  }

  const nativeMethod = Handler.prototype.getNatives;

  if (
    typeof nativeMethod === 'function' &&
    !(nativeMethod as { battlyCustomNatives?: boolean }).battlyCustomNatives
  ) {
    const original = nativeMethod as (...args: unknown[]) => Promise<unknown>;

    const customNatives = async function (
      this: {
        options?: {
          root?: string;
          javaPath?: string;
          customArgs?: string[];
          version?: { custom?: string };
          overrides?: {
            natives?: string;
          };
        };
        version?: {
          id?: string;
          libraries?: unknown[];
        };
        client?: EventEmitter;
      },
      ...args: unknown[]
    ): Promise<unknown> {
      const configured = this.options?.overrides?.natives;
      const major = Number(this.version?.id?.split('.')[0]);
      const minor = Number(this.version?.id?.split('.')[1]);

      const nativePath =
        configured && (major >= 26 || (major === 1 && minor >= 19))
          ? configured
          : await original.apply(this, args);
      if (this.options?.root) {
        const java = this.options.javaPath ? await inspectJavaRuntime(this.options.javaPath) : null;
        const arch = java?.architecture ?? (java?.bits === 32 ? 'ia32' : systemArchitecture());
        let profile = this.version;
        const custom = this.options.version?.custom;
        if (custom) {
          const customProfile = JSON.parse(
            await readFile(join(this.options.root, 'versions', custom, `${custom}.json`), 'utf8'),
          ) as { libraries?: unknown[]; labymod_data?: { lwjglVersion?: string } };
          // Custom libraries precede inherited libraries in MCLC's classpath.
          profile = {
            ...profile,
            libraries: [...(customProfile.libraries ?? []), ...(profile?.libraries ?? [])],
          };
          const labyVersion = custom.startsWith('LabyMod-')
            ? customProfile.labymod_data?.lwjglVersion
            : undefined;
          if (labyVersion && /^[a-zA-Z0-9._+-]+$/.test(labyVersion)) {
            // These are the modules actually substituted by mergeLabyLwjglClasspath.
            const os =
              process.platform === 'win32'
                ? 'windows'
                : process.platform === 'darwin'
                  ? 'macos'
                  : 'linux';
            const classifier = `natives-${os}${arch === 'arm64' ? '-arm64' : arch === 'ia32' ? '-x86' : ''}`;
            const runtime = labyLwjglModules.flatMap((module) => [
              { name: `org.lwjgl:${module}:${labyVersion}` },
              { name: `org.lwjgl:${module}:${labyVersion}:${classifier}` },
            ]);
            const retained =
              profile.libraries?.filter((raw) => {
                const name =
                  raw && typeof raw === 'object' ? (raw as { name?: string }).name : undefined;
                return (
                  !name?.startsWith('org.lwjgl.lwjgl:') &&
                  !(
                    name?.startsWith('org.lwjgl:') &&
                    labyLwjglModules.includes(
                      name.split(':')[1] as (typeof labyLwjglModules)[number],
                    )
                  )
                );
              }) ?? [];
            profile = { ...profile, libraries: [...runtime, ...retained] };
          }
        }
        const prepared = await prepareLwjglNatives(this.options.root, profile, {
          platform: process.platform,
          arch,
        });
        if (prepared) {
          // JInput and other native dependencies keep their own java.library.path.
          this.options.customArgs = (this.options.customArgs ?? []).filter(
            (arg) => !arg.startsWith('-Dorg.lwjgl.librarypath='),
          );
          this.options.customArgs.push(`-Dorg.lwjgl.librarypath=${prepared.directory}`);
          this.client?.emit(
            'debug',
            `[LWJGL] ${prepared.versions.join(', ')}; ${prepared.repaired} nativas reparadas; ${prepared.directory}`,
          );
        }
      }
      return nativePath;
    };

    (customNatives as { battlyCustomNatives?: boolean }).battlyCustomNatives = true;
    Handler.prototype.getNatives = customNatives;
  }

  for (const methodName of ['getVersion', 'getNatives', 'getJar', 'getClasses', 'getAssets']) {
    const method = Handler.prototype[methodName];

    if (typeof method !== 'function') {
      continue;
    }
    if ((method as { battlyObserved?: boolean }).battlyObserved) {
      continue;
    }

    const original = method as (...args: unknown[]) => Promise<unknown>;

    const observed = async function (
      this: {
        client?: EventEmitter;
      },
      ...args: unknown[]
    ) {
      this.client?.emit('debug', `[MCLC]: Battly phase ${methodName} started`);

      const result = await original.apply(this, args);

      this.client?.emit('debug', `[MCLC]: Battly phase ${methodName} completed`);

      return result;
    };

    (observed as { battlyObserved?: boolean }).battlyObserved = true;
    // Keep patch markers across the observation wrapper, avoiding nested patches
    // and repeated native preparation every time another game is launched.
    Object.assign(observed, method);
    if ((method as { battlyReuse?: boolean }).battlyReuse) {
      Object.assign(observed, { battlyReuse: true });
    }
    Handler.prototype[methodName] = observed;
  }

  return new Client();
}

function currentMinecraftOs(): string {
  if (process.platform === 'win32') {
    return 'windows';
  }
  if (process.platform === 'darwin') {
    return 'osx';
  }
  return 'linux';
}

function customJvmArguments(options: MinecraftLaunchOptions): string[] {
  if (!options.version.customId) {
    return [];
  }

  try {
    const path = join(
      options.root,
      'versions',
      options.version.customId,
      `${options.version.customId}.json`,
    );

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

    const argumentRoot = parsed.arguments;

    if (!argumentRoot || typeof argumentRoot !== 'object' || Array.isArray(argumentRoot)) {
      return [];
    }

    const values = (argumentRoot as Record<string, unknown>).jvm;

    if (!Array.isArray(values)) {
      return [];
    }

    const nativesDirectory = customNativeDirectory(options);

    const substitutions: Readonly<Record<string, string>> = {
      '${natives_directory}': nativesDirectory,
      '${launcher_name}': 'Battly',
      '${launcher_version}': '3',
    };

    const result: string[] = [];

    const add = (value: unknown): void => {
      const candidates = Array.isArray(value) ? value : [value];

      for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate === '-cp') {
          continue;
        }

        let resolved = candidate;

        for (const [placeholder, replacement] of Object.entries(substitutions)) {
          resolved = resolved.replaceAll(placeholder, replacement);
        }

        if (!resolved.includes('${')) {
          result.push(resolved);
        }
      }
    };

    for (const value of values) {
      if (typeof value === 'string') {
        add(value);
        continue;
      }

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }

      const entry = value as Record<string, unknown>;
      const rules = Array.isArray(entry.rules) ? entry.rules : [];

      let allowed = !rules.some(
        (rule) =>
          rule &&
          typeof rule === 'object' &&
          !Array.isArray(rule) &&
          (rule as Record<string, unknown>).action === 'allow',
      );

      for (const ruleValue of rules) {
        if (!ruleValue || typeof ruleValue !== 'object' || Array.isArray(ruleValue)) {
          continue;
        }

        const rule = ruleValue as Record<string, unknown>;
        const os = rule.os;

        if (!os || typeof os !== 'object' || Array.isArray(os)) {
          continue;
        }

        const osRule = os as Record<string, unknown>;

        const nameMatches = typeof osRule.name !== 'string' || osRule.name === currentMinecraftOs();

        const archMatches =
          typeof osRule.arch !== 'string' ||
          (osRule.arch === 'x86' ? process.arch === 'ia32' : osRule.arch === process.arch);

        if (nameMatches && archMatches) {
          allowed = rule.action === 'allow';
        }
      }

      if (allowed) {
        add(entry.value);
      }
    }

    return [...new Set(result)];
  } catch {
    return [];
  }
}

function launcherJvmArguments(options: MinecraftLaunchOptions): string[] {
  const injector = join(options.root, 'authlib-injector.jar');

  return options.javaArguments.map((argument) => {
    if (argument.startsWith('-javaagent:authlib-injector.jar')) {
      return `-javaagent:${injector}` + argument.slice('-javaagent:authlib-injector.jar'.length);
    }

    if (argument === '-Xbootclasspath/a:authlib-injector.jar') {
      return `-Xbootclasspath/a:${injector}`;
    }

    return argument;
  });
}

function labyLwjglClasspath(options: MinecraftLaunchOptions): string[] {
  if (!options.version.customId?.startsWith('LabyMod-')) {
    return [];
  }

  const version = installedLabyMetadata(options)?.lwjglVersion;
  if (!version) {
    return [];
  }

  const root = join(options.root, 'labymod-neo', 'libraries', 'org', 'lwjgl');

  const nativeClassifier =
    process.platform === 'win32'
      ? 'natives-windows'
      : process.platform === 'darwin'
        ? 'natives-macos'
        : 'natives-linux';

  return labyLwjglModules.flatMap((module) => {
    const directory = join(root, module, version);

    const candidates = [
      join(directory, `${module}-${version}.jar`),
      join(directory, `${module}-${version}-${nativeClassifier}.jar`),
    ];

    return candidates.filter((candidate) => existsSync(candidate));
  });
}

function labyAssetClasspath(options: MinecraftLaunchOptions): string[] {
  if (!options.version.customId?.startsWith('LabyMod-')) {
    return [];
  }
  return labyAssetNames
    .map((name) => join(options.root, 'labymod-neo', 'assets', `${name}.jar`))
    .filter((candidate) => existsSync(candidate));
}

function inheritedCustomVersionOverrides(options: MinecraftLaunchOptions): Record<string, string> {
  const customId = options.version.customId;
  if (!customId) {
    return {};
  }
  try {
    const customPath = join(options.root, 'versions', customId, `${customId}.json`);
    const custom = JSON.parse(readFileSync(customPath, 'utf8')) as Record<string, unknown>;
    if (custom.inheritsFrom !== options.version.id) {
      // Standalone custom clients keep their own game JAR, but still declare
      // a vanilla asset index. Never substitute the profile ID for that index.
      const asset = custom.assetIndex;
      const id =
        asset && typeof asset === 'object' ? (asset as Record<string, unknown>).id : custom.assets;
      return typeof id === 'string' && /^[a-zA-Z0-9._+-]{1,128}$/.test(id)
        ? { assetIndex: id }
        : {};
    }
    const baseDirectory = join(options.root, 'versions', options.version.id);
    const versionJson = join(baseDirectory, `${options.version.id}.json`);
    const minecraftJar = join(baseDirectory, `${options.version.id}.jar`);
    if (!existsSync(versionJson) || !existsSync(minecraftJar)) {
      return {};
    }
    const base = JSON.parse(readFileSync(versionJson, 'utf8')) as Record<string, unknown>;
    const assetIndex = base.assetIndex;
    const assetIndexId =
      assetIndex && typeof assetIndex === 'object' && !Array.isArray(assetIndex)
        ? (assetIndex as Record<string, unknown>).id
        : base.assets;
    return {
      directory: baseDirectory,
      minecraftJar,
      versionJson,
      ...(typeof assetIndexId === 'string' && assetIndexId ? { assetIndex: assetIndexId } : {}),
    };
  } catch {
    return {};
  }
}

export function mergeLabyLwjglClasspath(
  options: MinecraftLaunchOptions,
  existing: readonly string[],
): string[] {
  const upgraded = labyLwjglClasspath(options);
  const assets = labyAssetClasspath(options);
  if (!upgraded.length && !assets.length) {
    return [...existing];
  }
  const replacedModules = new Set<string>(labyLwjglModules);
  const preserved = existing.filter((entry) => {
    if (/[\\/]libraries[\\/]net[\\/]labymod[\\/]LabyMod[\\/]/i.test(entry)) {
      return false;
    }
    if (/[\\/]libraries[\\/]labymod-neo[\\/]clients[\\/]/i.test(entry)) {
      return false;
    }
    const match = /[\\/]libraries[\\/]org[\\/]lwjgl[\\/](lwjgl(?:-[^\\/]+)?)[\\/]/i.exec(entry);
    return !match || !replacedModules.has(match[1].toLowerCase());
  });
  const client = labyModClientArtifact(options)?.path;
  return [
    ...new Set([
      ...(client && existsSync(client) ? [client] : []),
      ...assets,
      ...upgraded,
      ...preserved,
    ]),
  ];
}

function customNativeDirectory(options: MinecraftLaunchOptions): string {
  const base = join(options.root, 'natives', options.version.customId ?? options.version.id);
  const version = installedLabyMetadata(options)?.lwjglVersion;
  // Keep previously extracted native DLLs out of the new runtime's search path.
  return version ? join(base, `lwjgl-${version}`) : base;
}

function toLauncherCoreOptions(options: MinecraftLaunchOptions): Record<string, unknown> {
  const customNativesDirectory = options.version.customId ? customNativeDirectory(options) : null;

  if (customNativesDirectory) {
    mkdirSync(customNativesDirectory, { recursive: true });
  }
  const inheritedOverrides = inheritedCustomVersionOverrides(options);

  return {
    root: options.root,

    version: {
      number: options.version.id,
      type: options.version.type,

      ...(options.version.customId
        ? {
            custom: options.version.customId,
          }
        : {}),
    },

    memory: {
      max: `${options.memory.maximumMiB}M`,
      min: `${options.memory.minimumMiB}M`,
    },

    authorization: {
      access_token: options.authorization.accessToken,

      client_token: options.authorization.clientToken,

      uuid: options.authorization.uuid,

      name: options.authorization.name,

      user_properties: options.authorization.userProperties ?? {},

      meta: {
        type: options.authorization.type === 'microsoft' ? 'msa' : 'mojang',
      },
    },

    customArgs: [...new Set([...launcherJvmArguments(options), ...customJvmArguments(options)])],

    customLaunchArgs: [...options.gameArguments],

    javaPath: options.javaPath,

    forge: options.forgePath,

    window: {
      ...options.window,
    },

    overrides: {
      detached: false,

      gameDirectory: options.gameDirectory,

      ...inheritedOverrides,

      ...(customNativesDirectory
        ? {
            natives: customNativesDirectory,
          }
        : {}),
    },
  };
}

export class MinecraftLauncherCoreAdapter implements MinecraftLauncherAdapter {
  readonly engine = 'minecraft-launcher-core' as const;

  readonly #createClient: LauncherCoreClientFactory;

  constructor(createClient: LauncherCoreClientFactory = createDefaultClient) {
    this.#createClient = createClient;
  }

  async launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle> {
    options = fabricMenuCompatibility(options);
    if (options.engine !== this.engine) {
      throw new TypeError(`Invalid launch engine for ${this.engine}`);
    }
    await assertOfflineFiles(options);

    if (
      parseWorldsVersion(options.version.customId || '')?.loader === 'optifine' &&
      !(await isOptiFineInstalled(options))
    ) {
      const controller = new AbortController();
      let running: MinecraftLaunchHandle | undefined;
      emit({ type: 'state', state: 'preparing' });
      const completion = (async () => {
        const prepared = await ensureOptiFine(options, emit, controller.signal);
        controller.signal.throwIfAborted();
        running = await this.launch(prepared, emit);
        if (controller.signal.aborted) {
          running.cancel();
        }
        return running.completion;
      })().catch((error: unknown) => {
        emit({
          type: 'log',
          stream: 'game',
          message: controller.signal.aborted
            ? 'Instalación cancelada'
            : error instanceof Error
              ? error.message
              : 'No se pudo instalar OptiFine',
        });
        emit({ type: 'state', state: 'failed' });
        throw error;
      });
      void completion.catch(() => undefined);
      return {
        completion,
        cancel: () => {
          controller.abort();
          return running ? running.cancel() : true;
        },
      };
    }
    await ensureForgeClientArtifact(options, emit);
    await ensureLabyModAssetArtifacts(options, emit);
    await ensureLabyModClientArtifact(options, emit);
    if (
      options.version.customId?.startsWith('LabyMod-') &&
      (await repairLabyMappingCache(options.root, options.root, options.version.id))
    ) {
      emit({
        type: 'log',
        stream: 'game',
        message: '[LabyMod] Caché de mappings incompatible respaldada; LabyMod la regenerará.',
      });
    }

    if (options.version.customId) {
      const compatibility = await repairKnownCustomClient(options.root, options.version.customId);
      if (compatibility.status === 'repaired') {
        emit({
          type: 'log',
          stream: 'game',
          message: `[Battly] Reparada la incompatibilidad de inicio de ${options.version.customId}. Copia original: ${compatibility.backupPath}`,
        });
      }
    }

    const client = this.#createClient();

    const logs = new MinecraftLogParser(options.authorization);

    let lastProgressAt = 0;
    let activeDownloadPhase = '';
    const reportDownloadPhase = (type: unknown): void => {
      if (typeof type !== 'string') {
        return;
      }
      const phase = type.startsWith('classes')
        ? 'libraries'
        : type.startsWith('assets') || type === 'asset-json'
          ? 'assets'
          : type === 'natives'
            ? 'natives'
            : 'downloading';
      if (phase === activeDownloadPhase) {
        return;
      }
      activeDownloadPhase = phase;
      emit({ type: 'phase', phase });
    };

    const emitThrottledProgress = (event: ReturnType<typeof normalizeLaunchProgress>): void => {
      if (!event) {
        return;
      }

      const now = Date.now();

      if (event.current < event.total && now - lastProgressAt < 75) {
        return;
      }

      lastProgressAt = now;
      emit(event);
    };

    emit({
      type: 'state',
      state: 'preparing',
    });

    client.on('battly-check', (value: unknown) => {
      const progress = value as { task: number; total: number; type: string };
      const event = normalizeLaunchProgress(progress.task, progress.total, progress.type);
      if (event) {
        emit({ ...event, type: 'check' });
      }
    });

    client.on('progress', (value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }

      const progress = value as Record<string, unknown>;

      const event = normalizeLaunchProgress(progress.task, progress.total, progress.type);
      reportDownloadPhase(progress.type);
      emitThrottledProgress(event);
    });

    client.on('download-status', (value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }

      const progress = value as Record<string, unknown>;

      reportDownloadPhase(progress.type);
      // These groups publish their completed-file count through progress.
      // Mixing each file's byte percentage into that counter makes the UI
      // jump to 100% and back for every simultaneous download.
      if (
        typeof progress.type === 'string' &&
        /^(?:assets|classes|natives)(?:-|$)/.test(progress.type)
      ) {
        return;
      }

      const event = normalizeLaunchProgress(
        progress.current,
        progress.total,
        progress.name ?? progress.type,
      );

      emitThrottledProgress(event);
    });

    client.on('debug', (value: unknown) => {
      for (const event of logs.pushChunk(`${String(value)}\n`)) {
        emit(event);
      }
    });

    client.on('data', (value: unknown) => {
      for (const event of logs.pushChunk(value)) {
        emit(event);
      }
    });

    client.on('arguments', (value: unknown) => {
      prepareLegacyGameOptionsBeforeSpawn(options, emit, Array.isArray(value) ? value : undefined);
      if (!Array.isArray(value)) {
        return;
      }

      let classpathIndex = value.indexOf('-cp');

      if (classpathIndex < 0 || typeof value[classpathIndex + 1] !== 'string') {
        return;
      }

      // MCLC appends profile/custom JVM flags after its own -Xmx/-Xms. Normalize
      // the final JVM prefix before spawn so inherited flags cannot override RAM.
      const prefix = value.slice(0, classpathIndex);
      if (prefix.every((argument): argument is string => typeof argument === 'string')) {
        value.splice(0, classpathIndex, ...configuredHeapArguments(prefix, options.memory));
        classpathIndex = value.indexOf('-cp');
        for (const event of logs.push(
          `[launch-memory] ${JSON.stringify({
            minimumMiB: options.memory.minimumMiB,
            maximumMiB: options.memory.maximumMiB,
            heapArguments: value
              .slice(0, classpathIndex)
              .filter((argument) => typeof argument === 'string' && isHeapArgument(argument)),
          })}`,
        )) {
          emit(event);
        }
      }

      const existing = (value[classpathIndex + 1] as string).split(delimiter);
      value[classpathIndex + 1] = mergeLabyLwjglClasspath(options, existing).join(delimiter);
    });

    let failed = false;
    const reportFailure = (error: unknown): void => {
      if (failed) {
        return;
      }
      failed = true;
      for (const event of logs.flush()) {
        emit(event);
      }
      const detail = error instanceof Error ? error.message : 'No se pudo iniciar Java';
      for (const event of logs.push(`[error] ${detail}`)) {
        emit(event);
      }
      emit({
        type: 'state',
        state: 'failed',
      });
    };

    let gameProcess: ObservedLauncherProcess;
    try {
      // launch() returns after calling spawn(), which can still fail on the
      // next tick. Capture the child before then: MCLC never handles its error.
      const processes = new Map<LauncherProcess, ObservedLauncherProcess>();
      const child = await observeLauncherProcesses(
        () => client.launch(toLauncherCoreOptions(options)),
        (created) => processes.set(created.child, created),
        options.environment
          ? { executable: options.javaPath || 'java', values: options.environment }
          : undefined,
      );
      if (!child) {
        throw new Error('minecraft-launcher-core no creó el proceso de Java');
      }
      const observed = processes.get(child);
      if (!observed) {
        throw new Error('No se pudo observar el inicio del proceso de Java');
      }
      await observed.spawned;
      if (observed.child.pid) {
        emit({ type: 'process', pid: observed.child.pid });
      }
      gameProcess = observed;
    } catch (error) {
      reportFailure(error);
      throw error;
    }

    emit({
      type: 'state',
      state: 'running',
    });

    const completion = gameProcess.completion.then(
      (exit) => {
        for (const event of logs.flush()) {
          emit(event);
        }
        emit({
          type: 'exit',
          ...exit,
        });

        emit({
          type: 'state',
          state: 'exited',
        });

        return exit;
      },
      (error: unknown) => {
        reportFailure(error);
        throw error;
      },
    );
    void completion.catch(() => undefined);

    return {
      completion,

      cancel: () => gameProcess.child.kill('SIGTERM'),
    };
  }
}
