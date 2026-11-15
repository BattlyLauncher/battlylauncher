import { readBoundedResponse } from '../network/read-bounded-response';
import { runtimeLinkTarget } from '../files/runtime-link';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, rename, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import {
  normalizeServerId,
  paperMinecraftVersion,
  normalizeServerSoftwareKind,
  type ServerInstallProgress,
  type ServerSoftwareKind,
  type ServerSummary,
} from '../../shared/servers/server-contract';
import { pathExists, writeFileAtomically } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const defaultVersionManifestUrl =
  'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const defaultRuntimeIndexUrl =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const defaultFabricMetaUrl = 'https://meta.fabricmc.net/';
const defaultPaperApiUrl = 'https://fill.papermc.io/v3/';
const maximumJsonBytes = 32 * 1024 * 1024;
const maximumServerBytes = 1024 * 1024 * 1024;
const maximumRuntimeBytes = 2 * 1024 * 1024 * 1024;
const maximumRuntimeFiles = 20_000;

interface DownloadDescriptor {
  readonly algorithm: 'sha1' | 'sha256';
  readonly checksum: string;
  readonly size: number;
  readonly url: string;
}

interface BoundedDownloadDescriptor {
  readonly maximumSize: number;
  readonly url: string;
}

interface ServerArtifact {
  readonly build: string;
  readonly download: BoundedDownloadDescriptor | DownloadDescriptor;
}

interface RuntimeFile {
  readonly descriptor: DownloadDescriptor;
  readonly executable: boolean;
  readonly path: string;
}

interface RuntimeLink {
  readonly path: string;
  readonly target: string;
}

export interface ServerInstallerOptions {
  readonly architecture?: NodeJS.Architecture;
  readonly fetchImplementation?: typeof fetch;
  readonly fabricMetaUrl?: string;
  readonly paperApiUrl?: string;
  readonly platform?: NodeJS.Platform;
  readonly runtimeIndexUrl?: string;
  readonly versionManifestUrl?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value.map((entry: unknown) => entry);
}

function secureUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid ${label} URL`);
  }
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') {
    throw new TypeError(`Invalid ${label} URL`);
  }
  return parsed.href;
}

function checksum(value: unknown, algorithm: DownloadDescriptor['algorithm']): string {
  const length = algorithm === 'sha1' ? 40 : 64;
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`, 'i').test(value)) {
    throw new TypeError('Invalid download checksum');
  }
  return value.toLowerCase();
}

function size(value: unknown, maximum: number, minimum = 1): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError('Invalid download size');
  }
  return parsed;
}

function descriptor(
  value: unknown,
  maximum: number,
  algorithm: DownloadDescriptor['algorithm'] = 'sha1',
  allowEmpty = false,
): DownloadDescriptor {
  const source = record(value, 'download descriptor');
  return {
    algorithm,
    checksum: checksum(
      algorithm === 'sha1'
        ? own(source, 'sha1')
        : own(record(own(source, 'checksums'), 'download checksums'), 'sha256'),
      algorithm,
    ),
    size: size(own(source, 'size'), maximum, allowEmpty ? 0 : 1),
    url: secureUrl(own(source, 'url'), 'download'),
  };
}

function safeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1_024 || value.includes('\0')) {
    throw new TypeError('Invalid runtime path');
  }
  const portable = value.replaceAll('\\', '/');
  const normalized = normalize(portable);
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new TypeError('Runtime path escapes its installation directory');
  }
  return normalized;
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }
  return JSON.parse(
    await readBoundedResponse(response, maximumJsonBytes, `${label} exceeds its size limit`),
  ) as unknown;
}

function runtimePlatform(platform: NodeJS.Platform, architecture: NodeJS.Architecture): string {
  if (platform === 'win32') {
    return architecture === 'ia32' ? 'windows-x86' : 'windows-x64';
  }
  if (platform === 'darwin') {
    return architecture === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  }
  if (platform === 'linux') {
    return architecture === 'ia32' ? 'linux-i386' : 'linux';
  }
  throw new Error(`Unsupported Java runtime platform: ${platform}-${architecture}`);
}

export class ServerInstallerService {
  readonly #architecture: NodeJS.Architecture;
  readonly #fetch: typeof fetch;
  readonly #fabricMetaUrl: string;
  readonly #listeners = new Set<(progress: ServerInstallProgress) => void>();
  readonly #operations = new Map<string, Promise<void>>();
  readonly #platform: NodeJS.Platform;
  readonly #paperApiUrl: string;
  readonly #runtimeIndexUrl: string;
  readonly #store: ServerStore;
  readonly #versionManifestUrl: string;

  constructor(store: ServerStore, options: ServerInstallerOptions = {}) {
    this.#store = store;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#platform = options.platform ?? process.platform;
    this.#architecture = options.architecture ?? process.arch;
    this.#fabricMetaUrl = secureUrl(options.fabricMetaUrl ?? defaultFabricMetaUrl, 'Fabric Meta');
    this.#paperApiUrl = secureUrl(options.paperApiUrl ?? defaultPaperApiUrl, 'Paper API');
    this.#versionManifestUrl = secureUrl(
      options.versionManifestUrl ?? defaultVersionManifestUrl,
      'version manifest',
    );
    this.#runtimeIndexUrl = secureUrl(
      options.runtimeIndexUrl ?? defaultRuntimeIndexUrl,
      'runtime index',
    );
  }

  subscribe(listener: (progress: ServerInstallProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  install(
    idValue: unknown,
    softwareValue: unknown = 'vanilla',
    acceptCompatiblePaper = false,
  ): Promise<void> {
    const id = normalizeServerId(idValue);
    const software = normalizeServerSoftwareKind(softwareValue);
    const existing = this.#operations.get(id);
    if (existing) {
      return existing;
    }
    const operation = this.#install(id, software, acceptCompatiblePaper).finally(() =>
      this.#operations.delete(id),
    );
    this.#operations.set(id, operation);
    return operation;
  }

  async #install(
    id: string,
    software: ServerSoftwareKind,
    acceptCompatiblePaper: boolean,
  ): Promise<void> {
    const [directory, server] = await Promise.all([
      this.#store.directoryPathInternal(id),
      this.#store.list().then((entries) => entries.find((entry) => entry.id === id)),
    ]);
    if (!server) {
      throw new Error('Server metadata is unavailable');
    }
    const gameVersion =
      software === 'paper' ? paperMinecraftVersion(server.version) : server.version;
    if (gameVersion !== server.version && !acceptCompatiblePaper) {
      throw new Error(
        `Paper no existe para Minecraft ${server.version}. Confirma la instalación de Paper ${gameVersion}, compatible con clientes ${server.version}.`,
      );
    }
    this.#emit(id, 'resolving', 0, 0, server.version);
    const reportResolution = (current: string): void => this.#emit(id, 'resolving', 0, 0, current);
    const { javaComponent, serverDownload } = await this.#resolveServer(
      { ...server, version: gameVersion },
      reportResolution,
    );
    const artifact = await this.#resolveSoftware(
      software,
      gameVersion,
      serverDownload,
      reportResolution,
    );
    const { files, links } = await this.#resolveRuntime(javaComponent, reportResolution);
    const runtimeBytes = files.reduce((total, file) => total + file.descriptor.size, 0);
    if (runtimeBytes > maximumRuntimeBytes) {
      throw new Error('Java runtime exceeds its size limit');
    }

    const operationId = randomUUID().replaceAll('-', '');
    const staging = join(directory, `.runtime-install-${operationId}`);
    const stagedJar = join(staging, 'server.jar');
    const stagedJava = join(staging, 'java');
    await mkdir(stagedJava, { recursive: true });
    try {
      if ('checksum' in artifact.download) {
        const verifiedDownload = artifact.download;
        await this.#download(verifiedDownload, stagedJar, (completed) =>
          this.#emit(id, 'server', completed, verifiedDownload.size, `${software} server.jar`),
        );
      } else {
        await this.#downloadBoundedJar(artifact.download, stagedJar, (completed, total) =>
          this.#emit(id, 'server', completed, total, `${software} server.jar`),
        );
      }
      let javaCompleted = 0;
      for (const file of files) {
        const destination = this.#inside(stagedJava, file.path);
        await this.#download(file.descriptor, destination, (completed) =>
          this.#emit(id, 'java', javaCompleted + completed, runtimeBytes, file.path),
        );
        if (file.executable && this.#platform !== 'win32') {
          await chmod(destination, 0o755);
        }
        javaCompleted += file.descriptor.size;
      }
      for (const link of links) {
        const destination = this.#inside(stagedJava, link.path);
        const target = runtimeLinkTarget(stagedJava, destination, link.target);
        await mkdir(dirname(destination), { recursive: true });
        await symlink(target, destination);
      }
      const eulaPath = join(directory, 'eula.txt');
      if (!(await pathExists(eulaPath))) {
        await writeFileAtomically(eulaPath, server.eulaAccepted ? 'eula=true\n' : 'eula=false\n');
      }
      await this.#commit(directory, stagedJar, stagedJava, operationId, async () => {
        await this.#store.updateSoftware(id, {
          build: artifact.build,
          installedAt: new Date().toISOString(),
          kind: software,
          gameVersion,
        });
      });
      this.#emit(id, 'complete', runtimeBytes, runtimeBytes, `${software} instalado`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async #resolveServer(
    server: ServerSummary,
    report: (current: string) => void,
  ): Promise<{
    javaComponent: string;
    serverDownload: DownloadDescriptor;
  }> {
    const index = record(
      await responseJson(
        await this.#fetch(this.#versionManifestUrl, {
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        }),
        'Version manifest',
      ),
      'version manifest',
    );
    const versions = array(own(index, 'versions'), 'version manifest');
    report(`Metadatos de Minecraft ${server.version}`);
    const match = versions.find((value) => {
      const entry = record(value, 'version entry');
      return own(entry, 'id') === server.version;
    });
    const versionEntry = record(match, 'server version');
    const metadataUrl = secureUrl(own(versionEntry, 'url'), 'version metadata');
    const metadata = record(
      await responseJson(
        await this.#fetch(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) }),
        'Version metadata',
      ),
      'version metadata',
    );
    const downloads = record(own(metadata, 'downloads'), 'version downloads');
    const javaVersion = record(own(metadata, 'javaVersion'), 'Java version');
    report('Índice de runtimes Java');
    const javaComponent = own(javaVersion, 'component');
    if (typeof javaComponent !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(javaComponent)) {
      throw new TypeError('Invalid Java runtime component');
    }
    return {
      javaComponent,
      serverDownload: descriptor(own(downloads, 'server'), maximumServerBytes),
    };
  }

  async #resolveSoftware(
    software: ServerSoftwareKind,
    gameVersion: string,
    vanilla: DownloadDescriptor,
    report: (current: string) => void,
  ): Promise<ServerArtifact> {
    if (software === 'vanilla') {
      return { build: gameVersion, download: vanilla };
    }
    const headers = { 'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)' };
    if (software === 'paper') {
      report(`Buscando Paper estable para ${gameVersion}`);
      const url = secureUrl(
        new URL(
          `projects/paper/versions/${encodeURIComponent(gameVersion)}/builds`,
          this.#paperApiUrl,
        ).href,
        'Paper builds',
      );
      const response = await this.#fetch(url, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 404) {
        throw new Error(
          `Paper no publica archivos para Minecraft ${gameVersion}. No se ha modificado el servidor. Elige una versión disponible en Paper.`,
        );
      }
      const builds = array(await responseJson(response, 'Paper builds'), 'Paper builds');
      const stable = builds.find(
        (value) => own(record(value, 'Paper build'), 'channel') === 'STABLE',
      );
      if (!stable) {
        throw new Error(
          `Paper todavía no publica una versión estable para Minecraft ${gameVersion}. Elige otra versión o software.`,
        );
      }
      const build = record(stable, 'stable Paper build');
      const buildId = own(build, 'id');
      if (
        (typeof buildId !== 'string' && typeof buildId !== 'number') ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(String(buildId))
      ) {
        throw new TypeError('Invalid Paper build id');
      }
      const downloads = record(own(build, 'downloads'), 'Paper downloads');
      return {
        build: String(buildId),
        download: descriptor(own(downloads, 'server:default'), maximumServerBytes, 'sha256'),
      };
    }

    if (software !== 'fabric') {
      throw new Error('Este software necesita su instalador de loader');
    }
    report(`Buscando Fabric estable para ${gameVersion}`);
    const loaderUrl = secureUrl(
      new URL(`v2/versions/loader/${encodeURIComponent(gameVersion)}`, this.#fabricMetaUrl).href,
      'Fabric loaders',
    );
    const installerUrl = secureUrl(
      new URL('v2/versions/installer', this.#fabricMetaUrl).href,
      'Fabric installers',
    );
    const [loaderValues, installerValues] = await Promise.all([
      responseJson(
        await this.#fetch(loaderUrl, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        }),
        'Fabric loaders',
      ).then((value) => array(value, 'Fabric loaders')),
      responseJson(
        await this.#fetch(installerUrl, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        }),
        'Fabric installers',
      ).then((value) => array(value, 'Fabric installers')),
    ]);
    const stableLoader = loaderValues.find((value) => {
      const entry = record(value, 'Fabric loader');
      return own(record(own(entry, 'loader'), 'Fabric loader metadata'), 'stable') === true;
    });
    const loaderEntry = record(stableLoader ?? loaderValues[0], 'Fabric loader');
    const loader = record(own(loaderEntry, 'loader'), 'Fabric loader metadata');
    const stableInstaller = installerValues.find(
      (value) => own(record(value, 'Fabric installer'), 'stable') === true,
    );
    const installer = record(stableInstaller ?? installerValues[0], 'Fabric installer');
    const loaderVersion = own(loader, 'version');
    const installerVersion = own(installer, 'version');
    for (const [label, value] of [
      ['loader', loaderVersion],
      ['installer', installerVersion],
    ] as const) {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9.+_-]{1,128}$/.test(value)) {
        throw new TypeError(`Invalid Fabric ${label} version`);
      }
    }
    const jarUrl = secureUrl(
      new URL(
        `v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion as string)}/${encodeURIComponent(installerVersion as string)}/server/jar`,
        this.#fabricMetaUrl,
      ).href,
      'Fabric server JAR',
    );
    return {
      build: String(loaderVersion),
      download: { maximumSize: maximumServerBytes, url: jarUrl },
    };
  }

  async #resolveRuntime(
    component: string,
    report: (current: string) => void,
  ): Promise<{
    files: RuntimeFile[];
    links: RuntimeLink[];
  }> {
    const index = record(
      await responseJson(
        await this.#fetch(this.#runtimeIndexUrl, {
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        }),
        'Runtime index',
      ),
      'runtime index',
    );
    const platform = own(index, runtimePlatform(this.#platform, this.#architecture));
    report(`Runtime Java ${component}`);
    const platformComponents = record(platform, 'runtime platform');
    const releases = array(own(platformComponents, component), 'Java runtime releases');
    if (!releases.length) {
      throw new Error('Java runtime not found');
    }
    const release = record(releases[0], 'runtime release');
    const manifest = record(own(release, 'manifest'), 'runtime manifest');
    const manifestUrl = secureUrl(own(manifest, 'url'), 'runtime manifest');
    const runtime = record(
      await responseJson(
        await this.#fetch(manifestUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) }),
        'Runtime manifest',
      ),
      'runtime manifest',
    );
    const sourceFiles = record(own(runtime, 'files'), 'runtime files');
    report('Preparando archivos de Java');
    const entries = Object.entries(sourceFiles);
    if (entries.length > maximumRuntimeFiles) {
      throw new Error('Java runtime has too many files');
    }
    const files: RuntimeFile[] = [];
    const links: RuntimeLink[] = [];
    for (const [pathValue, value] of entries) {
      const path = safeRelativePath(pathValue);
      const entry = record(value, 'runtime file');
      const type = own(entry, 'type');
      if (type === 'directory') {
        continue;
      }
      if (type === 'link') {
        const target = own(entry, 'target');
        if (typeof target !== 'string') {
          throw new TypeError('Invalid runtime link');
        }
        links.push({ path, target });
        continue;
      }
      if (type !== 'file') {
        throw new TypeError('Invalid runtime file type');
      }
      const downloads = record(own(entry, 'downloads'), 'runtime downloads');
      files.push({
        path,
        executable: own(entry, 'executable') === true,
        // Mojang's signed jre-legacy manifest contains one legitimate empty file
        // (lib/security/trusted.libraries). Its SHA-1 still verifies the payload.
        descriptor: descriptor(own(downloads, 'raw'), maximumRuntimeBytes, 'sha1', true),
      });
    }
    if (!files.length) {
      throw new Error('Java runtime is empty');
    }
    return { files, links };
  }

  async #download(
    source: DownloadDescriptor,
    destination: string,
    progress: (completed: number) => void,
  ): Promise<void> {
    const response = await this.#fetch(source.url, {
      headers: { 'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)' },
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status})`);
    }
    const declaredHeader = response.headers.get('content-length');
    const declared = declaredHeader === null ? null : Number(declaredHeader);
    if (declared !== null && Number.isFinite(declared) && declared !== source.size) {
      throw new Error('Download size mismatch');
    }
    await mkdir(dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx');
    const digest = createHash(source.algorithm);
    let completed = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        completed += chunk.value.byteLength;
        if (completed > source.size) {
          await reader.cancel();
          throw new Error('Download size mismatch');
        }
        digest.update(chunk.value);
        await handle.write(chunk.value);
        progress(completed);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (completed !== source.size || digest.digest('hex') !== source.checksum) {
      throw new Error('Download checksum mismatch');
    }
  }

  async #downloadBoundedJar(
    source: BoundedDownloadDescriptor,
    destination: string,
    progress: (completed: number, total: number) => void,
  ): Promise<void> {
    const response = await this.#fetch(source.url, {
      headers: { 'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)' },
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status})`);
    }
    const declaredHeader = response.headers.get('content-length');
    const declared = declaredHeader === null ? 0 : Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > source.maximumSize) {
      throw new Error('Download size mismatch');
    }
    await mkdir(dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx');
    let completed = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        completed += chunk.value.byteLength;
        if (completed > source.maximumSize || (declared > 0 && completed > declared)) {
          await reader.cancel();
          throw new Error('Download size mismatch');
        }
        await handle.write(chunk.value);
        progress(completed, declared);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (completed < 4 || (declared > 0 && completed !== declared)) {
      throw new Error('Download size mismatch');
    }
    const archive = await open(destination, 'r');
    try {
      const signature = Buffer.alloc(4);
      const { bytesRead } = await archive.read(signature, 0, 4, 0);
      if (bytesRead !== 4 || signature.readUInt32LE(0) !== 0x04034b50) {
        throw new TypeError('Invalid server JAR');
      }
    } finally {
      await archive.close();
    }
  }

  async #commit(
    directory: string,
    stagedJar: string,
    stagedJava: string,
    operationId: string,
    persist: () => Promise<void>,
  ): Promise<void> {
    const jar = join(directory, 'server.jar');
    const java = join(directory, 'java');
    const jarBackup = join(directory, `.server.jar.backup-${operationId}`);
    const javaBackup = join(directory, `.java.backup-${operationId}`);
    const hadJar = await pathExists(jar);
    const hadJava = await pathExists(java);
    let installedJar = false;
    let installedJava = false;
    try {
      if (hadJar) {
        await rename(jar, jarBackup);
      }
      if (hadJava) {
        await rename(java, javaBackup);
      }
      await rename(stagedJar, jar);
      installedJar = true;
      await rename(stagedJava, java);
      installedJava = true;
      await persist();
    } catch (error) {
      if (installedJava) {
        await rm(java, { recursive: true, force: true });
      }
      if (installedJar) {
        await rm(jar, { force: true });
      }
      if (hadJava && (await pathExists(javaBackup))) {
        await rename(javaBackup, java);
      }
      if (hadJar && (await pathExists(jarBackup))) {
        await rename(jarBackup, jar);
      }
      throw error;
    }
    await rm(jarBackup, { force: true });
    await rm(javaBackup, { recursive: true, force: true });
  }

  #inside(root: string, pathValue: string): string {
    const target = resolve(root, pathValue);
    const relation = relative(root, target);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
      throw new TypeError('Runtime path escapes its installation directory');
    }
    return target;
  }

  #emit(
    id: string,
    phase: ServerInstallProgress['phase'],
    completedBytes: number,
    totalBytes: number,
    current: string,
  ): void {
    const progress = { id, phase, completedBytes, totalBytes, current } as const;
    for (const listener of this.#listeners) {
      listener(progress);
    }
  }
}
