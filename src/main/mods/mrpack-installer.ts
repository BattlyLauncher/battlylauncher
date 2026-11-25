import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';
import type { ServerModpackTarget } from './server-modpack-target';

import { normalizeInstanceDraft, type InstanceSummary } from '../../shared/minecraft/instance';
import type { ModpackInstallProgressSink } from '../../shared/mods/modpack-install-contract';
import { writeFileAtomically } from '../files/atomic-file';
import { VerifiedDownloader } from './verified-download';
import { validateMrpackDownloadUrl } from './mrpack-download-url';

const maximumArchiveBytes = 512 * 1024 * 1024;
const maximumEntries = 10_000;
const maximumExtractedBytes = 1024 * 1024 * 1024;

interface ManifestFile {
  readonly downloads: readonly string[];
  readonly path: string;
  readonly sha512: string;
  readonly size: number;
}

export interface MrpackInstallMetadata {
  readonly description?: string;
  readonly iconDataUrl?: string;
  readonly name?: string;
}

interface MrpackManifest {
  readonly description: string;
  readonly files: readonly ManifestFile[];
  readonly loader: string | null;
  readonly loaderVersion: string | null;
  readonly name: string;
  readonly version: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid mrpack ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function stringValue(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maximumLength) {
    throw new TypeError(`Invalid mrpack ${label}`);
  }
  return value;
}

function safeRelativePath(value: unknown): string {
  const path = stringValue(value, 'file path', 512).replaceAll('\\', '/');
  if (
    path.startsWith('/') ||
    /^[A-Za-z]:\//.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new TypeError('Mrpack contains an unsafe path');
  }
  return path;
}

function safeDestination(root: string, relativePath: string): string {
  const destination = resolve(root, ...relativePath.split('/'));
  const fromRoot = relative(root, destination);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new TypeError('Mrpack contains an unsafe path');
  }
  return destination;
}

function sha512(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{128}$/.test(value)) {
    throw new TypeError('Invalid mrpack sha512');
  }
  return value.toLowerCase();
}

function downloadUrl(value: unknown): string {
  const url = new URL(stringValue(value, 'download URL', 4096));
  validateMrpackDownloadUrl(url);
  return url.toString();
}

function manifest(value: unknown, server?: ServerModpackTarget): MrpackManifest {
  const source = objectValue(value, 'manifest');
  if (own(source, 'formatVersion') !== 1 || own(source, 'game') !== 'minecraft') {
    throw new TypeError('Unsupported mrpack format');
  }
  const dependencies = objectValue(own(source, 'dependencies'), 'dependencies');
  const minecraft = stringValue(own(dependencies, 'minecraft'), 'Minecraft version', 128);
  const loaders = [
    ['fabric-loader', 'fabric'],
    ['neoforge', 'neoforge'],
    ['forge', 'forge'],
    ['quilt-loader', 'quilt'],
  ] as const;
  const selectedLoader = loaders.find(([key]) => typeof own(dependencies, key) === 'string');
  const rawFiles = own(source, 'files');
  if (!Array.isArray(rawFiles) || rawFiles.length > maximumEntries) {
    throw new TypeError('Invalid mrpack files');
  }
  const files = rawFiles.flatMap((entry): ManifestFile[] => {
    const file = objectValue(entry, 'file');
    const environment = own(file, 'env');
    if (
      environment &&
      own(objectValue(environment, 'environment'), server ? 'server' : 'client') === 'unsupported'
    ) {
      return [];
    }
    const path = safeRelativePath(own(file, 'path'));
    if (server && !server.acceptPath(path)) {
      return [];
    }
    const hashes = objectValue(own(file, 'hashes'), 'hashes');
    const downloads = own(file, 'downloads');
    const size = own(file, 'fileSize');
    if (!Array.isArray(downloads) || downloads.length < 1 || downloads.length > 10) {
      throw new TypeError('Invalid mrpack downloads');
    }
    if (!Number.isSafeInteger(size) || Number(size) < 0 || Number(size) > maximumArchiveBytes) {
      throw new TypeError('Invalid mrpack file size');
    }
    return [
      {
        downloads: downloads.map(downloadUrl),
        path,
        sha512: sha512(own(hashes, 'sha512')),
        size: Number(size),
      },
    ];
  });
  return {
    name: stringValue(own(source, 'name'), 'name', 128),
    description:
      typeof own(source, 'summary') === 'string'
        ? String(own(source, 'summary')).slice(0, 1024)
        : '',
    version: minecraft,
    loader: selectedLoader?.[1] ?? null,
    loaderVersion: selectedLoader
      ? stringValue(own(dependencies, selectedLoader[0]), 'loader version', 128)
      : null,
    files,
  };
}

function isSymbolicLink(entry: AdmZip.IZipEntry): boolean {
  return ((entry.attr >>> 16) & 0o170000) === 0o120000;
}

async function discardStaging(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 });
    return;
  } catch {
    const quarantine = `${path}.cleanup-${Date.now()}`;
    try {
      await rename(path, quarantine);
      void rm(quarantine, { recursive: true, force: true, maxRetries: 30, retryDelay: 250 }).catch(
        () => undefined,
      );
    } catch {
      // Cleanup must never replace the installation error that explains the actual failure.
    }
  }
}

export class MrpackInstaller {
  readonly #createId: () => string;
  readonly #instancesRoot: string;
  readonly #downloader: VerifiedDownloader;

  constructor(
    instancesRoot: string,
    createId: () => string = () => randomUUID().replaceAll('-', '').slice(0, 12),
    fetchImplementation = fetch,
  ) {
    if (!isAbsolute(instancesRoot)) {
      throw new TypeError('Instances root must be absolute');
    }
    this.#instancesRoot = resolve(instancesRoot);
    this.#createId = createId;
    this.#downloader = new VerifiedDownloader({
      validateUrl: validateMrpackDownloadUrl,
      fetchImplementation,
    });
  }

  async install(
    archivePath: string,
    signal?: AbortSignal,
    onProgress?: ModpackInstallProgressSink,
    metadata: MrpackInstallMetadata = {},
    server?: ServerModpackTarget,
  ): Promise<InstanceSummary> {
    onProgress?.({
      phase: 'reading',
      current: 0,
      total: 1,
      item: archivePath.split(/[\\/]/).at(-1) ?? 'ModPack',
      message: 'Leyendo el manifiesto del ModPack…',
    });
    if (!isAbsolute(archivePath) || !archivePath.toLowerCase().endsWith('.mrpack')) {
      throw new TypeError('Invalid mrpack archive path');
    }
    const archiveInfo = await lstat(archivePath);
    if (
      !archiveInfo.isFile() ||
      archiveInfo.isSymbolicLink() ||
      archiveInfo.size > maximumArchiveBytes
    ) {
      throw new TypeError('Invalid mrpack archive');
    }
    const zip = new AdmZip(archivePath);
    const entries = zip.getEntries();
    if (entries.length > maximumEntries) {
      throw new TypeError('Mrpack entry limit exceeded');
    }
    let extractedBytes = 0;
    for (const entry of entries) {
      if (isSymbolicLink(entry)) {
        throw new TypeError('Mrpack symbolic links are not supported');
      }
      extractedBytes += entry.header.size;
      if (extractedBytes > maximumExtractedBytes) {
        throw new TypeError('Mrpack size limit exceeded');
      }
    }
    const indexEntry = zip.getEntry('modrinth.index.json');
    if (!indexEntry || indexEntry.header.size > 2 * 1024 * 1024) {
      throw new TypeError('Mrpack has no valid manifest');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(indexEntry.getData().toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Mrpack manifest is not valid JSON');
    }
    const pack = manifest(parsed, server);
    onProgress?.({
      phase: 'reading',
      current: 1,
      total: 1,
      item: pack.name,
      message: `Manifiesto leído: ${pack.name}`,
    });
    const id = this.#createId();
    await server?.checkMetadata({ ...normalizeInstanceDraft(pack), id });
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
      throw new TypeError('Mrpack instance id is invalid');
    }
    await mkdir(this.#instancesRoot, { recursive: true });
    const sideOverrides = server ? 'server-overrides/' : 'client-overrides/';
    const overrideEntries = entries.filter(
      (entry) =>
        !entry.isDirectory &&
        (entry.entryName.startsWith('overrides/') || entry.entryName.startsWith(sideOverrides)) &&
        (!server ||
          server.acceptPath(
            safeRelativePath(entry.entryName.slice(entry.entryName.indexOf('/') + 1)),
          )),
    );
    const downloadBytes = pack.files.reduce((total, file) => total + file.size, 0);
    const overrideBytes = overrideEntries.reduce((total, entry) => total + entry.header.size, 0);
    const space = await statfs(this.#instancesRoot, { bigint: true }).catch(() => null);
    const diskFull = () =>
      new Error('No queda espacio suficiente en el disco. Libera espacio y vuelve a intentarlo.');
    if (space && space.bavail * space.bsize < BigInt(downloadBytes + overrideBytes)) {
      throw diskFull();
    }
    signal?.throwIfAborted();
    const staging = join(this.#instancesRoot, `.installing-${id}`);
    const target = join(this.#instancesRoot, id);
    await mkdir(staging);
    try {
      const extractOverrides = async (): Promise<void> => {
        let extracted = 0;
        for (const prefix of ['overrides/', sideOverrides]) {
          for (const entry of overrideEntries) {
            if (!entry.entryName.startsWith(prefix)) {
              continue;
            }
            signal?.throwIfAborted();
            const relativePath = safeRelativePath(entry.entryName.slice(prefix.length));
            const destination = safeDestination(staging, relativePath);
            await mkdir(resolve(destination, '..'), { recursive: true });
            await writeFile(destination, entry.getData());
            extracted += 1;
            onProgress?.({
              phase: 'extracting',
              current: extracted,
              total: Math.max(1, overrideEntries.length),
              item: relativePath,
              message: `Extrayendo ${relativePath}`,
            });
          }
        }
      };
      if (!server) {
        await extractOverrides();
      }
      const totalDownloadBytes = Math.max(1, downloadBytes);
      let completedDownloadBytes = 0;
      for (const file of pack.files) {
        let lastPercent = -1;
        let lastError: unknown;
        let downloaded = false;
        for (let round = 0; round < 3 && !downloaded; round += 1) {
          for (const url of file.downloads) {
            try {
              const timeout = AbortSignal.timeout(45_000);
              const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
              await this.#downloader.download(
                { url, expectedSize: file.size, expectedSha512: file.sha512 },
                safeDestination(staging, file.path),
                downloadSignal,
                (current) => {
                  const overall = Math.min(totalDownloadBytes, completedDownloadBytes + current);
                  const percent = Math.floor((overall / totalDownloadBytes) * 100);
                  if (percent === lastPercent && current < file.size) {
                    return;
                  }
                  lastPercent = percent;
                  onProgress?.({
                    phase: 'downloading-files',
                    current: overall,
                    total: totalDownloadBytes,
                    item: file.path,
                    message:
                      round === 0
                        ? `Descargando ${file.path}`
                        : `Reintentando ${file.path} (${round + 1}/3)`,
                  });
                },
              );
              downloaded = true;
              break;
            } catch (error) {
              signal?.throwIfAborted();
              if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC') {
                throw error;
              }
              lastError = error;
            }
          }
        }
        if (!downloaded) {
          throw new Error(`No se pudo descargar ${file.path} tras probar todas sus URLs`, {
            cause: lastError,
          });
        }
        completedDownloadBytes += file.size;
      }
      if (server) {
        await extractOverrides();
      }
      const draft = normalizeInstanceDraft({
        ...pack,
        ...(metadata.name?.trim() ? { name: metadata.name.trim() } : {}),
        ...(metadata.description?.trim() ? { description: metadata.description.trim() } : {}),
        ...(metadata.iconDataUrl ? { iconDataUrl: metadata.iconDataUrl } : {}),
      });
      onProgress?.({
        phase: 'writing',
        current: 0,
        total: 1,
        item: 'instance.json',
        message: 'Guardando la instancia…',
      });
      await writeFileAtomically(
        join(staging, 'instance.json'),
        `${JSON.stringify(
          {
            ...draft,
            iconDataUrl: undefined,
            modrinth: { formatVersion: 1 },
          },
          null,
          2,
        )}\n`,
      );
      if (draft.iconDataUrl) {
        await writeFileAtomically(
          join(staging, 'icon.png'),
          Buffer.from(draft.iconDataUrl.slice(draft.iconDataUrl.indexOf(',') + 1), 'base64'),
        );
      }
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
      await discardStaging(staging);
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOSPC') {
        throw diskFull();
      }
      throw error;
    }
  }
}
