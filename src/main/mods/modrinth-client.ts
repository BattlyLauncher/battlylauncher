import { remoteHtmlToText } from '../../shared/home/home-contract';
import type {
  ModProjectSummary,
  ModProjectType,
  ModSearchRequest,
  ModSearchResult,
} from '../../shared/mods/mod-contract';

const maxResponseBytes = 32 * 1024 * 1024;
const clientModLoaders = new Set([
  'fabric',
  'forge',
  'legacy-fabric',
  'liteloader',
  'modloader',
  'neoforge',
  'quilt',
  'rift',
]);
const projectTypes = new Set<ModProjectType>([
  'datapack',
  'mod',
  'modpack',
  'resourcepack',
  'shader',
]);

export interface ModrinthClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ModrinthDependency {
  readonly dependencyType: 'embedded' | 'incompatible' | 'optional' | 'required';
  readonly projectId: string | null;
  readonly versionId: string | null;
}

export interface ModrinthVersionFile {
  readonly filename: string;
  readonly primary: boolean;
  readonly sha1: string;
  readonly sha512: string;
  readonly size: number;
  readonly url: string;
}

export interface ModrinthVersion {
  readonly changelog: string | null;
  readonly datePublished: string;
  readonly dependencies: readonly ModrinthDependency[];
  readonly downloads: number;
  readonly files: readonly ModrinthVersionFile[];
  readonly gameVersions: readonly string[];
  readonly id: string;
  readonly loaders: readonly string[];
  readonly name: string;
  readonly projectId: string;
  readonly versionNumber: string;
}

export interface ModrinthProjectMetadata {
  readonly serverSide?: string;
  readonly body: string;
  readonly categories: readonly string[];
  readonly description: string;
  readonly discordUrl: string | null;
  readonly downloads: number;
  readonly followers: number;
  readonly iconUrl: string | null;
  readonly gallery: readonly {
    readonly featured?: boolean;
    readonly created: string;
    readonly description: string | null;
    readonly title: string | null;
    readonly url: string;
  }[];
  readonly licenseId: string;
  readonly licenseName: string;
  readonly licenseUrl: string | null;
  readonly loaders: readonly string[];
  readonly published: string;
  readonly sourceUrl: string | null;
  readonly teamId: string;
  readonly title: string;
  readonly updated: string;
  readonly wikiUrl: string | null;
}

export interface ModrinthProjectMember {
  readonly avatarUrl: string | null;
  readonly name: string;
  readonly role: string;
  readonly username: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function stringValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = stringValue(value, label, 128);
  if (!/^[A-Za-z0-9._+-]+$/.test(result) || result === '.' || result === '..') {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return result;
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return Number(value);
}

function stringArray(value: unknown, label: string, maximum = 100): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return value.map((entry) => stringValue(entry, label, 128));
}

function optionalHttpsUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const url = new URL(stringValue(value, 'icon URL', 2048));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('Invalid Modrinth icon URL');
  }
  return url.toString();
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return plainSummary(stringValue(value, label, maximum), maximum);
}

function isoDate(value: unknown, label: string): string {
  const result = stringValue(value, label, 64);
  if (Number.isNaN(Date.parse(result))) {
    throw new TypeError(`Invalid Modrinth ${label}`);
  }
  return result;
}

function optionalIsoDate(value: unknown, label: string): string {
  return value === null || value === undefined || value === ''
    ? new Date(0).toISOString()
    : isoDate(value, label);
}

function plainSummary(value: string, maximumLength: number): string {
  return remoteHtmlToText(value, maximumLength).replace(/\s+/g, ' ').trim();
}

async function responseJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxResponseBytes) {
    throw new TypeError('Modrinth response is too large');
  }
  if (!response.body) {
    throw new TypeError('Modrinth response has no body');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxResponseBytes) {
      await reader.cancel();
      throw new TypeError('Modrinth response is too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new TypeError('Modrinth response is not valid JSON');
  }
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Modrinth base URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('Modrinth base URL contains credentials');
  }
  return url;
}

function projectSummary(value: unknown): ModProjectSummary {
  const source = objectValue(value, 'project');
  const projectType = own(source, 'project_type');
  if (!projectTypes.has(projectType as ModProjectType)) {
    throw new TypeError('Invalid Modrinth project type');
  }
  return {
    id: identifier(own(source, 'project_id'), 'project id'),
    projectType: projectType as ModProjectType,
    title: plainSummary(stringValue(own(source, 'title'), 'title', 512), 128),
    description: plainSummary(stringValue(own(source, 'description'), 'description', 4096), 512),
    author: plainSummary(stringValue(own(source, 'author'), 'author', 256), 128),
    downloads: integer(own(source, 'downloads'), 'downloads'),
    follows: integer(own(source, 'follows'), 'follows'),
    iconUrl: optionalHttpsUrl(own(source, 'icon_url')),
    featuredGallery: optionalHttpsUrl(own(source, 'featured_gallery')),
    gallery: Array.isArray(own(source, 'gallery'))
      ? (own(source, 'gallery') as unknown[])
          .slice(0, 100)
          .map(optionalHttpsUrl)
          .filter((url): url is string => url !== null)
      : [],
    gameVersions: stringArray(own(source, 'versions'), 'versions', 1024),
    categories: stringArray(own(source, 'categories'), 'categories'),
    latestVersionId: identifier(own(source, 'latest_version'), 'latest version id'),
  };
}

function optionalIdentifier(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : identifier(value, label);
}

function hash(value: unknown, algorithm: 'sha1' | 'sha512'): string {
  const expectedLength = algorithm === 'sha1' ? 40 : 128;
  if (typeof value !== 'string' || !new RegExp(`^[a-fA-F0-9]{${expectedLength}}$`).test(value)) {
    throw new TypeError(`Invalid Modrinth ${algorithm}`);
  }
  return value.toLowerCase();
}

function downloadUrl(value: unknown): string {
  const url = new URL(stringValue(value, 'download URL', 4096));
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Invalid Modrinth download URL');
  }
  if (url.username || url.password) {
    throw new TypeError('Invalid Modrinth download URL');
  }
  return url.toString();
}

function versionFile(value: unknown): ModrinthVersionFile {
  const source = objectValue(value, 'version file');
  const hashes = objectValue(own(source, 'hashes'), 'version hashes');
  const filename = stringValue(own(source, 'filename'), 'filename', 255);
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
    throw new TypeError('Invalid Modrinth filename');
  }
  const primary = own(source, 'primary');
  if (typeof primary !== 'boolean') {
    throw new TypeError('Invalid Modrinth primary file flag');
  }
  return {
    filename,
    primary,
    sha1: hash(own(hashes, 'sha1'), 'sha1'),
    sha512: hash(own(hashes, 'sha512'), 'sha512'),
    size: integer(own(source, 'size'), 'file size', 512 * 1024 * 1024),
    url: downloadUrl(own(source, 'url')),
  };
}

function version(value: unknown): ModrinthVersion {
  const source = objectValue(value, 'version');
  const dependencyValue = own(source, 'dependencies');
  const fileValue = own(source, 'files');
  const dependencies =
    dependencyValue === null || dependencyValue === undefined ? [] : dependencyValue;
  const files = fileValue === null || fileValue === undefined ? [] : fileValue;
  if (
    !Array.isArray(dependencies) ||
    dependencies.length > 10_000 ||
    !Array.isArray(files) ||
    files.length > 1_000
  ) {
    throw new TypeError('Invalid Modrinth version contents');
  }
  return {
    changelog:
      own(source, 'changelog') === null
        ? null
        : optionalText(own(source, 'changelog'), 'version changelog', 200_000),
    datePublished: optionalIsoDate(own(source, 'date_published'), 'version publication date'),
    downloads:
      own(source, 'downloads') === undefined
        ? 0
        : integer(own(source, 'downloads'), 'version downloads'),
    id: identifier(own(source, 'id'), 'version id'),
    name: optionalText(own(source, 'name'), 'version name', 512) ?? '',
    projectId: identifier(own(source, 'project_id'), 'version project id'),
    versionNumber: optionalText(own(source, 'version_number'), 'version number', 256) ?? '',
    gameVersions: stringArray(own(source, 'game_versions') ?? [], 'game versions', 1024),
    loaders: stringArray(own(source, 'loaders') ?? [], 'version loaders', 100),
    dependencies: dependencies.flatMap((entry): ModrinthDependency[] => {
      try {
        const dependency = objectValue(entry, 'dependency');
        const dependencyType = own(dependency, 'dependency_type');
        if (
          !['embedded', 'incompatible', 'optional', 'required'].includes(String(dependencyType))
        ) {
          return [];
        }
        return [
          {
            dependencyType: dependencyType as ModrinthDependency['dependencyType'],
            projectId: optionalIdentifier(own(dependency, 'project_id'), 'dependency project id'),
            versionId: optionalIdentifier(own(dependency, 'version_id'), 'dependency version id'),
          },
        ];
      } catch {
        return [];
      }
    }),
    files: files.flatMap((entry): ModrinthVersionFile[] => {
      try {
        return [versionFile(entry)];
      } catch {
        return [];
      }
    }),
  };
}

function usableVersion(value: unknown): ModrinthVersion | null {
  try {
    return version(value);
  } catch {
    return null;
  }
}

export class ModrinthClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: ModrinthClientOptions = {}) {
    this.#baseUrl = validatedBaseUrl(options.baseUrl ?? 'https://api.modrinth.com/v2/');
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async search(request: ModSearchRequest, signal?: AbortSignal): Promise<ModSearchResult> {
    const url = new URL('search', this.#baseUrl);
    url.searchParams.set('query', request.query);
    url.searchParams.set('index', request.sort);
    url.searchParams.set('offset', String(request.offset));
    url.searchParams.set('limit', String(request.limit));
    const facets: string[][] = [];
    if (request.loader) {
      facets.push([`categories:${request.loader}`]);
    }
    if (request.category) {
      facets.push([`categories:${request.category}`]);
    }
    for (const version of request.gameVersions) {
      facets.push([`versions:${version}`]);
    }
    if (request.projectType) {
      facets.push([`project_type:${request.projectType}`]);
    }
    if (facets.length) {
      url.searchParams.set('facets', JSON.stringify(facets));
    }
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs);
    const response = await this.#fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'BattlyLauncher/3.1.0' },
      redirect: 'error',
      signal: combinedSignal,
    });
    if (!response.ok) {
      throw new Error(`Modrinth search failed (${response.status})`);
    }
    const result = objectValue(await responseJson(response), 'search response');
    const hits = own(result, 'hits');
    if (!Array.isArray(hits) || hits.length > request.limit) {
      throw new TypeError('Invalid Modrinth search hits');
    }
    return {
      projects: hits.map(projectSummary),
      offset: integer(own(result, 'offset'), 'offset', 10_000),
      limit: integer(own(result, 'limit'), 'limit', 100),
      total: integer(own(result, 'total_hits'), 'total hits'),
    };
  }

  async projectVersions(
    projectId: string,
    gameVersion: string,
    loader: string,
    signal?: AbortSignal,
    includeChangelog = false,
  ): Promise<readonly ModrinthVersion[]> {
    const url = new URL(`project/${encodeURIComponent(projectId)}/version`, this.#baseUrl);
    if (gameVersion) {
      url.searchParams.set('game_versions', JSON.stringify([gameVersion]));
    }
    if (loader) {
      url.searchParams.set('loaders', JSON.stringify([loader]));
    }
    url.searchParams.set('include_changelog', String(includeChangelog));
    const result = await this.#getJson(url, signal);
    if (!Array.isArray(result) || result.length > 20_000) {
      throw new TypeError('Invalid Modrinth project versions');
    }
    return result
      .map(usableVersion)
      .filter((entry): entry is ModrinthVersion => entry !== null)
      .filter(
        (entry) =>
          (!gameVersion ||
            !entry.gameVersions.length ||
            entry.gameVersions.includes(gameVersion)) &&
          (!loader ||
            !entry.loaders.length ||
            entry.loaders.some((candidate) => candidate.toLowerCase() === loader.toLowerCase())),
      );
  }

  async project(projectId: string, signal?: AbortSignal): Promise<ModrinthProjectMetadata> {
    const result = objectValue(
      await this.#getJson(
        new URL(`project/${encodeURIComponent(projectId)}`, this.#baseUrl),
        signal,
      ),
      'project detail',
    );
    const body = own(result, 'body');
    if (typeof body !== 'string' || body.length > 1_000_000) {
      throw new TypeError('Invalid Modrinth project body');
    }
    const rawGallery = own(result, 'gallery') ?? [];
    if (!Array.isArray(rawGallery) || rawGallery.length > 100) {
      throw new TypeError('Invalid Modrinth gallery');
    }
    const rawLicenseValue = own(result, 'license');
    const rawLicense =
      rawLicenseValue === null || rawLicenseValue === undefined
        ? {}
        : objectValue(rawLicenseValue, 'license');
    const licenseId = optionalText(own(rawLicense, 'id'), 'license id', 128) ?? 'unknown';
    return {
      serverSide: optionalText(own(result, 'server_side'), 'server side', 32) ?? 'unknown',
      body,
      categories: stringArray(own(result, 'categories') ?? [], 'categories', 100),
      description: optionalText(own(result, 'description'), 'description', 2_000) ?? '',
      discordUrl: optionalHttpsUrl(own(result, 'discord_url')),
      downloads: integer(own(result, 'downloads'), 'downloads'),
      followers: integer(own(result, 'followers'), 'followers'),
      iconUrl: optionalHttpsUrl(own(result, 'icon_url')),
      gallery: rawGallery
        .map((entry) => {
          const gallery = objectValue(entry, 'gallery entry');
          return {
            featured: own(gallery, 'featured') === true,
            created: isoDate(own(gallery, 'created'), 'gallery date'),
            description: optionalText(own(gallery, 'description'), 'gallery description', 2_000),
            title: optionalText(own(gallery, 'title'), 'gallery title', 512),
            url: optionalHttpsUrl(own(gallery, 'url')) ?? '',
          };
        })
        .filter((entry) => entry.url),
      licenseId,
      licenseName:
        optionalText(own(rawLicense, 'name'), 'license name', 512) ??
        (licenseId === 'unknown' ? 'Licencia no especificada' : licenseId),
      licenseUrl: optionalHttpsUrl(own(rawLicense, 'url')),
      loaders: stringArray(own(result, 'loaders') ?? [], 'loaders', 100).filter((loader) =>
        clientModLoaders.has(loader.toLowerCase()),
      ),
      published: isoDate(own(result, 'published'), 'publication date'),
      sourceUrl: optionalHttpsUrl(own(result, 'source_url')),
      teamId: identifier(own(result, 'team'), 'team id'),
      title: optionalText(own(result, 'title'), 'title', 512) ?? projectId,
      updated: isoDate(own(result, 'updated'), 'updated date'),
      wikiUrl: optionalHttpsUrl(own(result, 'wiki_url')),
    };
  }

  async projectMembers(
    teamId: string,
    signal?: AbortSignal,
  ): Promise<readonly ModrinthProjectMember[]> {
    const result = await this.#getJson(
      new URL(`team/${encodeURIComponent(teamId)}/members`, this.#baseUrl),
      signal,
    );
    if (!Array.isArray(result) || result.length > 100) {
      throw new TypeError('Invalid Modrinth project members');
    }
    return result.map((entry) => {
      const member = objectValue(entry, 'team member');
      const user = objectValue(own(member, 'user'), 'team user');
      return {
        avatarUrl: optionalHttpsUrl(own(user, 'avatar_url')),
        name: optionalText(own(user, 'name'), 'team member name', 256) ?? '',
        role: plainSummary(stringValue(own(member, 'role'), 'team member role', 128), 128),
        username: plainSummary(
          stringValue(own(user, 'username'), 'team member username', 128),
          128,
        ),
      };
    });
  }

  async version(versionId: string, signal?: AbortSignal): Promise<ModrinthVersion> {
    return version(
      await this.#getJson(
        new URL(`version/${encodeURIComponent(versionId)}`, this.#baseUrl),
        signal,
      ),
    );
  }

  async #getJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    const combinedSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs);
    const response = await this.#fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'BattlyLauncher/3.1.0' },
      redirect: 'error',
      signal: combinedSignal,
    });
    if (!response.ok) {
      throw new Error(`Modrinth request failed (${response.status})`);
    }
    return responseJson(response);
  }
}
