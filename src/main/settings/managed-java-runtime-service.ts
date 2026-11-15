import { readBoundedResponse } from '../network/read-bounded-response';
import { systemArchitecture } from './system-architecture';
import { remoteOperationContext } from '../social/remote-operation-context';
import { resolveJavaArchive, installJavaArchive } from './java-provider-download';
import type { JavaRuntimeProvider } from '../../shared/settings/java-runtime-contract';
import { runtimeLinkTarget } from '../files/runtime-link';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import {
  managedJavaMajors,
  type ManagedJavaInstallProgress,
  type ManagedJavaMajor,
  type ManagedJavaSnapshot,
} from '../../shared/settings/java-runtime-contract';
import { pathExists, writeFileAtomically } from '../files/atomic-file';
import type { SettingsStore } from './settings-store';

const defaultRuntimeIndexUrl =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const maximumJsonBytes = 32 * 1024 * 1024;
const maximumRuntimeBytes = 2 * 1024 * 1024 * 1024;
const maximumRuntimeFiles = 20_000;

interface DownloadDescriptor {
  readonly sha1: string;
  readonly size: number;
  readonly url: string;
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

interface ResolvedRuntime {
  readonly files: readonly RuntimeFile[];
  readonly links: readonly RuntimeLink[];
  readonly version: string;
}

export interface ManagedJavaRuntimeOptions {
  readonly architecture?: NodeJS.Architecture;
  readonly fetchImplementation?: typeof fetch;
  readonly platform?: NodeJS.Platform;
  readonly runtimeIndexUrl?: string;
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

function descriptor(value: unknown): DownloadDescriptor {
  const source = record(value, 'download descriptor');
  const sha1 = own(source, 'sha1');
  const size = own(source, 'size');
  if (typeof sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(sha1)) {
    throw new TypeError('Invalid runtime checksum');
  }
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > maximumRuntimeBytes
  ) {
    throw new TypeError('Invalid runtime file size');
  }
  return {
    sha1: sha1.toLowerCase(),
    size,
    url: secureUrl(own(source, 'url'), 'runtime download'),
  };
}

function safeRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1_024 || value.includes('\0')) {
    throw new TypeError('Invalid runtime path');
  }
  const normalized = normalize(value.replaceAll('\\', '/'));
  if (
    isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new TypeError('Runtime path escapes its installation directory');
  }
  return normalized;
}

function runtimePlatform(platform: NodeJS.Platform, architecture: NodeJS.Architecture): string {
  if (platform === 'win32') {
    if (architecture === 'ia32') {
      return 'windows-x86';
    }
    if (architecture === 'arm64') {
      return 'windows-arm64';
    }
    return 'windows-x64';
  }
  if (platform === 'darwin') {
    return architecture === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  }
  if (platform === 'linux') {
    return architecture === 'ia32'
      ? 'linux-i386'
      : architecture === 'arm64'
        ? 'linux-arm64'
        : 'linux';
  }
  throw new Error(`Unsupported Java runtime platform: ${platform}-${architecture}`);
}

function component(major: ManagedJavaMajor): string {
  if (major === 8) {
    return 'jre-legacy';
  }
  if (major === 16) {
    return 'java-runtime-alpha';
  }
  if (major === 17) {
    return 'java-runtime-gamma';
  }
  if (major === 21) {
    return 'java-runtime-delta';
  }
  return 'java-runtime-epsilon';
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }
  return JSON.parse(
    await readBoundedResponse(response, maximumJsonBytes, `${label} exceeds its size limit`),
  ) as unknown;
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

export class ManagedJavaRuntimeService {
  readonly #architecture: NodeJS.Architecture;
  readonly #fetch: typeof fetch;
  readonly #listeners = new Set<(progress: ManagedJavaInstallProgress) => void>();
  readonly #operations = new Map<
    ManagedJavaMajor,
    { provider: JavaRuntimeProvider; promise: Promise<ManagedJavaSnapshot> }
  >();
  readonly #platform: NodeJS.Platform;
  readonly #root: string;
  readonly #runtimeIndexUrl: string;
  readonly #store: SettingsStore;

  constructor(root: string, store: SettingsStore, options: ManagedJavaRuntimeOptions = {}) {
    if (!isAbsolute(root)) {
      throw new TypeError('Managed Java root must be absolute');
    }
    this.#root = resolve(root);
    this.#store = store;
    const fetchImplementation = options.fetchImplementation ?? fetch;
    this.#fetch = (input, init) => {
      const signal = remoteOperationContext.getStore();
      return fetchImplementation(
        input,
        signal
          ? { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }
          : init,
      );
    };
    this.#platform = options.platform ?? process.platform;
    this.#architecture = options.architecture ?? systemArchitecture();
    this.#runtimeIndexUrl = secureUrl(
      options.runtimeIndexUrl ?? defaultRuntimeIndexUrl,
      'runtime index',
    );
  }

  subscribe(listener: (progress: ManagedJavaInstallProgress) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async snapshot(): Promise<ManagedJavaSnapshot> {
    const selectedPath = (await this.#store.snapshot()).runtime.javaPath;
    const runtimes = await Promise.all(
      managedJavaMajors.map(async (major) => {
        const discovered = await this.#installedRuntime(major);
        const path = discovered?.path ?? this.#javaPath(major);
        const installed = discovered !== null;
        let version: string | null = discovered?.version ?? null;
        if (installed && path === this.#javaPath(major)) {
          try {
            const metadata = JSON.parse(
              await readFile(join(this.#directory(major), 'runtime.json'), 'utf8'),
            ) as unknown;
            const value = own(record(metadata, 'runtime metadata'), 'version');
            if (typeof value === 'string' && value.length <= 128) {
              version = value;
            }
          } catch {
            version = null;
          }
        }
        return {
          major,
          installed,
          path: installed ? path : null,
          selected: installed && resolve(selectedPath) === resolve(path),
          version,
        } as const;
      }),
    );
    return {
      runtimes,
      selectedMajor: runtimes.find((runtime) => runtime.selected)?.major ?? null,
    };
  }

  install(
    major: ManagedJavaMajor,
    provider: JavaRuntimeProvider = 'mojang',
  ): Promise<ManagedJavaSnapshot> {
    const existing = this.#operations.get(major);
    if (existing) {
      return existing.provider === provider
        ? existing.promise
        : Promise.reject(
            new Error('Ya se está instalando esta versión de Java desde otro proveedor'),
          );
    }
    const operation = this.#install(major, provider).finally(() => this.#operations.delete(major));
    this.#operations.set(major, { provider, promise: operation });
    return operation;
  }

  async select(major: ManagedJavaMajor): Promise<ManagedJavaSnapshot> {
    const runtime = await this.#installedRuntime(major);
    if (!runtime) {
      throw new Error(`Java ${major} no está instalado`);
    }
    const path = runtime.path;
    await this.#store.selectManagedJavaRuntime(major, path);
    return this.snapshot();
  }

  async clearSelection(): Promise<ManagedJavaSnapshot> {
    await this.#store.clearManagedJavaRuntimeSelection();
    return this.snapshot();
  }

  async #install(
    major: ManagedJavaMajor,
    provider: JavaRuntimeProvider,
  ): Promise<ManagedJavaSnapshot> {
    if (this.#architecture === 'ia32' && major >= 25) {
      throw new Error('Java 25 requiere un sistema de 64 bits');
    }
    if (provider !== 'mojang') {
      this.#emit(major, 'resolving', 0, 0, provider);
      const archive = await resolveJavaArchive(
        provider,
        major,
        this.#platform,
        this.#architecture,
        this.#fetch,
      );
      const staging = join(this.#root, `.java-${major}-install-${randomUUID()}`);
      await mkdir(staging, { recursive: true });
      try {
        const runtime = await installJavaArchive(
          archive,
          staging,
          this.#fetch,
          (current, total) => this.#emit(major, 'download', current, total, provider),
          () => this.#emit(major, 'extracting', 0, 0, provider),
        );
        if (!(await regularFile(this.#javaPathInside(runtime)))) {
          throw new Error('Java executable was not installed');
        }
        await writeFileAtomically(
          join(runtime, 'runtime.json'),
          JSON.stringify({ major, version: archive.version, source: provider }),
        );
        remoteOperationContext.getStore()?.throwIfAborted();
        await this.#commit(major, runtime);
        await this.#store.recordManagedJavaRuntime(major, this.#javaPath(major));
        this.#emit(major, 'complete', archive.size, archive.size, `Java ${major} instalado`);
        return this.snapshot();
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    }
    this.#emit(major, 'resolving', 0, 0, 'Índice de runtimes Java');
    const runtime = await this.#resolve(major);
    const totalBytes = runtime.files.reduce((sum, file) => sum + file.descriptor.size, 0);
    if (totalBytes > maximumRuntimeBytes) {
      throw new Error('Java runtime exceeds its size limit');
    }
    const staging = join(this.#root, `.java-${major}-install-${randomUUID()}`);
    await mkdir(staging, { recursive: true });
    try {
      let completedBytes = 0;
      for (const file of runtime.files) {
        const destination = this.#inside(staging, file.path);
        await this.#download(file.descriptor, destination, (completed) => {
          this.#emit(major, 'download', completedBytes + completed, totalBytes, file.path);
        });
        if (file.executable && this.#platform !== 'win32') {
          await chmod(destination, 0o755);
        }
        completedBytes += file.descriptor.size;
      }
      for (const link of runtime.links) {
        const destination = this.#inside(staging, link.path);
        const target = runtimeLinkTarget(staging, destination, link.target);
        await mkdir(dirname(destination), { recursive: true });
        await symlink(target, destination);
      }
      // Mojang ships macOS runtimes inside a bundle, unlike Windows/Linux
      // and the already-normalized Adoptium/Zulu archives.
      const bundledJava =
        this.#platform === 'darwin'
          ? runtime.files.find((file) =>
              file.path.replaceAll('\\', '/').endsWith('/Contents/Home/bin/java'),
            )
          : undefined;
      const runtimeRoot = bundledJava
        ? dirname(dirname(this.#inside(staging, bundledJava.path)))
        : staging;
      const executable = this.#javaPathInside(runtimeRoot);
      if (!(await regularFile(executable))) {
        throw new Error('Java executable was not installed');
      }
      await writeFileAtomically(
        join(runtimeRoot, 'runtime.json'),
        `${JSON.stringify({ major, version: runtime.version, source: 'mojang' }, null, 2)}\n`,
      );
      remoteOperationContext.getStore()?.throwIfAborted();
      await this.#commit(major, runtimeRoot);
      const path = this.#javaPath(major);
      await this.#store.recordManagedJavaRuntime(major, path);
      this.#emit(major, 'complete', totalBytes, totalBytes, `Java ${major} instalado`);
      return this.snapshot();
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  async #resolve(major: ManagedJavaMajor): Promise<ResolvedRuntime> {
    const index = record(
      await responseJson(
        await this.#fetch(this.#runtimeIndexUrl, { redirect: 'error' }),
        'Runtime index',
      ),
      'runtime index',
    );
    const platform = record(
      own(index, runtimePlatform(this.#platform, this.#architecture)),
      'runtime platform',
    );
    const releases = own(platform, component(major));
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error(`Java ${major} no está disponible para esta plataforma`);
    }
    const release = record(releases[0], 'runtime release');
    const versionValue = own(record(own(release, 'version'), 'runtime version'), 'name');
    if (typeof versionValue !== 'string' || !versionValue || versionValue.length > 128) {
      throw new TypeError('Invalid runtime version');
    }
    const manifestUrl = secureUrl(
      own(record(own(release, 'manifest'), 'runtime manifest'), 'url'),
      'runtime manifest',
    );
    const manifest = record(
      await responseJson(await this.#fetch(manifestUrl, { redirect: 'error' }), 'Runtime manifest'),
      'runtime manifest',
    );
    const entries = Object.entries(record(own(manifest, 'files'), 'runtime files'));
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
      files.push({
        path,
        executable: own(entry, 'executable') === true,
        descriptor: descriptor(own(record(own(entry, 'downloads'), 'runtime downloads'), 'raw')),
      });
    }
    if (files.length === 0) {
      throw new Error('Java runtime is empty');
    }
    return { files, links, version: versionValue };
  }

  async #download(
    source: DownloadDescriptor,
    destination: string,
    progress: (completed: number) => void,
  ): Promise<void> {
    const response = await this.#fetch(source.url, { redirect: 'error' });
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
    const digest = createHash('sha1');
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
    if (completed !== source.size || digest.digest('hex') !== source.sha1) {
      throw new Error('Download checksum mismatch');
    }
  }

  async #commit(major: ManagedJavaMajor, staging: string): Promise<void> {
    const destination = this.#directory(major);
    const backup = join(this.#root, `.java-${major}-backup-${randomUUID()}`);
    const hadPrevious = await pathExists(destination);
    let movedPrevious = false;
    let published = false;
    try {
      if (hadPrevious) {
        await rename(destination, backup);
        movedPrevious = true;
      }
      await rename(staging, destination);
      published = true;
    } catch (error) {
      if (published) {
        await rm(destination, { recursive: true, force: true });
      }
      if (movedPrevious && (await pathExists(backup))) {
        await rename(backup, destination);
      }
      throw error;
    }
    await rm(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
      () => undefined,
    );
  }

  #directory(major: ManagedJavaMajor): string {
    return join(this.#root, `java-${major}`);
  }

  async #installedRuntime(
    major: ManagedJavaMajor,
  ): Promise<{ readonly path: string; readonly version: string | null } | null> {
    const managedPath = this.#javaPath(major);
    if (await regularFile(managedPath)) {
      return { path: managedPath, version: null };
    }
    let directories: string[];
    try {
      directories = (await readdir(this.#root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(`jre-${major}`))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, 'en', { numeric: true }));
    } catch {
      return null;
    }
    for (const directory of directories) {
      const path = this.#javaPathInside(join(this.#root, directory));
      if (await regularFile(path)) {
        const match = directory.match(/^jre-([^\s]+?)(?:-windows|-linux|-macos)/i);
        return { path, version: match?.[1] ?? directory.slice(4) };
      }
    }
    return null;
  }

  #javaPath(major: ManagedJavaMajor): string {
    return this.#javaPathInside(this.#directory(major));
  }

  #javaPathInside(root: string): string {
    return join(root, 'bin', this.#platform === 'win32' ? 'javaw.exe' : 'java');
  }

  #inside(root: string, value: string): string {
    const target = resolve(root, value);
    const relation = relative(root, target);
    if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
      throw new TypeError('Runtime path escapes its installation directory');
    }
    return target;
  }

  #emit(
    major: ManagedJavaMajor,
    phase: ManagedJavaInstallProgress['phase'],
    completedBytes: number,
    totalBytes: number,
    current: string,
  ): void {
    const progress = { major, phase, completedBytes, totalBytes, current } as const;
    for (const listener of this.#listeners) {
      listener(progress);
    }
  }
}
