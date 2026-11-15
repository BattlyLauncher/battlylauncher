import { readBoundedResponse } from '../network/read-bounded-response';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';

import { normalizeInstanceDraft, type InstanceSummary } from '../../shared/minecraft/instance';
import type { ModpackInstallProgressSink } from '../../shared/mods/modpack-install-contract';
import { writeFileAtomically } from '../files/atomic-file';

const maximumArchiveBytes = 512 * 1024 * 1024;
const maximumExtractedBytes = 1024 * 1024 * 1024;
const maximumEntries = 10_000;
const maximumFiles = 10_000;
const maximumDownloadBytes = 512 * 1024 * 1024;

interface CurseForgeFileReference {
  readonly fileId: number;
  readonly projectId: number;
}

interface CurseForgeManifest {
  readonly author: string;
  readonly files: readonly CurseForgeFileReference[];
  readonly loader: string | null;
  readonly loaderVersion: string | null;
  readonly minecraftVersion: string;
  readonly name: string;
  readonly overrides: string;
  readonly version: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid CurseForge ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum) {
    throw new TypeError(`Invalid CurseForge ${label}`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`Invalid CurseForge ${label}`);
  }
  return Number(value);
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (
    !normalized ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('CurseForge archive contains an unsafe path');
  }
  return normalized;
}

function safeDestination(root: string, relativePath: string): string {
  const destination = resolve(root, ...safeRelativePath(relativePath).split('/'));
  const fromRoot = relative(root, destination);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new TypeError('CurseForge destination escapes the instance');
  }
  return destination;
}

function parseLoader(value: string): {
  readonly loader: string | null;
  readonly version: string | null;
} {
  const normalized = value.toLowerCase();
  for (const loader of ['legacyfabric', 'neoforge', 'fabric', 'forge', 'quilt'] as const) {
    if (!normalized.startsWith(`${loader}-`) && !normalized.startsWith(`${loader}_`)) {
      continue;
    }
    return { loader, version: value.slice(loader.length + 1) || null };
  }
  return { loader: null, version: null };
}

function manifest(value: unknown): CurseForgeManifest {
  const source = objectValue(value, 'manifest');
  if (own(source, 'manifestType') !== 'minecraftModpack') {
    throw new TypeError('Unsupported CurseForge manifest type');
  }
  const minecraft = objectValue(own(source, 'minecraft'), 'Minecraft metadata');
  const modLoaders = own(minecraft, 'modLoaders');
  if (!Array.isArray(modLoaders) || modLoaders.length > 20) {
    throw new TypeError('Invalid CurseForge mod loaders');
  }
  const loaders = modLoaders as readonly unknown[];
  const preferred =
    loaders.find((entry) => own(objectValue(entry, 'loader'), 'primary') === true) ?? loaders[0];
  const parsedLoader = preferred
    ? parseLoader(text(own(objectValue(preferred, 'loader'), 'id'), 'loader id', 128))
    : { loader: null, version: null };
  const rawFiles = own(source, 'files');
  if (!Array.isArray(rawFiles) || rawFiles.length > maximumFiles) {
    throw new TypeError('Invalid CurseForge file list');
  }
  return {
    name: text(own(source, 'name'), 'name', 128),
    author: text(own(source, 'author') ?? '', 'author', 128, true),
    version: text(own(source, 'version') ?? '', 'pack version', 128, true),
    minecraftVersion: text(own(minecraft, 'version'), 'Minecraft version', 128),
    loader: parsedLoader.loader,
    loaderVersion: parsedLoader.version,
    overrides: safeRelativePath(text(own(source, 'overrides') ?? 'overrides', 'overrides', 128)),
    files: rawFiles.map((entry) => {
      const file = objectValue(entry, 'file');
      return {
        projectId: positiveInteger(own(file, 'projectID'), 'project id'),
        fileId: positiveInteger(own(file, 'fileID'), 'file id'),
      };
    }),
  };
}

function isSymbolicLink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.attr >>> 16) & 0o170000) === 0o120000;
}

function findManifestEntry(entries: readonly AdmZip.IZipEntry[]): {
  readonly entry: AdmZip.IZipEntry;
  readonly rootPrefix: string;
} | null {
  const candidates = entries.filter(
    (entry) => !entry.isDirectory && /(?:^|\/)manifest\.json$/i.test(entry.entryName),
  );
  const root = candidates.find((entry) => !entry.entryName.includes('/'));
  if (root) {
    return { entry: root, rootPrefix: '' };
  }
  if (candidates.length !== 1) {
    return null;
  }
  const entry = candidates[0];
  if (!entry) {
    return null;
  }
  const rootPrefix = entry.entryName.slice(0, -'manifest.json'.length);
  return rootPrefix && !rootPrefix.slice(0, -1).includes('/') ? { entry, rootPrefix } : null;
}

function packIconDataUrl(
  entries: readonly AdmZip.IZipEntry[],
  overridePrefix: string,
): string | undefined {
  const candidates = entries
    .filter((entry) => {
      if (entry.isDirectory || entry.header.size > 1024 * 1024) {
        return false;
      }
      if (!entry.entryName.toLowerCase().startsWith(overridePrefix.toLowerCase())) {
        return false;
      }
      return /(?:^|\/)(?:modpack[-_ ]?icon|icon|logo)\.(?:png|jpe?g|webp)$/i.test(entry.entryName);
    })
    .sort((left, right) => {
      const preferred = (entry: AdmZip.IZipEntry): number =>
        /(?:^|\/)modpack[-_ ]?icon\./i.test(entry.entryName) ? 0 : 1;
      return preferred(left) - preferred(right) || left.entryName.length - right.entryName.length;
    });
  for (const entry of candidates) {
    const bytes = entry.getData();
    const signature = bytes.subarray(0, 12).toString('hex');
    const type = signature.startsWith('89504e470d0a1a0a')
      ? 'png'
      : signature.startsWith('ffd8ff')
        ? 'jpeg'
        : signature.startsWith('52494646') && signature.endsWith('57454250')
          ? 'webp'
          : null;
    if (type) {
      return `data:image/${type};base64,${bytes.toString('base64')}`;
    }
  }
  return undefined;
}

function safeDownloadUrl(value: unknown): string {
  const url = new URL(text(value, 'download URL', 4096));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !['edge.forgecdn.net', 'media.forgecdn.net', 'mediafilez.forgecdn.net'].includes(url.hostname)
  ) {
    throw new TypeError('Invalid CurseForge download URL');
  }
  // ForgeCDN's legacy edge host redirects to this fixed CDN endpoint.
  // Canonicalize it locally rather than following a server-controlled Location.
  if (url.hostname === 'edge.forgecdn.net') {
    url.hostname = 'mediafilez.forgecdn.net';
  }
  return url.toString();
}

interface CurseForgeDownload {
  readonly filename: string;
  readonly url: string;
  readonly sha1: string;
  readonly size: number;
}

function safeFilename(value: unknown): string {
  const filename = text(value, 'filename', 255);
  // Reject control characters as well as reserved path characters.
  if (
    basename(filename) !== filename ||
    // eslint-disable-next-line no-control-regex -- Los nombres no pueden contener caracteres C0.
    /[\\/:*?"<>|\x00-\x1f]/.test(filename) ||
    /[. ]$/.test(filename) ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new TypeError('Invalid CurseForge filename');
  }
  return filename;
}

function forgeCdnUrl(fileId: number, filename: string): string {
  const id = String(fileId);
  const group = id.slice(0, -3) || '0';
  const tail = id.slice(-3).padStart(3, '0');
  return `https://edge.forgecdn.net/files/${group}/${tail}/${encodeURIComponent(filename)}`;
}

async function responseJson(response: Response): Promise<unknown> {
  const textValue = await readBoundedResponse(
    response,
    2 * 1024 * 1024,
    'CurseForge response is too large',
  );
  return JSON.parse(textValue) as unknown;
}

export interface CurseForgeModpackInstallerOptions {
  readonly apiBaseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly createId?: () => string;
}

export class CurseForgeModpackInstaller {
  readonly #apiBase: URL;
  readonly #createId: () => string;
  readonly #fetch: typeof fetch;
  readonly #instancesRoot: string;

  constructor(instancesRoot: string, options: CurseForgeModpackInstallerOptions = {}) {
    if (!isAbsolute(instancesRoot)) {
      throw new TypeError('Instances root must be absolute');
    }
    this.#instancesRoot = resolve(instancesRoot);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#createId = options.createId ?? (() => randomUUID().replaceAll('-', '').slice(0, 12));
    this.#apiBase = new URL(options.apiBaseUrl ?? 'https://api.battlylauncher.com/curseforge/');
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(this.#apiBase.hostname);
    if (
      this.#apiBase.username ||
      this.#apiBase.password ||
      (this.#apiBase.protocol !== 'https:' && !(this.#apiBase.protocol === 'http:' && loopback))
    ) {
      throw new TypeError('CurseForge API base URL must use HTTPS');
    }
  }

  async install(
    archivePath: string,
    signal?: AbortSignal,
    onProgress?: ModpackInstallProgressSink,
    onMetadata?: (instance: InstanceSummary) => Promise<void>,
  ): Promise<InstanceSummary> {
    onProgress?.({
      phase: 'reading',
      current: 0,
      total: 1,
      item: basename(archivePath),
      message: 'Leyendo manifest.json…',
    });
    if (!isAbsolute(archivePath) || !archivePath.toLowerCase().endsWith('.zip')) {
      throw new TypeError('Invalid CurseForge archive path');
    }
    const archiveInfo = await lstat(archivePath);
    if (
      !archiveInfo.isFile() ||
      archiveInfo.isSymbolicLink() ||
      archiveInfo.size > maximumArchiveBytes
    ) {
      throw new TypeError('Invalid CurseForge archive');
    }
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    if (entries.length > maximumEntries) {
      throw new TypeError('CurseForge entry limit exceeded');
    }
    let extractedBytes = 0;
    for (const entry of entries) {
      if (isSymbolicLink(entry)) {
        throw new TypeError('CurseForge symbolic links are not supported');
      }
      extractedBytes += entry.header.size;
      if (extractedBytes > maximumExtractedBytes) {
        throw new TypeError('CurseForge size limit exceeded');
      }
    }
    const manifestLocation = findManifestEntry(entries);
    if (!manifestLocation || manifestLocation.entry.header.size > 2 * 1024 * 1024) {
      throw new TypeError('CurseForge pack has no valid manifest.json');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestLocation.entry.getData().toString('utf8')) as unknown;
    } catch {
      throw new TypeError('CurseForge manifest is not valid JSON');
    }
    const pack = manifest(parsed);
    onProgress?.({
      phase: 'reading',
      current: 1,
      total: 1,
      item: pack.name,
      message: `Manifiesto leído: ${pack.name}`,
    });
    const id = this.#createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
      throw new TypeError('Invalid instance id');
    }
    await mkdir(this.#instancesRoot, { recursive: true });
    const staging = join(this.#instancesRoot, `.installing-${id}`);
    const target = join(this.#instancesRoot, id);
    await mkdir(staging);
    try {
      const overridePrefix = `${manifestLocation.rootPrefix}${pack.overrides}/`;
      const iconDataUrl = packIconDataUrl(entries, overridePrefix);
      const draft = normalizeInstanceDraft({
        name: pack.name,
        description: [pack.author && `Por ${pack.author}`, pack.version]
          .filter(Boolean)
          .join(' · '),
        version: pack.minecraftVersion,
        loader: pack.loader,
        loaderVersion: pack.loaderVersion,
        ...(iconDataUrl ? { iconDataUrl } : {}),
      });
      await onMetadata?.({ ...draft, id });
      const overrideEntries = entries.filter(
        (entry) =>
          !entry.isDirectory &&
          entry.entryName.toLowerCase().startsWith(overridePrefix.toLowerCase()),
      );
      let extracted = 0;
      let lastReported = 0;
      const totalOverrides = Math.max(1, overrideEntries.length);
      const reportEvery = Math.max(1, Math.ceil(totalOverrides / 100));
      const queue = [...overrideEntries];
      const workers = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
        while (queue.length) {
          if (signal?.aborted) {
            throw signal.reason;
          }
          const entry = queue.shift();
          if (!entry) {
            return;
          }
          const relativePath = entry.entryName.slice(overridePrefix.length);
          const destination = safeDestination(staging, relativePath);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, entry.getData());
          extracted += 1;
          if (
            extracted === totalOverrides ||
            extracted === 1 ||
            extracted - lastReported >= reportEvery
          ) {
            lastReported = extracted;
            onProgress?.({
              phase: 'extracting',
              current: extracted,
              total: totalOverrides,
              item: relativePath,
              message: `Extrayendo archivos (${extracted}/${totalOverrides})`,
            });
          }
        }
      });
      await Promise.all(workers);
      await this.#downloadFiles(pack.files, staging, signal, onProgress);
      await writeFileAtomically(
        join(staging, 'instance.json'),
        `${JSON.stringify(
          {
            ...draft,
            iconDataUrl: undefined,
            curseforge: { manifestType: 'minecraftModpack', files: pack.files },
          },
          null,
          2,
        )}\n`,
      );
      if (iconDataUrl) {
        await writeFileAtomically(
          join(staging, 'icon.png'),
          Buffer.from(iconDataUrl.slice(iconDataUrl.indexOf(',') + 1), 'base64'),
        );
      }
      onProgress?.({
        phase: 'writing',
        current: 1,
        total: 1,
        item: 'instance.json',
        message: 'Guardando la instancia…',
      });
      await rename(staging, target);
      onProgress?.({
        phase: 'complete',
        current: 1,
        total: 1,
        item: pack.name,
        message: `${pack.name} instalado correctamente`,
      });
      return { id, ...draft };
    } catch (error) {
      await rm(staging, {
        recursive: true,
        force: true,
        maxRetries: 30,
        retryDelay: 250,
      }).catch(() => undefined);
      throw error;
    }
  }

  async #downloadFiles(
    files: readonly CurseForgeFileReference[],
    root: string,
    signal?: AbortSignal,
    onProgress?: ModpackInstallProgressSink,
  ): Promise<void> {
    const queue = [...files];
    let completed = 0;
    const destinations = new Set<string>();
    let firstError: unknown;
    const workers = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
      while (queue.length && firstError === undefined) {
        const reference = queue.shift();
        if (!reference) {
          return;
        }
        try {
          let metadata: CurseForgeDownload | undefined;
          let metadataError: unknown;
          for (let attempt = 0; attempt < 3 && !metadata; attempt += 1) {
            try {
              metadata = await this.#fileMetadata(reference, signal);
            } catch (error) {
              metadataError = error;
              if (error instanceof TypeError || signal?.aborted) {
                break;
              }
              if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
              }
            }
          }
          if (!metadata) {
            throw metadataError instanceof Error
              ? metadataError
              : new Error('Sin metadatos de CurseForge');
          }
          const destination = safeDestination(root, `mods/${metadata.filename}`);
          const key = metadata.filename.toLowerCase();
          if (destinations.has(key)) {
            throw new Error('Duplicate CurseForge destination');
          }
          destinations.add(key);
          let downloadError: unknown;
          let downloaded = false;
          for (let attempt = 0; attempt < 3 && !downloaded; attempt += 1) {
            try {
              await this.#download(metadata, destination, signal);
              downloaded = true;
            } catch (error) {
              downloadError = error;
              if (error instanceof TypeError || signal?.aborted) {
                break;
              }
              if (attempt < 2) {
                onProgress?.({
                  phase: 'downloading-files',
                  current: completed,
                  total: Math.max(1, files.length),
                  item: metadata.filename,
                  message: `Reintentando ${metadata.filename} (${attempt + 2}/3)`,
                });
                await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
              }
            }
          }
          if (!downloaded) {
            throw downloadError instanceof Error
              ? downloadError
              : new Error(`No se pudo descargar ${metadata.filename}`);
          }
          completed += 1;
          onProgress?.({
            phase: 'downloading-files',
            current: completed,
            total: Math.max(1, files.length),
            item: metadata.filename,
            message: `Descargando ${metadata.filename}`,
          });
        } catch (error) {
          firstError ??= error;
        }
      }
    });
    await Promise.all(workers);
    if (firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error('No se pudo descargar un archivo del ModPack');
    }
  }

  async #fileMetadata(
    reference: CurseForgeFileReference,
    signal?: AbortSignal,
  ): Promise<CurseForgeDownload> {
    const response = await this.#fetch(
      new URL(`mod/${reference.projectId}/file/${reference.fileId}`, this.#apiBase),
      {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`CurseForge metadata failed (${response.status})`);
    }
    const envelope = objectValue(await responseJson(response), 'metadata response');
    const wrapped = objectValue(own(envelope, 'data'), 'metadata data');
    const file = objectValue(own(wrapped, 'data') ?? wrapped, 'file metadata');
    if (own(file, 'id') !== reference.fileId || own(file, 'modId') !== reference.projectId) {
      throw new TypeError('CurseForge file identity mismatch');
    }
    const size = positiveInteger(own(file, 'fileLength'), 'file size');
    if (size > maximumDownloadBytes) {
      throw new TypeError('CurseForge file is too large');
    }
    const hashes = own(file, 'hashes');
    if (!Array.isArray(hashes) || hashes.length > 16) {
      throw new TypeError('Missing CurseForge SHA-1');
    }
    const sha1Entries = hashes
      .map((item) => objectValue(item, 'hash'))
      .filter((item) => own(item, 'algo') === 1);
    if (sha1Entries.length !== 1) {
      throw new TypeError('Missing or ambiguous CurseForge SHA-1');
    }
    const sha1 = own(sha1Entries[0], 'value');
    if (typeof sha1 !== 'string' || !/^[a-f0-9]{40}$/i.test(sha1)) {
      throw new TypeError('Invalid CurseForge SHA-1');
    }
    const filename = safeFilename(own(file, 'fileName'));
    let urlValue = own(file, 'downloadUrl');
    if (typeof urlValue !== 'string' || !urlValue) {
      // CurseForge deliberately returns null for some third-party files even though its CDN
      // artifact is public. The legacy Battly importer silently skipped those files, leaving
      // broken packs. Resolve the canonical ForgeCDN path from the file id and safe filename.
      urlValue = forgeCdnUrl(reference.fileId, filename);
    }
    return { filename, url: safeDownloadUrl(urlValue), sha1: sha1.toLowerCase(), size };
  }

  async #download(
    metadata: CurseForgeDownload,
    destination: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.#fetch(safeDownloadUrl(metadata.url), {
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`CurseForge download failed (${response.status})`);
    }
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== metadata.size) {
      await response.body.cancel();
      throw new TypeError('CurseForge file size mismatch');
    }
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.battly-download`;
    const handle = await open(temporary, 'wx');
    let bytes = 0;
    const digest = createHash('sha1');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > metadata.size) {
          await reader.cancel();
          throw new Error('CurseForge file is too large');
        }
        digest.update(value);
        await handle.writeFile(value);
      }
      if (bytes !== metadata.size || digest.digest('hex') !== metadata.sha1) {
        throw new TypeError('CurseForge file integrity mismatch');
      }
      await handle.sync();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      await handle.close();
      await rm(temporary, { force: true });
      throw error;
    } finally {
      reader.releaseLock();
    }
    await handle.close();
    await rename(temporary, destination);
  }
}
