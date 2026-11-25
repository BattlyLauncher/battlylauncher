import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import {
  normalizeServerId,
  normalizeServerSoftwareKind,
  type ServerLaunchArguments,
  type ServerSoftwareKind,
} from '../../shared/servers/server-contract';
import { pathExists } from '../files/atomic-file';
import { ServerModloaderCatalog } from './server-modloader-catalog';
import type { ServerStore } from './server-store';

const maximumInstallerBytes = 512 * 1024 * 1024;
const maximumLibraryBytes = 3 * 1024 * 1024 * 1024;
const maximumLibraryEntries = 30_000;
const maximumInstallerOutput = 8 * 1024;

export interface ModloaderInstallerRunOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type RunModloaderInstaller = (
  executable: string,
  args: readonly string[],
  options: ModloaderInstallerRunOptions,
) => Promise<void>;

export interface ServerModloaderInstallerOptions {
  readonly buildToolsUrl?: string;
  readonly catalog?: ServerModloaderCatalog;
  readonly fetchImplementation?: typeof fetch;
  readonly platform?: NodeJS.Platform;
  readonly runInstaller?: RunModloaderInstaller;
}

export function runModloaderInstallerProcess(
  executable: string,
  args: readonly string[],
  options: ModloaderInstallerRunOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const consume = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-maximumInstallerOutput);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error('ModLoader installer timed out'));
    }, options.timeoutMs);
    timer.unref();
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', (error) => finish(error));
    child.once('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              `El instalador del loader terminó con código ${code}: ${output.slice(-2000)}`,
            ),
      ),
    );
  });
}

export class ServerModloaderInstallerService {
  readonly #buildToolsUrl: string;
  readonly #catalog: ServerModloaderCatalog;
  readonly #fetch: typeof fetch;
  readonly #operations = new Map<string, Promise<void>>();
  readonly #platform: NodeJS.Platform;
  readonly #runInstaller: RunModloaderInstaller;

  constructor(
    private readonly store: ServerStore,
    options: ServerModloaderInstallerOptions = {},
  ) {
    this.#fetch = options.fetchImplementation ?? fetch;
    const buildToolsUrl = new URL(
      options.buildToolsUrl ??
        'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar',
    );
    if (buildToolsUrl.protocol !== 'https:') {
      throw new TypeError('BuildTools source must use HTTPS');
    }
    this.#buildToolsUrl = buildToolsUrl.href;
    this.#catalog =
      options.catalog ?? new ServerModloaderCatalog({ fetchImplementation: this.#fetch });
    this.#platform = options.platform ?? process.platform;
    this.#runInstaller = options.runInstaller ?? runModloaderInstallerProcess;
  }

  async preflight(
    id: string,
    kind: 'forge' | 'neoforge' | 'spigot',
    build?: string,
  ): Promise<void> {
    const server = (await this.store.list()).find((entry) => entry.id === id);
    if (!server) {
      throw new Error('Servidor no encontrado');
    }
    if (kind !== 'spigot') {
      await this.#catalog.resolve(kind, server.version, build);
    }
  }

  install(idValue: unknown, kindValue: unknown, build?: string): Promise<void> {
    const id = normalizeServerId(idValue);
    const kind = normalizeServerSoftwareKind(kindValue);
    if (kind !== 'forge' && kind !== 'neoforge' && kind !== 'spigot') {
      throw new TypeError('Software does not use a ModLoader installer');
    }
    const existing = this.#operations.get(id);
    if (existing) {
      return existing;
    }
    const operation = this.#install(id, kind, build).finally(() => this.#operations.delete(id));
    this.#operations.set(id, operation);
    return operation;
  }

  async #install(
    id: string,
    kind: Extract<ServerSoftwareKind, 'forge' | 'neoforge' | 'spigot'>,
    build?: string,
  ): Promise<void> {
    const [directory, server] = await Promise.all([
      this.store.directoryPathInternal(id),
      this.store.list().then((entries) => entries.find((entry) => entry.id === id)),
    ]);
    if (!server) {
      throw new Error('Server metadata is unavailable');
    }
    const java = join(directory, 'java', 'bin', this.#platform === 'win32' ? 'java.exe' : 'java');
    const javaInfo = await lstat(java);
    if (!javaInfo.isFile() || javaInfo.isSymbolicLink()) {
      throw new Error('Install Java before the ModLoader');
    }
    const operationId = randomUUID().replaceAll('-', '');
    const staging = join(directory, `.modloader-install-${operationId}`);
    const installer = join(staging, `${kind}-installer.jar`);
    const stagedServer = join(staging, 'server');
    await mkdir(stagedServer, { recursive: true });
    try {
      if (kind === 'spigot') {
        await this.#download(installer, this.#buildToolsUrl);
        await this.#runInstaller(java, ['-jar', installer, '--rev', server.version], {
          cwd: stagedServer,
          timeoutMs: 30 * 60 * 1000,
        });
        const output = await this.#spigotOutput(stagedServer, server.version);
        await this.#commitServerJar(directory, output, operationId, async () => {
          await this.store.updateSoftware(id, {
            build: server.version,
            installedAt: new Date().toISOString(),
            kind,
            launchArguments: null,
          });
        });
        return;
      }
      const artifact = await this.#catalog.resolve(kind, server.version, build);
      await this.#download(installer, artifact.url, artifact.sha1);
      await this.#runInstaller(java, ['-jar', installer, '--installServer'], {
        cwd: stagedServer,
        timeoutMs: 10 * 60 * 1000,
      });
      const output = await this.#validateOutput(stagedServer, kind, artifact.build);
      await this.#commit(directory, stagedServer, output.legacyJar, operationId, async () => {
        await this.store.updateSoftware(id, {
          build: artifact.build,
          installedAt: new Date().toISOString(),
          kind,
          launchArguments: output.launchArguments,
        });
      });
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  async #download(destination: string, url: string, expectedSha1?: string): Promise<void> {
    const response = await this.#fetch(url, {
      headers: { 'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)' },
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      throw new Error(`ModLoader download failed (${response.status})`);
    }
    await mkdir(dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx');
    const hash = createHash('sha1');
    let completed = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        completed += chunk.value.byteLength;
        if (completed > maximumInstallerBytes) {
          await reader.cancel();
          throw new Error('ModLoader installer exceeds its size limit');
        }
        hash.update(chunk.value);
        await handle.write(chunk.value);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const digest = hash.digest('hex');
    if (completed < 4 || (expectedSha1 !== undefined && digest !== expectedSha1)) {
      throw new Error('ModLoader installer checksum mismatch');
    }
    await this.#assertZip(destination, 'ModLoader installer');
  }

  async #spigotOutput(root: string, gameVersion: string): Promise<string> {
    const expected = join(root, `spigot-${gameVersion}.jar`);
    if (await pathExists(expected)) {
      await this.#assertBoundedJar(expected, 'Spigot server JAR');
      return expected;
    }
    const matches = (await readdir(root))
      .filter((name) => /^spigot-[a-zA-Z0-9._+-]+\.jar$/.test(name))
      .map((name) => join(root, name));
    if (matches.length !== 1 || !matches[0]) {
      throw new TypeError('Invalid Spigot output');
    }
    await this.#assertBoundedJar(matches[0], 'Spigot server JAR');
    return matches[0];
  }

  async #assertBoundedJar(path: string, label: string): Promise<void> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximumInstallerBytes) {
      throw new TypeError(`Invalid ${label}`);
    }
    await this.#assertZip(path, label);
  }

  async #validateOutput(
    root: string,
    kind: 'forge' | 'neoforge',
    build: string,
  ): Promise<{
    readonly launchArguments: ServerLaunchArguments | null;
    readonly legacyJar: string | null;
  }> {
    const libraries = join(root, 'libraries');
    const prefix = kind === 'forge' ? 'net/minecraftforge/forge' : 'net/neoforged/neoforge';
    const expectedRoot = join(libraries, ...prefix.split('/'), build);
    const windows = join(expectedRoot, 'win_args.txt');
    const unix = join(expectedRoot, 'unix_args.txt');
    await this.#auditTree(libraries);
    if ((await pathExists(windows)) && (await pathExists(unix))) {
      for (const path of [windows, unix]) {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) {
          throw new TypeError('Invalid ModLoader arguments');
        }
      }
      return {
        legacyJar: null,
        launchArguments: {
          windows: relative(root, windows).replaceAll('\\', '/'),
          unix: relative(root, unix).replaceAll('\\', '/'),
        },
      };
    }
    if (kind !== 'forge') {
      throw new TypeError('Invalid ModLoader arguments');
    }
    const regularJar = join(root, `forge-${build}.jar`);
    const legacyJar = (await pathExists(regularJar))
      ? regularJar
      : join(root, `forge-${build}-universal.jar`);
    const legacyInfo = await lstat(legacyJar);
    if (
      !legacyInfo.isFile() ||
      legacyInfo.isSymbolicLink() ||
      legacyInfo.size > maximumInstallerBytes
    ) {
      throw new TypeError('Invalid legacy Forge server JAR');
    }
    await this.#assertZip(legacyJar, 'Legacy Forge server JAR');
    return {
      launchArguments: null,
      legacyJar,
    };
  }

  async #auditTree(root: string): Promise<void> {
    const queue = [root];
    let entries = 0;
    let bytes = 0;
    while (queue.length) {
      const current = queue.pop();
      if (!current) {
        break;
      }
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new TypeError('ModLoader output contains a symbolic link');
      }
      if (info.isFile()) {
        bytes += info.size;
        if (bytes > maximumLibraryBytes) {
          throw new Error('ModLoader libraries exceed their size limit');
        }
        continue;
      }
      if (!info.isDirectory()) {
        throw new TypeError('Invalid ModLoader output');
      }
      for (const entry of await readdir(current)) {
        entries += 1;
        if (entries > maximumLibraryEntries) {
          throw new Error('ModLoader output has too many files');
        }
        queue.push(join(current, entry));
      }
    }
  }

  async #assertZip(path: string, label: string): Promise<void> {
    const handle = await open(path, 'r');
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await handle.read(signature, 0, 4, 0);
      if (bytesRead !== 4 || signature.readUInt32LE(0) !== 0x04034b50) {
        throw new TypeError(`${label} is not a valid JAR`);
      }
    } finally {
      await handle.close();
    }
  }

  async #commit(
    directory: string,
    stagedServer: string,
    stagedLegacyJar: string | null,
    operationId: string,
    persist: () => Promise<void>,
  ): Promise<void> {
    const moves: {
      staged: string;
      target: string;
      backup: string;
      had: boolean;
      installed: boolean;
    }[] = [];
    const add = async (staged: string, target: string): Promise<void> => {
      moves.push({
        staged,
        target,
        backup: `${target}.backup-${operationId}`,
        had: await pathExists(target),
        installed: false,
      });
    };
    await add(join(stagedServer, 'libraries'), join(directory, 'libraries'));
    if (stagedLegacyJar) {
      await add(stagedLegacyJar, join(directory, 'server.jar'));
      // Legacy Forge's manifest references this adjacent Mojang JAR by filename.
      for (const name of await readdir(stagedServer)) {
        if (!/^minecraft_server\.[a-zA-Z0-9._-]+\.jar$/.test(name)) {
          continue;
        }
        const path = join(stagedServer, name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > maximumInstallerBytes) {
          throw new Error('Invalid legacy Minecraft JAR');
        }
        await this.#assertZip(path, 'Legacy Minecraft JAR');
        await add(path, join(directory, name));
      }
    }
    try {
      for (const move of moves) {
        if (move.had) {
          await rename(move.target, move.backup);
        }
        await rename(move.staged, move.target);
        move.installed = true;
      }
      await persist();
    } catch (error) {
      for (const move of [...moves].reverse()) {
        if (move.installed) {
          await rm(move.target, { recursive: true, force: true });
        }
        if (move.had && (await pathExists(move.backup))) {
          await rename(move.backup, move.target);
        }
      }
      throw error;
    }
    for (const move of moves) {
      await rm(move.backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  async #commitServerJar(
    directory: string,
    stagedJar: string,
    operationId: string,
    persist: () => Promise<void>,
  ): Promise<void> {
    const serverJar = join(directory, 'server.jar');
    const backup = join(directory, `.server.jar.backup-${operationId}`);
    const hadServerJar = await pathExists(serverJar);
    let installed = false;
    try {
      if (hadServerJar) {
        await rename(serverJar, backup);
      }
      await rename(stagedJar, serverJar);
      installed = true;
      await persist();
    } catch (error) {
      if (installed) {
        await rm(serverJar, { force: true });
      }
      if (hadServerJar && (await pathExists(backup))) {
        await rename(backup, serverJar);
      }
      throw error;
    }
    await rm(backup, { force: true, maxRetries: 5, retryDelay: 100 });
  }
}
