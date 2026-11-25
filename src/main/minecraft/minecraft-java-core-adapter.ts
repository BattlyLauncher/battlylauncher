import { readBoundedResponseBytes } from '../network/read-bounded-response';
import { fabricMenuCompatibility } from './fabric-menu-compatibility';
import { resolveFabricLoader } from './fabric-loader-compatibility';
import { prepareLegacyGameOptionsBeforeSpawn } from './legacy-game-options';
import {
  configuredHeapArguments,
  configuredJavaSpawnArguments,
  isHeapArgument,
  javaApplicationArgumentIndex,
} from './launch-memory';
import { launchErrorDetail } from './launch-error-detail';
import { inspectJavaRuntime } from './java-executable';
import { prepareLwjglNatives } from './lwjgl-native-compatibility';
import { release as osRelease } from 'node:os';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import {
  normalizeLaunchItem,
  normalizeLaunchPhase,
  normalizeLaunchProgress,
} from '../../shared/minecraft/launch-contract';
import type {
  MinecraftLaunchEventSink,
  MinecraftLaunchExit,
  MinecraftLaunchHandle,
  MinecraftLaunchOptions,
  MinecraftLauncherAdapter,
} from './launcher-adapter';
import { MinecraftLogParser } from './launch-events';
import {
  observeLauncherProcesses,
  type ObservedLauncherProcess,
} from './launcher-process-observer';
import type { MinecraftCoreModule, MinecraftCoreRuntime } from './minecraft-core-runtime';
import { networkAvailable } from '../network/connectivity';
import { assertOfflineFiles } from './offline-files';
import { ensureForgeOptiFine } from './optifine-installer';
import { forgeOptiFineClasspath } from './forge-optifine-classpath';
import { labyModLaunchOptions } from './labymod-launch-compatibility';
import {
  ensureLabyModAssetArtifacts,
  ensureLabyModClientArtifact,
  mergeLabyLwjglClasspath,
} from './minecraft-launcher-core-adapter';

export interface MinecraftCoreRuntimeLoader {
  load(descriptor: MinecraftCorePackage): Promise<MinecraftCoreModule>;
}

function toLegacyAuthenticator(options: MinecraftLaunchOptions): Record<string, unknown> {
  return {
    access_token: options.authorization.accessToken,
    client_token: options.authorization.clientToken,
    uuid: options.authorization.uuid,
    name: options.authorization.name,
    user_properties:
      typeof options.authorization.userProperties === 'string'
        ? options.authorization.userProperties
        : JSON.stringify(options.authorization.userProperties ?? {}),
    type: options.authorization.type,
    meta: {
      type: options.authorization.type === 'microsoft' ? 'Xbox' : options.authorization.type,
    },
  };
}

function toJavaCoreOptions(options: MinecraftLaunchOptions): Record<string, unknown> {
  const core = options.core;
  if (!core) {
    throw new TypeError('minecraft-java-core configuration is missing');
  }
  return {
    url: core.resourceUrl,
    authenticator: toLegacyAuthenticator(options),
    detached: false,
    timeout: core.timeoutMs,
    path: options.root,
    instance: options.instanceId,
    downloadFileMultiple: core.downloadConcurrency,
    version: options.version.id,
    loader: {
      type: core.loader.type,
      build: core.loader.build,
      enable: core.loader.enabled,
      ...(core.loader.path ? { path: core.loader.path } : {}),
    },
    verify: core.verify,
    // Laby and OptiFine add runtime files outside Minecraft's download manifest.
    // Keep download verification, but do not prune their profiles, assets or mods.
    ignored: [
      ...core.ignored,
      ...(labyModLaunchOptions(options) || options.installOptiForge ? ['.'] : []),
    ],
    java: options.javaPath ? { path: options.javaPath, type: 'jre' } : false,
    memory: {
      min: `${options.memory.minimumMiB}M`,
      max: `${options.memory.maximumMiB}M`,
    },
    JVM_ARGS: configuredHeapArguments(options.javaArguments, options.memory),
    GAME_ARGS: [
      ...options.gameArguments,
      ...(options.window.fullscreen && !options.gameArguments.includes('--fullscreen')
        ? ['--fullscreen']
        : []),
    ],
    screen: { ...options.window },
    beforeLaunch: core.beforeLaunch,
    // Installed metadata stays valid offline; no TTL refresh may hold up a local launch.
    ...(!networkAvailable()
      ? {
          metadataCacheTtl: Number.MAX_SAFE_INTEGER,
          javaMetadataCacheTtl: Number.MAX_SAFE_INTEGER,
          loaderMetadataCacheTtl: Number.MAX_SAFE_INTEGER,
        }
      : {}),
  };
}

export function publicCoreError(value: unknown, options: MinecraftLaunchOptions): string {
  const text = (candidate: unknown): string =>
    Buffer.isBuffer(candidate)
      ? candidate.toString('utf8')
      : typeof candidate === 'string' ||
          typeof candidate === 'number' ||
          typeof candidate === 'boolean' ||
          typeof candidate === 'bigint'
        ? String(candidate)
        : '';
  let detail = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : value instanceof Error
      ? value.message
      : value && typeof value === 'object'
        ? text(Reflect.get(value, 'message')) || text(Reflect.get(value, 'error'))
        : text(value);
  for (const secret of [
    options.authorization.accessToken,
    options.authorization.clientToken,
    options.authorization.uuid,
  ]) {
    if (secret) {
      detail = detail.replaceAll(secret, '[redacted]');
    }
  }
  detail = [...detail]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .trim()
    .slice(0, 2_000);
  return /(?:ENOENT|EACCES|EPERM|HTTP\s*\d|no such file|not found|unable|invalid|loader|forge|optifine|fabric|quilt|java|version|lwjgl|archivo|file|directory|spawn|download|install|permission|could not reserve|heap|initialization of VM)/i.test(
    detail,
  )
    ? detail
    : 'minecraft-java-core notificó un error interno';
}

async function ensureExtraAssetsFallback(options: MinecraftLaunchOptions): Promise<void> {
  if (!options.core?.resourceUrl) {
    return;
  }
  const directory = join(options.root, 'mc-assets');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(join(directory, 'extra-assets.json'), '[]\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

async function validJar(path: string): Promise<boolean> {
  try {
    const [metadata, signature] = await Promise.all([stat(path), readFile(path)]);
    return (
      metadata.isFile() && metadata.size > 100_000 && signature[0] === 0x50 && signature[1] === 0x4b
    );
  } catch {
    return false;
  }
}

export async function ensureNeoForgeInstaller(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const loader = options.core?.loader;
  if (
    !loader?.enabled ||
    loader.type !== 'neoforge' ||
    !loader.build ||
    loader.build === 'latest'
  ) {
    return;
  }
  const build = loader.build;
  const legacy = /^1\.\d+(?:\.\d+)?-/.test(build);
  const artifact = legacy ? 'forge' : 'neoforge';
  const group = legacy ? 'net/neoforged/forge' : 'net/neoforged/neoforge';
  const directory = join(options.root, 'neoForge');
  const destination = join(directory, `neoForge-${build}-installer.jar`);
  if (await validJar(destination)) {
    emit({ type: 'log', stream: 'game', message: `[NeoForge] Instalador ${build} ya verificado` });
    return;
  }
  // An already installed loader does not need its original installer again.
  // The core validates its cached installation; an incomplete one fails normally.
  if (!networkAvailable()) {
    return;
  }

  await mkdir(directory, { recursive: true });
  const url = `https://maven.neoforged.net/releases/${group}/${build}/${artifact}-${build}-installer.jar`;
  emit({ type: 'phase', phase: 'loader' });
  emit({
    type: 'log',
    stream: 'game',
    message: `[NeoForge] Descargando instalador oficial ${build}`,
  });
  const response = await fetcher(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`NeoForge ${build}: HTTP ${response.status}`);
  }
  const bytes = await readBoundedResponseBytes(
    response,
    512 * 1024 * 1024,
    'NeoForge installer is too large',
  );
  if (bytes.length <= 100_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`NeoForge ${build}: el instalador descargado no es un JAR válido`);
  }
  emit({ type: 'progress', current: bytes.length, total: bytes.length, item: `NeoForge ${build}` });
  const temporary = `${destination}.download`;
  await writeFile(temporary, bytes);
  await unlink(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  await rename(temporary, destination);
  emit({
    type: 'log',
    stream: 'game',
    message: `[NeoForge] Instalador verificado (${(bytes.length / 1_048_576).toFixed(1)} MB)`,
  });
}

export class MinecraftJavaCoreAdapter implements MinecraftLauncherAdapter {
  readonly engine = 'minecraft-java-core' as const;
  readonly #descriptor: MinecraftCorePackage;
  readonly #runtime: MinecraftCoreRuntimeLoader;

  constructor(
    runtime: MinecraftCoreRuntime | MinecraftCoreRuntimeLoader,
    descriptor: MinecraftCorePackage,
  ) {
    this.#runtime = runtime;
    this.#descriptor = descriptor;
  }

  async launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle> {
    if (options.engine !== this.engine) {
      throw new TypeError(`Invalid launch engine for ${this.engine}`);
    }
    if (
      options.core?.descriptor.version !== this.#descriptor.version ||
      options.core.descriptor.sha256 !== this.#descriptor.sha256 ||
      options.core.descriptor.url !== this.#descriptor.url
    ) {
      throw new TypeError('Minecraft core package descriptor does not match the adapter');
    }
    options = fabricMenuCompatibility(await resolveFabricLoader(options, emit));

    await ensureForgeOptiFine(options, emit);
    const labyOptions = labyModLaunchOptions(options);
    if (labyOptions) {
      await ensureLabyModAssetArtifacts(labyOptions, emit);
      await ensureLabyModClientArtifact(labyOptions, emit);
    }

    emit({ type: 'state', state: 'preparing' });
    await assertOfflineFiles(options);
    await ensureExtraAssetsFallback(options);
    await ensureNeoForgeInstaller(options, emit);
    const logs = new MinecraftLogParser(options.authorization);
    const evidence = (value: unknown): void => {
      for (const event of logs.push(
        `${launchErrorDetail(value, [options.authorization.accessToken, options.authorization.clientToken, options.authorization.uuid])}\n`,
      )) {
        emit(event);
      }
    };
    evidence(
      `[launch-context] ${JSON.stringify({ minecraft: options.version, loader: options.core?.loader, javaPath: options.javaPath, memory: options.memory, platform: process.platform, arch: process.arch, os: osRelease(), runtime: process.versions })}`,
    );
    const core = await this.#runtime.load(this.#descriptor);
    if (!core.Launch) {
      emit({ type: 'state', state: 'failed' });
      throw new TypeError('minecraft-java-core has no launcher');
    }
    const launcher = new core.Launch();
    let gameProcess: ObservedLauncherProcess | undefined;
    let expectingGameProcess = false;

    launcher.on('phase', (value: unknown) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return;
      }
      const event = normalizeLaunchPhase((value as Record<string, unknown>).phase);
      if (event) {
        emit(event);
      }
    });
    launcher.on('progress', (current: unknown, total: unknown, item: unknown) => {
      const event = normalizeLaunchProgress(current, total, item);
      if (event) {
        emit(event);
      }
    });
    launcher.on('check', (current: unknown, total: unknown, item: unknown) => {
      const event = normalizeLaunchProgress(current, total, item);
      if (event) {
        emit({ ...event, type: 'check' });
      }
    });
    launcher.on('speed', (value: unknown) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        emit({ type: 'speed', bytesPerSecond: value });
      }
    });
    launcher.on('file-start', (item: unknown, category: unknown) => {
      emit({
        type: 'file-start',
        item: normalizeLaunchItem(item),
        category: normalizeLaunchItem(category),
      });
    });
    launcher.on('file-complete', (item: unknown, category: unknown) => {
      emit({
        type: 'file-complete',
        item: normalizeLaunchItem(item),
        category: normalizeLaunchItem(category),
      });
    });
    launcher.on('data', (value: unknown) => {
      // The core emits this immediately before its final spawn. Installer and
      // Java probe processes created during DownloadGame are not the game.
      if (typeof value === 'string' && value.startsWith('Launching with arguments ')) {
        // Bundle downloads may replace options.txt after the initial launch checks.
        // This event is synchronous and precedes the core's final game spawn.
        prepareLegacyGameOptionsBeforeSpawn(options, emit);
        expectingGameProcess = true;
      }
      // Core status strings are complete emitter events and frequently omit a
      // trailing newline. Buffer values remain stream chunks inside the parser.
      for (const event of logs.push(value)) {
        emit(event);
      }
    });

    let settle: ((exit: MinecraftLaunchExit) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    let finished = false;
    const completion = new Promise<MinecraftLaunchExit>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    // Errors can arrive while Launch is still preparing files, before the
    // service has received the handle and attached its completion listener.
    void completion.catch(() => undefined);
    const finishNormally = (rawCode?: unknown, rawSignal?: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      for (const event of logs.flush()) {
        emit(event);
      }
      const exit: MinecraftLaunchExit = {
        code: typeof rawCode === 'number' && Number.isInteger(rawCode) ? rawCode : null,
        signal: typeof rawSignal === 'string' && rawSignal.length > 0 ? rawSignal : null,
      };
      emit({ type: 'exit', ...exit });
      emit({ type: 'state', state: 'exited' });
      settle?.(exit);
    };
    const reportFailure = (value: unknown) => {
      if (finished) {
        return;
      }
      finished = true;
      for (const event of logs.flush()) {
        emit(event);
      }
      const detail = publicCoreError(value, options);
      evidence(value);
      emit({ type: 'log', message: `[error] ${detail}`, stream: 'game' });
      emit({ type: 'state', state: 'failed' });
      fail?.(new Error(`minecraft-java-core launch failed: ${detail}`));
    };
    launcher.on('error', reportFailure);

    if (options.installOnly) {
      if (typeof launcher.DownloadGame !== 'function') {
        emit({ type: 'state', state: 'failed' });
        throw new TypeError('minecraft-java-core has no download-only operation');
      }
      const downloadGame = launcher.DownloadGame.bind(launcher);
      let installation: Promise<unknown> | undefined;
      Reflect.set(launcher, 'start', () => {
        installation = Promise.resolve(downloadGame());
        return installation;
      });
      try {
        await launcher.Launch(toJavaCoreOptions(options));
        const result = await installation;
        if (result && typeof result === 'object' && 'error' in result) {
          const error = Reflect.get(result, 'error');
          throw new Error(typeof error === 'string' ? error : 'Falló la preparación de archivos');
        }
        if (finished) {
          await completion;
        }
        emit({ type: 'progress', current: 1, total: 1, item: options.version.id });
        finishNormally();
        return { completion, cancel: () => false };
      } catch (error) {
        if (!finished) {
          finished = true;
          const detail = publicCoreError(error, options);
          emit({ type: 'log', message: `[error] ${detail}`, stream: 'game' });
          emit({ type: 'state', state: 'failed' });
          fail?.(new Error(`minecraft-java-core installation failed: ${detail}`));
        }
        void completion.catch(() => undefined);
        const detail = publicCoreError(error, options);
        throw new Error(`minecraft-java-core installation failed: ${detail}`, { cause: error });
      }
    }

    let lwjglDirectory: string | undefined;
    const loader = options.core?.loader;
    if (
      process.platform === 'darwin' &&
      loader?.enabled &&
      loader.type === 'neoforge' &&
      /^26\./.test(options.version.id) &&
      typeof launcher.DownloadGame === 'function'
    ) {
      const downloadGame = launcher.DownloadGame.bind(launcher);
      launcher.DownloadGame = async () => {
        const result = (await downloadGame()) as
          | {
              error?: unknown;
              minecraftJson?: unknown;
              minecraftJava?: { path?: string };
            }
          | undefined;
        if (result && !result.error && result.minecraftJson) {
          const javaPath = options.javaPath || result.minecraftJava?.path;
          const java = javaPath ? await inspectJavaRuntime(javaPath) : undefined;
          const prepared = await prepareLwjglNatives(options.root, result.minecraftJson, {
            platform: 'darwin',
            arch: java?.architecture ?? process.arch,
          });
          if (prepared) {
            lwjglDirectory = prepared.directory;
            evidence(
              `[LWJGL] ${java?.architecture ?? process.arch}, ${prepared.repaired} native libraries restored`,
            );
          }
        }
        return result;
      };
    }

    // Legacy Launch() invokes start() without returning its promise.
    let starting: Promise<unknown> | undefined;
    if (typeof launcher.start === 'function') {
      const start = launcher.start.bind(launcher);
      Reflect.set(launcher, 'start', () => {
        starting = Promise.resolve().then(start);
        void starting.catch(() => undefined);
        return starting;
      });
    }
    try {
      await observeLauncherProcesses(
        async () => {
          await launcher.Launch(toJavaCoreOptions(options));
          await starting;
        },
        (created) => {
          if (!expectingGameProcess) {
            for (const stream of [created.child.stdout, created.child.stderr]) {
              stream?.on('data', (chunk: Buffer) => {
                for (const event of logs.push(chunk)) {
                  emit(event);
                }
              });
            }
            void created.completion.then(
              (exit) => evidence(`[preparation-process] ${JSON.stringify(exit)}`),
              evidence,
            );
          }
          if (!expectingGameProcess || gameProcess) {
            return;
          }
          expectingGameProcess = false;
          gameProcess = created;
        },
        options.environment
          ? { executable: options.javaPath || 'java', values: options.environment }
          : undefined,
        (arguments_, child) => {
          if (child !== gameProcess?.child) {
            return arguments_;
          }
          prepareLegacyGameOptionsBeforeSpawn(options, emit, arguments_);
          const resolved = forgeOptiFineClasspath(
            configuredJavaSpawnArguments(arguments_, options.memory),
            options,
          );
          if (labyOptions) {
            const classpath = resolved.findIndex((value) =>
              ['-cp', '-classpath', '--class-path'].includes(value),
            );
            if (classpath >= 0 && typeof resolved[classpath + 1] === 'string') {
              resolved[classpath + 1] = mergeLabyLwjglClasspath(
                labyOptions,
                resolved[classpath + 1].split(delimiter),
              ).join(delimiter);
            }
          }
          const javaArguments = resolved.slice(1);
          const boundary = javaApplicationArgumentIndex(javaArguments);
          evidence(
            `[launch-memory] ${JSON.stringify({ minimumMiB: options.memory.minimumMiB, maximumMiB: options.memory.maximumMiB, heapArguments: javaArguments.slice(0, Math.max(0, boundary)).filter(isHeapArgument) })}`,
          );
          if (lwjglDirectory && boundary >= 0) {
            return [
              resolved[0],
              '-XstartOnFirstThread',
              `-Dorg.lwjgl.librarypath=${lwjglDirectory}`,
              ...javaArguments
                .slice(0, boundary)
                .filter(
                  (value) =>
                    value !== '-XstartOnFirstThread' &&
                    !value.startsWith('-Dorg.lwjgl.librarypath='),
                ),
              ...javaArguments.slice(boundary),
            ];
          }
          return resolved;
        },
      );
      if (finished) {
        await completion;
      }
      if (!gameProcess) {
        throw new Error('minecraft-java-core terminó la preparación sin crear el proceso de Java');
      }
      await gameProcess.spawned;
      if (gameProcess.child.pid) {
        emit({ type: 'process', pid: gameProcess.child.pid });
      }
    } catch (error) {
      reportFailure(error);
      const detail = publicCoreError(error, options);
      throw new Error(`minecraft-java-core launch failed: ${detail}`, { cause: error });
    }
    if (!finished) {
      emit({ type: 'state', state: 'running' });
    }
    // The core's close event discards the exit code. Observe the actual child
    // instead, including ENOENT/errors that its wrapper never forwards.
    void gameProcess.completion.then(
      (exit) => finishNormally(exit.code, exit.signal),
      reportFailure,
    );
    const child = gameProcess.child;

    return {
      completion,
      cancel: () => {
        try {
          return child.kill('SIGTERM');
        } catch {
          return false;
        }
      },
    };
  }
}
