import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  curseForgeProjectId,
  type ModInstallRequest,
  type ModProjectDetail,
  type ModProjectSummary,
  type ModProjectType,
  type ModSearchRequest,
  type ModSearchResult,
} from '../../shared/mods/mod-contract';
import { readBoundedResponse } from '../network/read-bounded-response';
import { acquireModInstallLock } from './mod-install-lock';
import { VerifiedDownloader } from './verified-download';

const loaderIds = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 } as const;
const classes: Record<ModProjectType, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945,
};
const catalogCategories = new Map([
  ['optimization', 6814],
  ['utility', 5191],
  ['technology', 412],
  ['magic', 419],
  ['adventure', 422],
  ['decoration', 424],
  ['worldgen', 406],
]);
const directories: Record<Exclude<ModProjectType, 'modpack'>, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
};
const versionPattern = /^\d[\w.+-]{0,79}$/;
const maximumFileBytes = 512 * 1024 ** 2;
const pageSize = 50;
const unavailableCatalog = 'No se pudo consultar el catálogo de CurseForge. Inténtalo de nuevo.';
const unverifiedFile = 'No se pudo verificar el archivo de CurseForge.';
const incompatibleFile = 'No hay una versión de CurseForge compatible con esta instalación.';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function httpsUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value, 4096));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function validateCdn(url: URL): void {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !['edge.forgecdn.net', 'media.forgecdn.net', 'mediafilez.forgecdn.net'].includes(url.hostname)
  ) {
    throw new Error(unverifiedFile);
  }
}

function typeFor(project: Record<string, unknown>): ModProjectType | undefined {
  return (Object.keys(classes) as ModProjectType[]).find(
    (type) => classes[type] === project.classId,
  );
}

function versionCatalogFromFiles(files: unknown, type: ModProjectType | undefined) {
  return list(files)
    .slice(0, 1000)
    .flatMap((raw) => {
      const file = record(raw);
      const id = integer(file.id);
      const tags = list(file.gameVersions).map((tag) => text(tag));
      const gameVersions = tags.filter((tag) => versionPattern.test(tag));
      const loaders =
        type === 'mod' || type === 'modpack'
          ? tags.map((tag) => tag.toLowerCase()).filter((tag) => Object.hasOwn(loaderIds, tag))
          : [type === 'datapack' ? 'datapack' : 'minecraft'];
      return id && gameVersions.length && loaders.length && file.isServerPack !== true
        ? [{ id: String(id), gameVersions, loaders }]
        : [];
    });
}

function indexes(project: Record<string, unknown>) {
  const type = typeFor(project);
  const indexed = list(project.latestFilesIndexes)
    .slice(0, 1000)
    .flatMap((value) => {
      const entry = record(value);
      const id = integer(entry.fileId);
      const gameVersion = text(entry.gameVersion);
      const loader =
        type === 'mod' || type === 'modpack'
          ? Object.entries(loaderIds).find(([, code]) => code === entry.modLoader)?.[0]
          : type === 'datapack'
            ? 'datapack'
            : 'minecraft';
      return id && loader && versionPattern.test(gameVersion)
        ? [{ id: String(id), gameVersions: [gameVersion], loaders: [loader] }]
        : [];
    });
  return [...indexed, ...versionCatalogFromFiles(project.latestFiles, type)];
}

function projectSummary(raw: unknown): ModProjectSummary[] {
  const project = record(raw);
  const id = integer(project.id);
  const title = text(project.name, 200);
  const projectType = typeFor(project);
  if (!id || !title || project.gameId !== 432 || !projectType) {
    return [];
  }
  const catalog = indexes(project);
  const logo = record(project.logo);
  return [
    {
      id: `curseforge-${id}`,
      title,
      projectType,
      description: text(project.summary),
      author: text(record(list(project.authors)[0]).name, 100),
      downloads: integer(project.downloadCount),
      follows: 0,
      iconUrl: httpsUrl(logo.thumbnailUrl) ?? httpsUrl(logo.url),
      gameVersions: [...new Set(catalog.flatMap((entry) => entry.gameVersions))],
      categories: [
        ...new Set([
          ...catalog.flatMap((entry) => entry.loaders),
          ...list(project.categories)
            .slice(0, 6)
            .map((value) => text(record(value).name, 80))
            .filter(Boolean),
        ]),
      ],
      latestVersionId: catalog[0]?.id ?? '',
    },
  ];
}

function compatibleFile(value: unknown, id: string, request: ModInstallRequest) {
  const file = record(value);
  const tags = list(file.gameVersions);
  const filename = text(file.fileName, 260);
  const size = integer(file.fileLength);
  const fileId = integer(file.id);
  const loaderRequired = request.projectType === 'mod' || request.projectType === 'modpack';
  if (
    file.modId !== Number(id) ||
    file.gameId !== 432 ||
    !fileId ||
    file.isAvailable === false ||
    file.isServerPack === true ||
    filename.length > 255 ||
    // eslint-disable-next-line no-control-regex -- Downloaded filenames cannot contain C0 controls.
    !/^[^<>:"/\\|?*\u0000-\u001f]+\.(jar|zip)$/i.test(filename) ||
    !filename.toLowerCase().endsWith(request.projectType === 'mod' ? '.jar' : '.zip') ||
    /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\./i.test(filename) ||
    !size ||
    size > maximumFileBytes ||
    !tags.includes(request.gameVersion) ||
    (loaderRequired &&
      !tags.some((tag) => typeof tag === 'string' && tag.toLowerCase() === request.loader))
  ) {
    return null;
  }
  const required = list(file.dependencies)
    .map(record)
    .filter((item) => item.relationType === 3)
    .map((item) => integer(item.modId))
    .filter(Boolean);
  return { fileId, filename, size, file, required };
}

export class CurseForgeCatalog {
  readonly #base: URL;

  constructor(
    base = 'https://api.battlylauncher.com/curseforge/',
    private readonly fetcher = fetch,
  ) {
    this.#base = new URL(base);
    if (
      this.#base.username ||
      this.#base.password ||
      (this.#base.protocol !== 'https:' &&
        !(
          this.#base.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(this.#base.hostname)
        ))
    ) {
      throw new TypeError(unavailableCatalog);
    }
  }

  async #get(path: string, params: Record<string, string> = {}, signal?: AbortSignal) {
    const url = new URL(path, this.#base);
    url.search = new URLSearchParams(params).toString();
    const timeout = AbortSignal.timeout(12_000);
    const response = await this.fetcher(url, {
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(unavailableCatalog);
    }
    const envelope = record(
      JSON.parse(
        await readBoundedResponse(
          response,
          4 * 1024 ** 2,
          'CurseForge response exceeds size limit',
        ),
      ),
    );
    return record(envelope.data);
  }

  async search(request: ModSearchRequest): Promise<ModSearchResult> {
    const limit = Math.min(request.limit, pageSize, 10_000 - request.offset);
    const context = { offset: request.offset, limit: request.limit };
    if (limit < 1) {
      return { ...context, total: 10_000, projects: [] };
    }
    const sorts = { relevance: '1', downloads: '6', follows: '2', updated: '3' };
    const categoryId = request.category ? catalogCategories.get(request.category) : undefined;
    const result = await this.#get('search', {
      searchFilter: request.query,
      sortField: sorts[request.sort],
      index: String(request.offset),
      pageSize: String(limit),
      ...(request.projectType ? { classId: String(classes[request.projectType]) } : {}),
      ...(categoryId ? { categoryId: String(categoryId) } : {}),
      ...this.#filters(request.gameVersions, request.loader ?? ''),
    });
    return {
      ...context,
      total: Math.min(10_000, integer(record(result.pagination).totalCount)),
      projects: list(result.data)
        .slice(0, limit)
        .flatMap(projectSummary)
        .filter((entry) => !request.projectType || entry.projectType === request.projectType),
    };
  }

  #filters(gameVersions: readonly string[], loader: string): Record<string, string> {
    const code = Object.entries(loaderIds).find(([name]) => name === loader)?.[1];
    return {
      ...(gameVersions.length === 1 ? { gameVersion: gameVersions[0] } : {}),
      ...(gameVersions.length > 1 ? { gameVersions: JSON.stringify(gameVersions) } : {}),
      ...(code ? { modLoaderType: String(code) } : {}),
    };
  }

  async #project(id: string, signal?: AbortSignal) {
    const value = record((await this.#get(`mod/${id}`, {}, signal)).data);
    if (value.id !== Number(id) || !projectSummary(value).length) {
      throw new Error(unavailableCatalog);
    }
    return value;
  }

  async versions(id: string) {
    const project = await this.#project(id);
    const catalog = indexes(project);
    if (list(project.latestFilesIndexes).length) {
      return catalog;
    }
    const files = await this.#get(`mod/${id}/files`, { pageSize: String(pageSize) });
    return [...catalog, ...versionCatalogFromFiles(files.data, typeFor(project))];
  }

  async projectUrl(id: string) {
    const project = await this.#project(id);
    const slug = text(project.slug, 128);
    const type = typeFor(project);
    if (!/^[a-z0-9-]+$/.test(slug) || !type) {
      throw new Error(unavailableCatalog);
    }
    const sections: Record<ModProjectType, string> = {
      mod: 'mc-mods',
      modpack: 'modpacks',
      resourcepack: 'texture-packs',
      shader: 'shaders',
      datapack: 'data-packs',
    };
    return `https://www.curseforge.com/minecraft/${sections[type]}/${slug}`;
  }

  async #files(id: string, request: ModInstallRequest, signal?: AbortSignal) {
    const value = await this.#get(
      `mod/${id}/files`,
      {
        pageSize: String(pageSize),
        ...this.#filters([request.gameVersion], request.loader),
      },
      signal,
    );
    return list(value.data)
      .slice(0, pageSize)
      .flatMap((entry) => compatibleFile(entry, id, request) ?? [])
      .sort((a, b) => text(b.file.fileDate).localeCompare(text(a.file.fileDate)));
  }

  async detail(id: string, request: ModInstallRequest): Promise<ModProjectDetail> {
    const [project, files, description] = await Promise.all([
      this.#project(id),
      this.#files(id, request),
      this.#get(`mod/${id}/description`)
        .then((result) => text(result.data, 300_000))
        .catch(() => ''),
    ]);
    const summary = projectSummary(project)[0];
    const links = record(project.links);
    const changelogs = new Map(
      await Promise.all(
        files.slice(0, 3).map(
          async ({ fileId }) =>
            [
              fileId,
              await this.#get(`mod/${id}/changelog/${fileId}`)
                .then((value) => text(value.data, 80_000))
                .catch(() => ''),
            ] as const,
        ),
      ),
    );
    const relations = new Map([
      [1, 'embedded'],
      [2, 'optional'],
      [3, 'required'],
      [5, 'incompatible'],
    ] as const);
    return {
      body: description || summary.description,
      categories: summary.categories,
      creators: list(project.authors)
        .slice(0, 30)
        .map(record)
        .map((author) => ({
          avatarUrl: null,
          name: text(author.name, 100),
          role: '',
          username: text(author.name, 100),
        })),
      downloads: summary.downloads,
      followers: 0,
      discordUrl: null,
      gallery: list(project.screenshots)
        .slice(0, 40)
        .flatMap((value) => {
          const image = record(value);
          const url = httpsUrl(image.url) ?? httpsUrl(image.thumbnailUrl);
          return url
            ? [{ url, title: text(image.title), description: text(image.description), created: '' }]
            : [];
        }),
      gameVersion: request.gameVersion,
      loader: request.loader,
      loaders: [...new Set(indexes(project).flatMap((entry) => entry.loaders))],
      licenseId: 'unknown',
      licenseName: 'Desconocida',
      licenseUrl: null,
      published: text(project.dateCreated),
      updated: text(project.dateModified),
      projectId: request.projectId,
      sourceUrl: httpsUrl(links.sourceUrl),
      wikiUrl: httpsUrl(links.wikiUrl),
      versions: files.map(({ fileId, filename, size, file }) => ({
        id: String(fileId),
        filename,
        size,
        name: text(file.displayName) || filename,
        versionNumber: filename,
        datePublished: text(file.fileDate),
        downloads: integer(file.downloadCount),
        changelog: changelogs.get(fileId) || null,
        dependencies: list(file.dependencies)
          .map(record)
          .flatMap((dependency) => {
            const projectId = integer(dependency.modId);
            const type = relations.get(dependency.relationType as 1 | 2 | 3 | 5);
            return projectId && type
              ? [{ projectId: `curseforge-${projectId}`, type, versionId: null }]
              : [];
          }),
      })),
    };
  }

  async downloadPack(
    request: ModInstallRequest,
    destination: string,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    const id = curseForgeProjectId(request.projectId);
    const version = request.versionId;
    if (!id || !version || !/^[1-9]\d{0,9}$/.test(version) || request.projectType !== 'modpack') {
      throw new Error(incompatibleFile);
    }
    const project = await this.#project(id, signal);
    const file = compatibleFile(
      (await this.#get(`mod/${id}/file/${version}`, {}, signal)).data,
      id,
      request,
    );
    if (typeFor(project) !== 'modpack' || !file || String(file.fileId) !== version) {
      throw new Error(incompatibleFile);
    }
    const download = this.#downloadMetadata(project, file.file);
    await new VerifiedDownloader({
      validateUrl: validateCdn,
      fetchImplementation: this.fetcher,
    }).download(
      { url: download.url, expectedSha1: download.sha1, expectedSize: file.size },
      destination,
      signal,
      onProgress,
    );
  }

  #downloadMetadata(project: Record<string, unknown>, file: Record<string, unknown>) {
    const url = httpsUrl(file.downloadUrl);
    if (!url || project.allowModDistribution === false) {
      throw new Error(
        'El autor restringe la descarga desde otros launchers. Abre la página de CurseForge para descargar el archivo.',
      );
    }
    validateCdn(new URL(url));
    const sha1 = text(
      list(file.hashes)
        .map(record)
        .find((hash) => hash.algo === 1)?.value,
    ).toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha1)) {
      throw new Error(unverifiedFile);
    }
    return { url, sha1 };
  }

  async install(
    request: ModInstallRequest,
    root: string,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
    beforeCommit?: () => void,
  ): Promise<{ installed: readonly string[] }> {
    const id = curseForgeProjectId(request.projectId);
    if (
      !id ||
      request.projectType === 'modpack' ||
      request.destinationServerId ||
      (request.projectType === 'mod' && !Object.hasOwn(loaderIds, request.loader)) ||
      (request.versionId && !/^[1-9][0-9]{0,9}$/.test(request.versionId))
    ) {
      throw new Error(incompatibleFile);
    }
    const release = acquireModInstallLock(root);
    if (!release) {
      throw new Error('Espera a que termine la otra instalación de mods');
    }
    try {
      const timeout = AbortSignal.timeout(180_000);
      const active = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const files = new Map<
        string,
        { filename: string; path: string; size: number; sha1: string; url: string }
      >();
      const visited = new Set<string>();
      const visit = async (projectId: string, version?: string): Promise<void> => {
        if (visited.has(projectId)) {
          return;
        }
        if (visited.size >= 32) {
          throw new Error('El mod supera el límite de dependencias de CurseForge.');
        }
        visited.add(projectId);
        const project = await this.#project(projectId, active);
        const type = typeFor(project);
        if (!type || type === 'modpack' || (projectId === id && type !== request.projectType)) {
          throw new Error(incompatibleFile);
        }
        const target = { ...request, projectType: type };
        const selected = version
          ? compatibleFile(
              (await this.#get(`mod/${projectId}/file/${version}`, {}, active)).data,
              projectId,
              target,
            )
          : (await this.#files(projectId, target, active))[0];
        if (!selected || (version && String(selected.fileId) !== version)) {
          throw new Error(incompatibleFile);
        }
        const { url, sha1 } = this.#downloadMetadata(project, selected.file);
        for (const dependency of selected.required) {
          await visit(String(dependency));
        }
        const path = join(
          type === 'datapack' && request.destinationWorld
            ? join('saves', request.destinationWorld, 'datapacks')
            : directories[type],
          selected.filename,
        );
        const key = path.toLowerCase();
        const existing = files.get(key);
        if (existing && existing.sha1 !== sha1) {
          throw new Error('Dos dependencias de CurseForge tienen el mismo nombre de archivo.');
        }
        files.set(key, { filename: selected.filename, path, size: selected.size, sha1, url });
      };
      await visit(id, request.versionId);
      const selected = [...files.values()];
      const total = selected.reduce((sum, file) => sum + file.size, 0);
      if (total > 2 * 1024 ** 3) {
        throw new Error(unverifiedFile);
      }
      const archive = join(root, '.replaced-mods');
      for (const path of [
        archive,
        ...new Set(selected.map((file) => dirname(join(root, file.path)))),
      ]) {
        await mkdir(path, { recursive: true });
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new Error('La ruta de instalación del mod no es válida.');
        }
      }
      const staging = await mkdtemp(join(root, '.battly-curseforge-'));
      try {
        const downloader = new VerifiedDownloader({
          validateUrl: validateCdn,
          fetchImplementation: this.fetcher,
        });
        let completed = 0;
        for (const file of selected) {
          await downloader.download(
            { url: file.url, expectedSize: file.size, expectedSha1: file.sha1 },
            join(staging, file.path),
            active,
            (current) => onProgress?.(completed + current, total),
          );
          completed += file.size;
        }
        active.throwIfAborted();
        beforeCommit?.();
        await this.#commit(
          staging,
          root,
          archive,
          selected.map(({ path }) => path),
        );
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      return { installed: selected.map(({ filename }) => filename) };
    } finally {
      release();
    }
  }

  async #commit(
    staging: string,
    directory: string,
    archive: string,
    names: readonly string[],
  ): Promise<void> {
    const backup = await mkdtemp(join(archive, 'curseforge-'));
    const replaced: string[] = [];
    const committed: string[] = [];
    try {
      for (const name of names) {
        const destination = join(directory, name);
        const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        });
        if (info) {
          if (!info.isFile() || info.isSymbolicLink()) {
            throw new Error('La ruta de instalación del mod no es válida.');
          }
          await mkdir(dirname(join(backup, name)), { recursive: true });
          await rename(destination, join(backup, name));
          replaced.push(name);
        }
        await rename(join(staging, name), destination);
        committed.push(name);
      }
    } catch (error) {
      for (const name of committed.reverse()) {
        await rm(join(directory, name), { force: true });
      }
      for (const name of replaced.reverse()) {
        await rename(join(backup, name), join(directory, name));
      }
      throw error;
    }
  }
}
