import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  bypackLimits,
  bypackPath,
  bypackDownloadUrl,
  excludeFromBypack,
  parseBypack,
  portableInstance,
  type BypackExportResult,
  type BypackFile,
  type BypackManifest,
  type BypackPreview,
} from '../../shared/minecraft/bypack';
import type { InstanceDraft, InstanceSummary } from '../../shared/minecraft/instance';
import type { ModpackInstallProgressSink } from '../../shared/mods/modpack-install-contract';
import { pathExists, readBoundedRegularFile, writeExclusiveAndSync } from '../files/atomic-file';
import { VerifiedDownloader } from '../mods/verified-download';
import type { InstanceStore } from './instance-store';
import { readIconDataUrl } from './instance-store';
import {
  copyHashed,
  createReadStream,
  openBypackZip,
  writeBypackZip,
  writePackZip,
  zipEntryStream,
  zipManifest,
} from './bypack-archive';
import {
  BypackSources,
  type BypackCandidate,
  type BypackSourceOptions,
  type CurseForgeReference,
} from './bypack-sources';

const modrinthRoots = new Set([
  'mods',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'resourcepacks',
  'shaderpacks',
  'texturepacks',
  'datapacks',
]);

function modrinthDependencies(instance: InstanceDraft): Record<string, string> {
  const loader = instance.loader?.toLowerCase();
  const dependencies = { minecraft: instance.version };
  if (!loader || loader === 'vanilla') {
    return dependencies;
  }
  const dependency = Object.entries({
    forge: 'forge',
    neoforge: 'neoforge',
    fabric: 'fabric-loader',
    quilt: 'quilt-loader',
  }).find(([key]) => key === loader)?.[1];
  const version = instance.loaderVersion;
  if (!dependency || !version || /^(latest|recommended|auto|automatic)$/i.test(version)) {
    throw new Error(
      'Para exportar a .mrpack, elige Vanilla o una versión concreta de Forge, NeoForge, Fabric o Quilt.',
    );
  }
  const prefix = `${instance.version}-`;
  return {
    ...dependencies,
    [dependency]:
      (loader === 'forge' || loader === 'neoforge') && version.startsWith(prefix)
        ? version.slice(prefix.length)
        : version,
  };
}

function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    Boolean(fromRoot) &&
    !isAbsolute(fromRoot) &&
    fromRoot !== '..' &&
    !fromRoot.startsWith(`..${sep}`)
  );
}
async function realDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('La instancia debe usar una carpeta real');
  }
}
async function removeStaging(path: string, parent: string): Promise<void> {
  if (
    dirname(resolve(path)) !== resolve(parent) ||
    !/^\.bypack-|^battly-bypack-/.test(basename(path))
  ) {
    throw new Error('Ruta temporal inválida');
  }
  await rm(path, { recursive: true, force: true });
}
function curseForgeReferences(value: unknown): CurseForgeReference[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const data = value as Record<string, unknown>;
  const result: CurseForgeReference[] = [];
  for (const candidate of [data.files, data.installedAddons]) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const raw of candidate.slice(0, 2000) as unknown[]) {
      if (!raw || typeof raw !== 'object') {
        continue;
      }
      const file = raw as Record<string, unknown>;
      const installed =
        file.installedFile && typeof file.installedFile === 'object'
          ? (file.installedFile as Record<string, unknown>)
          : {};
      const projectId = file.projectId ?? file.projectID ?? file.id;
      const fileId = file.fileId ?? file.fileID ?? installed.id;
      if (
        Number.isSafeInteger(projectId) &&
        Number(projectId) > 0 &&
        Number.isSafeInteger(fileId) &&
        Number(fileId) > 0
      ) {
        result.push({ projectId: Number(projectId), fileId: Number(fileId) });
      }
    }
  }
  return result;
}

export class BypackService {
  readonly #sources: BypackSources;
  constructor(
    private readonly store: Pick<InstanceStore, 'directoryPathInternal' | 'readInternal'>,
    private readonly instancesRoot: string,
    private readonly options: BypackSourceOptions & {
      readonly assertEditable?: (path: string) => void;
      readonly includePath?: (path: string, directory: boolean) => boolean;
    } = {},
  ) {
    if (!isAbsolute(instancesRoot)) {
      throw new Error('La ruta de instancias debe ser absoluta');
    }
    this.#sources = new BypackSources(options);
  }

  async export(
    id: string,
    destination: string,
    progress?: ModpackInstallProgressSink,
    author?: string,
  ): Promise<BypackExportResult> {
    return this.#export(id, destination, 'bypack', progress, author);
  }

  async exportMrpack(
    id: string,
    destination: string,
    progress?: ModpackInstallProgressSink,
  ): Promise<BypackExportResult> {
    return this.#export(id, destination, 'mrpack', progress);
  }

  async #export(
    id: string,
    destination: string,
    format: 'bypack' | 'mrpack',
    progress?: ModpackInstallProgressSink,
    author?: string,
  ): Promise<BypackExportResult> {
    if (!isAbsolute(destination) || !destination.toLowerCase().endsWith(`.${format}`)) {
      throw new Error('El destino del paquete no es válido.');
    }
    const root = await this.store.directoryPathInternal(id);
    this.options.assertEditable?.(root);
    const canonicalRoot = await realpath(root);
    const destinationParent = await realpath(dirname(destination));
    if (destinationParent === canonicalRoot || inside(canonicalRoot, destinationParent)) {
      throw new Error('Guarda el paquete fuera de la carpeta de la instancia.');
    }
    const metadata = await this.store.readInternal(id);
    const iconDataUrl = format === 'bypack' ? await readIconDataUrl(root) : null;
    const instance = portableInstance({ ...metadata, ...(iconDataUrl ? { iconDataUrl } : {}) });
    const dependencies = format === 'mrpack' ? modrinthDependencies(instance) : undefined;
    const staging = await mkdtemp(join(tmpdir(), 'battly-bypack-'));
    const pending = join(dirname(destination), `.bypack-${randomUUID()}.tmp`);
    let pendingCreated = false;
    const files: BypackCandidate[] = [];
    const directories: string[] = [];
    let total = 0;
    try {
      const snapshot = async (directory: string, prefix = ''): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (
            excludeFromBypack(path, entry.isDirectory()) ||
            (dependencies && !modrinthRoots.has(path.split('/')[0].toLowerCase())) ||
            (this.options.includePath && !this.options.includePath(path, entry.isDirectory()))
          ) {
            continue;
          }
          bypackPath(path);
          if (entry.isSymbolicLink()) {
            throw new Error(`No se puede exportar un enlace: ${path}`);
          }
          const source = join(directory, entry.name);
          if (!inside(canonicalRoot, await realpath(source))) {
            throw new Error('Un archivo apunta fuera de la instancia');
          }
          if (files.length + directories.length >= bypackLimits.entries) {
            throw new Error('Demasiados archivos en la instancia');
          }
          if (entry.isDirectory()) {
            directories.push(path);
            await mkdir(join(staging, path), { recursive: true });
            await snapshot(source, path);
          } else if (entry.isFile()) {
            const info = await lstat(source);
            if (!info.isFile() || info.isSymbolicLink() || info.size > bypackLimits.fileBytes) {
              throw new Error(`Archivo demasiado grande o inválido: ${path}`);
            }
            total += info.size;
            if (total > bypackLimits.totalBytes) {
              throw new Error('La instancia supera 16 GiB de contenido exportable');
            }
            progress?.({
              phase: 'reading',
              current: files.length,
              total: Math.max(1, files.length + 1),
              item: path.slice(0, 512),
              message: `Preparando ${path}`.slice(0, 512),
            });
            const hashes = await copyHashed(
              createReadStream(source),
              join(staging, path),
              info.size,
            );
            files.push({ path, absolutePath: join(staging, path), size: info.size, ...hashes });
          } else {
            throw new Error(`Archivo especial no exportable: ${path}`);
          }
        }
      };
      await snapshot(root);
      this.options.assertEditable?.(root);
      const references = dependencies ? [] : curseForgeReferences(metadata.curseforge);
      if (!dependencies) {
        try {
          references.push(
            ...curseForgeReferences(
              JSON.parse(
                (
                  await readBoundedRegularFile(join(root, 'minecraftinstance.json'), 8 * 1024 ** 2)
                ).toString('utf8'),
              ) as unknown,
            ),
          );
        } catch {
          /* Optional CurseForge provenance. */
        }
      }
      progress?.({
        phase: 'reading',
        current: 0,
        total: 1,
        item: instance.name,
        message: dependencies
          ? 'Identificando versiones exactas en Modrinth…'
          : 'Identificando versiones exactas en Modrinth y CurseForge…',
      });
      const candidates = files.filter(
        (file) =>
          /^(mods|resourcepacks|shaderpacks|texturepacks|datapacks)\//i.test(file.path) &&
          /\.(jar|zip)(\.(disabled|old))?$/i.test(file.path),
      );
      const { matches, warnings } = await this.#sources.identify(
        candidates,
        references,
        (message, current, total) =>
          progress?.({
            phase: 'reading',
            current,
            total: Math.max(1, total),
            item: instance.name,
            message: message.slice(0, 512),
          }),
        Boolean(dependencies),
      );
      const manifest: BypackManifest = parseBypack({
        format: 'battly-bypack',
        version: 1,
        instance,
        ...(author ? { author } : {}),
        directories,
        files: files.map((file) => ({
          path: file.path,
          size: file.size,
          sha512: file.sha512,
          ...(matches.has(file.path) ? { remote: matches.get(file.path) } : {}),
        })),
      });
      progress?.({
        phase: 'writing',
        current: 0,
        total: 1,
        item: basename(destination),
        message: dependencies
          ? 'Comprimiendo el paquete .mrpack…'
          : 'Comprimiendo .bypack al nivel máximo de ZIP…',
      });
      pendingCreated = true;
      if (dependencies) {
        await writePackZip(
          pending,
          'modrinth.index.json',
          {
            formatVersion: 1,
            game: 'minecraft',
            versionId: createHash('sha256')
              .update(JSON.stringify(manifest))
              .digest('hex')
              .slice(0, 24),
            name: instance.name,
            summary: instance.description,
            dependencies,
            files: files.flatMap((file) => {
              const remote = matches.get(file.path);
              return remote
                ? [
                    {
                      path: file.path,
                      hashes: { sha1: file.sha1, sha512: file.sha512 },
                      downloads: [remote.url],
                      fileSize: file.size,
                    },
                  ]
                : [];
            }),
          },
          files.filter((file) => !matches.has(file.path)).map((file) => file.path),
          (path) => join(staging, path),
        );
      } else {
        await writeBypackZip(pending, manifest, (path) => join(staging, path));
      }
      const archiveBytes = (await lstat(pending)).size;
      await rename(pending, destination);
      pendingCreated = false;
      const remote = manifest.files.filter((file) => file.remote);
      progress?.({
        phase: 'complete',
        current: 1,
        total: 1,
        item: instance.name,
        message: dependencies ? 'Paquete .mrpack exportado' : 'Paquete .bypack exportado',
      });
      return {
        path: destination,
        archiveBytes,
        sourceBytes: total,
        referencedBytes: remote.reduce((sum, file) => sum + file.size, 0),
        embeddedFiles: manifest.files.length - remote.length,
        modrinthFiles: remote.filter((file) => file.remote?.provider === 'modrinth').length,
        curseforgeFiles: remote.filter((file) => file.remote?.provider === 'curseforge').length,
        warnings,
      };
    } finally {
      if (pendingCreated) {
        await rm(pending, { force: true });
      }
      await removeStaging(staging, tmpdir());
    }
  }

  async inspect(path: string): Promise<Omit<BypackPreview, 'token'> & { manifestHash: string }> {
    if (!isAbsolute(path) || !path.toLowerCase().endsWith('.bypack')) {
      throw new Error('Archivo .bypack inválido');
    }
    const { zip, entries } = await openBypackZip(path);
    try {
      const entry = entries.get('bypack.json');
      if (!entry) {
        throw new Error('Falta bypack.json');
      }
      const manifest = parseBypack(await zipManifest(zip, entry));
      const embedded = manifest.files.filter((file) => !file.remote);
      if (
        entries.size !== embedded.length + 1 ||
        embedded.some(
          (file) => entries.get(`overrides/${file.path}`)?.uncompressedSize !== file.size,
        )
      ) {
        throw new Error('El contenido del ZIP no coincide con el manifiesto');
      }
      return {
        instance: manifest.instance,
        author: manifest.author ?? null,
        files: manifest.files.length,
        downloads: manifest.files.length - embedded.length,
        bytes: manifest.files.reduce((total, file) => total + file.size, 0),
        manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      };
    } finally {
      zip.close();
    }
  }

  async install(
    path: string,
    progress?: ModpackInstallProgressSink,
    expectedManifestHash?: string,
  ): Promise<InstanceSummary> {
    if (!isAbsolute(path) || !path.toLowerCase().endsWith('.bypack')) {
      throw new Error('Archivo .bypack inválido');
    }
    progress?.({
      phase: 'reading',
      current: 0,
      total: 1,
      item: basename(path),
      message: 'Comprobando el paquete .bypack…',
    });
    const { zip, entries } = await openBypackZip(path);
    let staging: string | undefined;
    try {
      const manifestEntry = entries.get('bypack.json');
      if (!manifestEntry) {
        throw new Error('Falta bypack.json');
      }
      const manifest = parseBypack(await zipManifest(zip, manifestEntry));
      if (
        expectedManifestHash &&
        createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== expectedManifestHash
      ) {
        throw new Error(
          'El paquete ha cambiado. Vuelve a abrirlo y revisa sus datos antes de instalarlo.',
        );
      }
      const embedded = manifest.files.filter((file) => !file.remote);
      if (entries.size !== embedded.length + 1) {
        throw new Error('El contenido del ZIP no coincide con el manifiesto');
      }
      for (const file of embedded) {
        if (entries.get(`overrides/${file.path}`)?.uncompressedSize !== file.size) {
          throw new Error(`Falta un archivo o su tamaño es incorrecto: ${file.path}`);
        }
      }
      await mkdir(this.instancesRoot, { recursive: true });
      await realDirectory(this.instancesRoot);
      const id = randomUUID().replaceAll('-', '').slice(0, 16);
      const target = join(this.instancesRoot, id);
      if (await pathExists(target)) {
        throw new Error('Ya existe esa instancia');
      }
      staging = await mkdtemp(join(this.instancesRoot, '.bypack-'));
      for (const directory of manifest.directories) {
        await mkdir(join(staging, directory), { recursive: true });
      }
      let extracted = 0;
      for (const file of embedded) {
        const destination = join(staging, file.path);
        await mkdir(dirname(destination), { recursive: true });
        const hashes = await copyHashed(
          await zipEntryStream(zip, entries.get(`overrides/${file.path}`)!),
          destination,
          file.size,
        );
        if (hashes.sha512 !== file.sha512) {
          throw new Error(`El archivo está dañado: ${file.path}`);
        }
        progress?.({
          phase: 'extracting',
          current: ++extracted,
          total: Math.max(1, embedded.length),
          item: file.path.slice(0, 512),
          message: `Restaurando ${file.path}`.slice(0, 512),
        });
      }
      await this.#download(
        manifest.files.filter((file) => file.remote),
        staging,
        progress,
      );
      const instance = portableInstance(manifest.instance);
      await writeExclusiveAndSync(
        join(staging, 'instance.json'),
        JSON.stringify(
          {
            ...instance,
            curseforge: {
              files: manifest.files
                .filter((f) => f.remote?.provider === 'curseforge')
                .map((f) => ({
                  projectId: Number(f.remote!.projectId),
                  fileId: Number(f.remote!.versionId),
                })),
            },
          },
          null,
          2,
        ),
      );
      await rename(staging, target);
      staging = undefined;
      progress?.({
        phase: 'complete',
        current: 1,
        total: 1,
        item: instance.name,
        message: `${instance.name} importada`,
      });
      return { id, ...instance };
    } finally {
      zip.close();
      if (staging) {
        await removeStaging(staging, this.instancesRoot);
      }
    }
  }

  async #download(
    files: readonly BypackFile[],
    root: string,
    progress?: ModpackInstallProgressSink,
  ): Promise<void> {
    const queue = [...files];
    let completed = 0;
    let failure: Error | undefined;
    await Promise.all(
      Array.from({ length: Math.min(4, files.length) }, async () => {
        while (queue.length && !failure) {
          const file = queue.shift()!;
          const remote = file.remote!;
          const downloader = new VerifiedDownloader({
            fetchImplementation: (input, init) => {
              const url = input instanceof Request ? input.url : String(input);
              bypackDownloadUrl(url, remote.provider);
              return (this.options.fetchImplementation ?? fetch)(input, init);
            },
          });
          try {
            for (let attempt = 0; ; attempt++) {
              try {
                await downloader.download(
                  { url: remote.url, expectedSize: file.size, expectedSha512: file.sha512 },
                  join(root, file.path),
                  AbortSignal.timeout(120_000),
                );
                break;
              } catch (error) {
                if (attempt >= 2) {
                  throw error;
                }
              }
            }
            progress?.({
              phase: 'downloading-files',
              current: ++completed,
              total: files.length,
              item: file.path.slice(0, 512),
              message: `Descargado y verificado: ${file.path}`.slice(0, 512),
            });
          } catch (error) {
            failure = new Error(
              `No se pudo descargar o verificar ${file.path}. La instancia no se ha importado.`,
              { cause: error },
            );
          }
        }
      }),
    );
    if (failure) {
      throw failure;
    }
  }
}
