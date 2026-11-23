export type ModProjectType = 'datapack' | 'mod' | 'modpack' | 'resourcepack' | 'shader';
export type ModSearchSort = 'downloads' | 'follows' | 'relevance' | 'updated';
export type ModCatalogProvider = 'all' | 'modrinth' | 'curseforge';

export function curseForgeProjectId(projectId: string): string | undefined {
  return /^curseforge-([1-9][0-9]{0,9})$/.exec(projectId)?.[1];
}

export interface ModSearchRequest {
  readonly provider?: ModCatalogProvider;
  readonly query: string;
  readonly sort: ModSearchSort;
  readonly loader: string | null;
  readonly category: string | null;
  readonly projectType: ModProjectType | null;
  readonly gameVersions: readonly string[];
  readonly offset: number;
  readonly limit: number;
}

export interface ModProjectSummary {
  readonly recommendedByBattly?: boolean;
  readonly id: string;
  readonly projectType: ModProjectType;
  readonly title: string;
  readonly description: string;
  readonly author: string;
  readonly downloads: number;
  readonly follows: number;
  readonly iconUrl: string | null;
  readonly featuredGallery?: string | null;
  readonly gallery?: readonly string[];
  readonly gameVersions: readonly string[];
  readonly categories: readonly string[];
  readonly latestVersionId: string;
}

export interface ModSearchResult {
  readonly projects: readonly ModProjectSummary[];
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
}

export interface ModInstallRequest {
  readonly projectId: string;
  readonly gameVersion: string;
  readonly loader: string;
  readonly projectType: ModProjectType;
  readonly versionId?: string;
  readonly destinationInstanceId?: string;
  readonly destinationServerId?: string;
  readonly destinationWorld?: string;
}

export interface ModProjectDependencySummary {
  readonly projectId: string | null;
  readonly type: 'embedded' | 'incompatible' | 'optional' | 'required';
  readonly versionId: string | null;
}

export interface ModProjectVersionSummary {
  readonly changelog: string | null;
  readonly datePublished: string;
  readonly dependencies: readonly ModProjectDependencySummary[];
  readonly downloads: number;
  readonly filename: string;
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly versionNumber: string;
}

export interface ModProjectGalleryImage {
  readonly created: string;
  readonly description: string | null;
  readonly title: string | null;
  readonly url: string;
}

export interface ModProjectCreator {
  readonly avatarUrl: string | null;
  readonly name: string;
  readonly role: string;
  readonly username: string;
}

export interface ModProjectDetail {
  readonly body: string;
  readonly categories: readonly string[];
  readonly creators: readonly ModProjectCreator[];
  readonly discordUrl: string | null;
  readonly downloads: number;
  readonly followers: number;
  readonly gallery: readonly ModProjectGalleryImage[];
  readonly gameVersion: string;
  readonly licenseId: string;
  readonly licenseName: string;
  readonly licenseUrl: string | null;
  readonly loader: string;
  readonly loaders: readonly string[];
  readonly published: string;
  readonly projectId: string;
  readonly sourceUrl: string | null;
  readonly updated: string;
  readonly versions: readonly ModProjectVersionSummary[];
  readonly wikiUrl: string | null;
}

export interface LocalModSummary {
  readonly enabled: boolean;
  readonly filename: string;
  readonly modifiedAt: string;
  readonly size: number;
}

export type LocalModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'unknown';

export interface LocalModInspection {
  readonly requirements?: readonly LocalModRequirement[];
  readonly provides?: readonly { id: string; version: string | null }[];
  readonly environment?: string;
  readonly metadataWarnings?: readonly string[];
  readonly dependencies: readonly string[];
  readonly enabled: boolean;
  readonly filename: string;
  readonly gameVersion: string | null;
  readonly id: string | null;
  readonly iconDataUrl: string | null;
  readonly loader: LocalModLoader;
  readonly name: string;
  readonly readable: boolean;
  readonly version: string | null;
}

export interface LocalModRequirement {
  readonly id: string;
  readonly ranges: readonly string[];
  readonly kind: 'required' | 'optional' | 'conflict';
}

export interface LocalModTarget {
  readonly gameVersion?: string;
  readonly loader?: Exclude<LocalModLoader, 'unknown'>;
  readonly loaderVersion?: string;
  readonly javaVersion?: string;
}

export type LocalModCompatibilityIssueKind =
  | 'dependency-version'
  | 'disabled-dependency'
  | 'conflict'
  | 'unverified'
  | 'environment'
  | 'duplicate-id'
  | 'game-version-mismatch'
  | 'loader-mismatch'
  | 'missing-dependency'
  | 'unknown-metadata'
  | 'unreadable';

export interface LocalModCompatibilityIssue {
  readonly severity?: 'error' | 'warning';
  readonly detected: string | null;
  readonly expected: string | null;
  readonly filename: string;
  readonly kind: LocalModCompatibilityIssueKind;
  readonly modName: string;
}

export interface LocalModCompatibilityReport {
  readonly issues: readonly LocalModCompatibilityIssue[];
  readonly mods: readonly LocalModInspection[];
  readonly primaryGameVersion: string | null;
  readonly primaryLoader: Exclude<LocalModLoader, 'unknown'> | null;
}

export interface LocalModCompatibilityFixResult {
  readonly enabled?: readonly string[];
  readonly installed?: readonly string[];
  readonly disabled: readonly string[];
  readonly report: LocalModCompatibilityReport;
}

export function normalizeLocalModFilename(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 255 ||
    value.includes('/') ||
    value.includes('\\') ||
    value === '.' ||
    value === '..' ||
    (!value.toLowerCase().endsWith('.jar') && !value.toLowerCase().endsWith('.disabledmod'))
  ) {
    throw new TypeError('Invalid local mod filename');
  }
  return value;
}

function own(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function exactKeys(source: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError('Mods request contains unsupported fields');
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Mods request must be an object');
  }
  return value as Record<string, unknown>;
}

function boundedIdentifier(value: unknown, field: string, max = 128): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    !/^[A-Za-z0-9._+-]+$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

const projectTypes = new Set<ModProjectType>([
  'datapack',
  'mod',
  'modpack',
  'resourcepack',
  'shader',
]);
const sorts = new Set<ModSearchSort>(['downloads', 'follows', 'relevance', 'updated']);

export function normalizeModSearchRequest(value: unknown): ModSearchRequest {
  const source = objectValue(value);
  const allowed = [
    'query',
    'sort',
    'loader',
    'category',
    'projectType',
    'gameVersions',
    'offset',
    'limit',
  ];
  if (Object.hasOwn(source, 'provider')) {
    allowed.push('provider');
  }
  const hasOnlyQuery = Object.keys(source).length === 1 && Object.hasOwn(source, 'query');
  if (!hasOnlyQuery) {
    exactKeys(source, allowed);
  }
  const query = own(source, 'query');
  const provider = own(source, 'provider');
  const sort = own(source, 'sort') ?? 'relevance';
  const loader = own(source, 'loader') ?? null;
  const category = own(source, 'category') ?? null;
  const projectType = own(source, 'projectType') ?? null;
  const gameVersions = own(source, 'gameVersions') ?? [];
  const offset = own(source, 'offset') ?? 0;
  const limit = own(source, 'limit') ?? 20;
  if (typeof query !== 'string' || query.length > 200) {
    throw new TypeError('Invalid mods query');
  }
  if (
    provider !== undefined &&
    provider !== 'all' &&
    provider !== 'modrinth' &&
    provider !== 'curseforge'
  ) {
    throw new TypeError('Mods request contains unsupported fields');
  }
  if (!sorts.has(sort as ModSearchSort)) {
    throw new TypeError('Invalid mods sort');
  }
  if (loader !== null) {
    boundedIdentifier(loader, 'loader');
  }
  if (category !== null) {
    boundedIdentifier(category, 'category');
  }
  if (projectType !== null && !projectTypes.has(projectType as ModProjectType)) {
    throw new TypeError('Invalid project type');
  }
  if (!Array.isArray(gameVersions) || gameVersions.length > 20) {
    throw new TypeError('Invalid game version filters');
  }
  const normalizedVersions = gameVersions.map((version) =>
    boundedIdentifier(version, 'game version'),
  );
  if (!Number.isInteger(offset) || Number(offset) < 0 || Number(offset) > 10_000) {
    throw new TypeError('Invalid mods offset');
  }
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) {
    throw new TypeError('Invalid mods limit');
  }
  return {
    ...(provider ? { provider } : {}),
    query: query.trim(),
    sort: sort as ModSearchSort,
    loader: loader as string | null,
    category: category as string | null,
    projectType: projectType as ModProjectType | null,
    gameVersions: normalizedVersions,
    offset: Number(offset),
    limit: Number(limit),
  };
}

export function normalizeModInstallRequest(value: unknown): ModInstallRequest {
  const source = objectValue(value);
  const keys = Object.keys(source);
  if (
    keys.some(
      (key) =>
        ![
          'projectId',
          'gameVersion',
          'loader',
          'projectType',
          'versionId',
          'destinationInstanceId',
          'destinationServerId',
          'destinationWorld',
        ].includes(key),
    )
  ) {
    throw new TypeError('Mods request contains unsupported fields');
  }
  const projectId = boundedIdentifier(own(source, 'projectId'), 'project id');
  const gameVersion = boundedIdentifier(own(source, 'gameVersion'), 'game version');
  const loader = boundedIdentifier(own(source, 'loader'), 'loader');
  const projectType = own(source, 'projectType');
  const rawVersionId = own(source, 'versionId');
  const versionId =
    rawVersionId === undefined ? undefined : boundedIdentifier(rawVersionId, 'version id');
  const rawDestinationInstanceId = own(source, 'destinationInstanceId');
  const destinationInstanceId =
    rawDestinationInstanceId === undefined
      ? undefined
      : boundedIdentifier(rawDestinationInstanceId, 'destination instance id');
  const destinationServerId =
    own(source, 'destinationServerId') === undefined
      ? undefined
      : boundedIdentifier(own(source, 'destinationServerId'), 'destination server id');
  const world = own(source, 'destinationWorld');
  if (
    world !== undefined &&
    (projectType !== 'datapack' ||
      destinationServerId ||
      typeof world !== 'string' ||
      !world ||
      world.length > 255 ||
      /^[. ]|[. ]$/.test(world) ||
      /[<>:"/\\|?*]/.test(world) ||
      [...world].some((character) => character.charCodeAt(0) < 32))
  ) {
    throw new TypeError('Invalid Minecraft world');
  }
  if (destinationServerId && (destinationInstanceId || projectType !== 'mod')) {
    throw new TypeError('Invalid server mod destination');
  }
  if (!projectTypes.has(projectType as ModProjectType)) {
    throw new TypeError('Invalid project type');
  }
  return {
    projectId,
    gameVersion,
    loader,
    projectType: projectType as ModProjectType,
    versionId,
    destinationInstanceId,
    destinationServerId,
    ...(typeof world === 'string' ? { destinationWorld: world } : {}),
  };
}
