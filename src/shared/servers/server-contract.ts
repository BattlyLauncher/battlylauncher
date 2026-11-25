export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface ServerDraft {
  readonly eulaAccepted?: boolean;
  readonly name: string;
  readonly domain: string;
  readonly version: string;
  readonly region: string;
  readonly port: number;
}

export type ServerSoftwareKind = 'vanilla' | 'fabric' | 'paper' | 'forge' | 'neoforge' | 'spigot';

export function isServerModloader(kind: string | null): kind is 'fabric' | 'forge' | 'neoforge' {
  return kind === 'fabric' || kind === 'forge' || kind === 'neoforge';
}

export function normalizeServerLoaderBuild(value: unknown): string | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]{0,127}$/.test(value)) {
    throw new TypeError('La versión del modloader no es válida.');
  }
  return value;
}

export interface ServerSoftwareAvailability {
  readonly available: readonly ServerSoftwareKind[];
  readonly unavailable: Partial<Record<ServerSoftwareKind, string>>;
}

export interface ServerLaunchArguments {
  readonly unix: string;
  readonly windows: string;
}

export function paperMinecraftVersion(version: string): string {
  // The 1.8.x clients share protocol 47; Paper publishes 1.8.8, not 1.8.9.
  return version === '1.8.9' ? '1.8.8' : version;
}

export interface ServerSoftware {
  readonly gameVersion?: string;
  readonly build: string | null;
  readonly installedAt: string | null;
  readonly kind: ServerSoftwareKind;
  readonly launchArguments: ServerLaunchArguments | null;
}

export interface ServerProperties {
  readonly maxCpuPercent?: number;
  readonly viewDistance?: number;
  readonly simulationDistance?: number;
  readonly maxPlayers: number;
  readonly maxMemoryMb: number;
  readonly gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  readonly difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  readonly spawnProtection: number;
  readonly pvp: boolean;
  readonly spawnAnimals: boolean;
  readonly allowNether: boolean;
  readonly enableCommandBlock: boolean;
  readonly spawnMonsters: boolean;
  readonly forceGamemode: boolean;
  readonly whitelist: boolean;
  readonly resourcePack: string;
  readonly resourcePackPrompt: string;
}

export interface ServerSummary extends ServerDraft {
  readonly id: string;
  readonly status: ServerStatus;
  readonly properties: ServerProperties;
  readonly software: ServerSoftware;
}

export interface ServerRuntimeSnapshot {
  readonly onlinePlayers?: readonly string[];
  readonly cpuPercent: number;
  readonly id: string;
  readonly maxPlayers: number;
  readonly memoryMb: number;
  readonly pid: number | null;
  readonly players: number;
  readonly startedAt: string | null;
  readonly status: ServerStatus;
}

export type ServerRuntimeEvent =
  | {
      readonly id: string;
      readonly line: string;
      readonly stream: 'stderr' | 'stdout' | 'system';
      readonly type: 'log';
    }
  | { readonly snapshot: ServerRuntimeSnapshot; readonly type: 'snapshot' };

export type ServerInstallPhase = 'resolving' | 'server' | 'java' | 'loader' | 'complete';

export interface ServerInstallProgress {
  readonly completedBytes: number;
  readonly current: string;
  readonly id: string;
  readonly phase: ServerInstallPhase;
  readonly totalBytes: number;
}

export type ServerPlayerListKind = 'banned' | 'whitelist' | 'blacklist' | 'operators';

export interface ServerPlayerEntry {
  readonly created: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly uuid: string;
}

export interface ServerPlayerListsSnapshot {
  readonly history: readonly ServerPlayerEntry[];
  readonly lists: Readonly<Record<ServerPlayerListKind, readonly ServerPlayerEntry[]>>;
}

export interface ServerPlayerListMutation {
  readonly action: 'add' | 'remove';
  readonly kind: ServerPlayerListKind;
  readonly name: string;
  readonly uuid: string;
}

export interface ServerFileEntry {
  readonly editable: boolean;
  readonly modifiedAt: string;
  readonly name: string;
  readonly path: string;
  readonly size: number | null;
  readonly type: 'directory' | 'file';
}

export interface ServerFileContent {
  readonly content: string;
  readonly path: string;
}

export type ServerContentKind = 'mods' | 'plugins';

export interface ServerContentEntry {
  readonly enabled: boolean;
  readonly kind: ServerContentKind;
  readonly modifiedAt: string;
  readonly name: string;
  readonly size: number;
}

export type ServerPermissionRole = 'operator' | 'player' | 'viewer';

export interface ServerPermissionGrant {
  readonly role: ServerPermissionRole;
  readonly updatedAt: string;
  readonly username: string;
}

export interface ServerShareFriend {
  readonly status: 'ingame' | 'offline' | 'online';
  readonly username: string;
}

export interface ServerTunnelSnapshot {
  readonly publicHost?: string;
  readonly remotePort?: number;
  readonly message: string | null;
  readonly publicAddress: string | null;
  readonly startedAt: string | null;
  readonly status: 'error' | 'inactive' | 'starting' | 'active';
}

export interface ServerSharingSnapshot {
  readonly friends: readonly ServerShareFriend[];
  readonly permissions: readonly ServerPermissionGrant[];
  readonly tunnel: ServerTunnelSnapshot;
}

export interface ServerInviteDraft {
  readonly role: ServerPermissionRole;
  readonly username: string;
}

export const serverIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/;
const reservedDomainWords = ['api', 'server', 'oficial', 'battly'];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Server value must be an object');
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid server ${label}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || !isPrintable(normalized)) {
    throw new TypeError(`Invalid server ${label}`);
  }
  return normalized;
}

function isPrintable(value: string): boolean {
  return [...value].every((character) => (character.codePointAt(0) ?? 0) >= 32);
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new TypeError(`Invalid server ${label}`);
  }
  return result;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

export function normalizeServerDraft(value: unknown): ServerDraft {
  const source = object(value);
  const domain = text(own(source, 'domain'), 'domain', 20).toLowerCase();
  if (!domainPattern.test(domain) || reservedDomainWords.some((word) => domain.includes(word))) {
    throw new TypeError('Invalid or reserved server domain');
  }
  const version = text(own(source, 'version'), 'version', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(version)) {
    throw new TypeError('Invalid server version');
  }
  return {
    name: text(own(source, 'name'), 'name', 128),
    ...(own(source, 'eulaAccepted') === true ? { eulaAccepted: true } : {}),
    domain,
    version,
    region: text(own(source, 'region'), 'region', 64),
    port: integer(own(source, 'port') ?? 25_565, 'port', 1, 65_535),
  };
}

export function normalizeServerProperties(value: unknown): ServerProperties {
  const source = object(value);
  if (
    own(source, 'maxCpuPercent') !== undefined &&
    typeof own(source, 'maxCpuPercent') !== 'number'
  ) {
    throw new TypeError('Invalid maximum CPU');
  }
  const resourcePackValue = own(source, 'resourcePack');
  const resourcePack = typeof resourcePackValue === 'string' ? resourcePackValue.trim() : '';
  if (resourcePack.length > 2_048 || (resourcePack && !/^https:\/\//i.test(resourcePack))) {
    throw new TypeError('Invalid server resource pack URL');
  }
  const promptValue = own(source, 'resourcePackPrompt');
  const resourcePackPrompt = typeof promptValue === 'string' ? promptValue.trim() : '';
  if (resourcePackPrompt.length > 256 || !isPrintable(resourcePackPrompt)) {
    throw new TypeError('Invalid server resource pack prompt');
  }
  return {
    ...(own(source, 'maxCpuPercent') !== undefined
      ? { maxCpuPercent: integer(own(source, 'maxCpuPercent'), 'maximum CPU', 1, 100) }
      : {}),
    ...(own(source, 'viewDistance') !== undefined
      ? { viewDistance: integer(own(source, 'viewDistance'), 'view distance', 2, 32) }
      : {}),
    ...(own(source, 'simulationDistance') !== undefined
      ? {
          simulationDistance: integer(
            own(source, 'simulationDistance'),
            'simulation distance',
            2,
            32,
          ),
        }
      : {}),
    maxPlayers: integer(own(source, 'maxPlayers') ?? 20, 'maximum players', 1, 1_000),
    maxMemoryMb: integer(own(source, 'maxMemoryMb') ?? 2048, 'maximum memory', 512, 131_072),
    gamemode: choice(
      own(source, 'gamemode'),
      ['survival', 'creative', 'adventure', 'spectator'] as const,
      'survival',
    ),
    difficulty: choice(
      own(source, 'difficulty'),
      ['peaceful', 'easy', 'normal', 'hard'] as const,
      'easy',
    ),
    spawnProtection: integer(own(source, 'spawnProtection') ?? 0, 'spawn protection', 0, 1_000),
    pvp: boolean(own(source, 'pvp'), true),
    spawnAnimals: boolean(own(source, 'spawnAnimals'), true),
    allowNether: boolean(own(source, 'allowNether'), true),
    enableCommandBlock: boolean(own(source, 'enableCommandBlock'), true),
    spawnMonsters: boolean(own(source, 'spawnMonsters'), true),
    forceGamemode: boolean(own(source, 'forceGamemode'), false),
    whitelist: boolean(own(source, 'whitelist'), false),
    resourcePack,
    resourcePackPrompt,
  };
}

export function normalizeServerSummary(id: unknown, value: unknown): ServerSummary {
  if (typeof id !== 'string' || !serverIdPattern.test(id)) {
    throw new TypeError('Invalid server id');
  }
  const source = object(value);
  return {
    id,
    ...normalizeServerDraft(source),
    status: 'stopped',
    properties: normalizeServerProperties(own(source, 'properties') ?? {}),
    software: normalizeServerSoftware(own(source, 'software')),
  };
}

export function normalizeServerSoftwareKind(value: unknown): ServerSoftwareKind {
  if (
    value !== 'vanilla' &&
    value !== 'fabric' &&
    value !== 'paper' &&
    value !== 'forge' &&
    value !== 'neoforge' &&
    value !== 'spigot'
  ) {
    throw new TypeError('Invalid server software kind');
  }
  return value;
}

export function normalizeServerSoftware(value: unknown): ServerSoftware {
  if (value === undefined || value === null) {
    return { build: null, installedAt: null, kind: 'vanilla', launchArguments: null };
  }
  const source = object(value);
  const build = own(source, 'build');
  const installedAt = own(source, 'installedAt');
  const launchArgumentsValue = own(source, 'launchArguments');
  if (build !== null && (typeof build !== 'string' || !build || build.length > 128)) {
    throw new TypeError('Invalid server software build');
  }
  if (
    installedAt !== null &&
    (typeof installedAt !== 'string' || Number.isNaN(Date.parse(installedAt)))
  ) {
    throw new TypeError('Invalid server software installation date');
  }
  let launchArguments: ServerLaunchArguments | null = null;
  if (launchArgumentsValue !== undefined && launchArgumentsValue !== null) {
    const argumentsRecord = object(launchArgumentsValue);
    const normalizeArgumentsPath = (path: unknown, platform: 'unix' | 'win'): string => {
      if (
        typeof path !== 'string' ||
        path.length > 1_024 ||
        !new RegExp(`^libraries/(?:[a-zA-Z0-9._+-]+/)+${platform}_args\\.txt$`).test(path) ||
        path.includes('..')
      ) {
        throw new TypeError('Invalid server launch arguments path');
      }
      return path;
    };
    launchArguments = {
      unix: normalizeArgumentsPath(own(argumentsRecord, 'unix'), 'unix'),
      windows: normalizeArgumentsPath(own(argumentsRecord, 'windows'), 'win'),
    };
  }
  return {
    build,
    installedAt,
    kind: normalizeServerSoftwareKind(own(source, 'kind')),
    ...(own(source, 'gameVersion') !== undefined
      ? { gameVersion: text(own(source, 'gameVersion'), 'software Minecraft version', 128) }
      : {}),
    launchArguments,
  };
}

export function normalizeServerId(value: unknown): string {
  if (typeof value !== 'string' || !serverIdPattern.test(value)) {
    throw new TypeError('Invalid server id');
  }
  return value;
}

export function normalizeServerContentKind(value: unknown): ServerContentKind {
  if (value !== 'mods' && value !== 'plugins') {
    throw new TypeError('Invalid server content kind');
  }
  return value;
}

export function normalizeServerContentName(value: unknown): string {
  const lower = typeof value === 'string' ? value.toLowerCase() : '';
  const disabledBase = lower.endsWith('.disabled') ? lower.slice(0, -9) : '';
  const windowsStem = lower.split('.')[0];
  if (
    typeof value !== 'string' ||
    value.length < 5 ||
    value.length > 255 ||
    !isPrintable(value) ||
    /[<>:"/\\|?*]/.test(value) ||
    value.endsWith('.') ||
    value.endsWith(' ') ||
    (!lower.endsWith('.jar') && !lower.endsWith('.disabled')) ||
    disabledBase.endsWith('.jar') ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(windowsStem ?? '')
  ) {
    throw new TypeError('Invalid server content name');
  }
  return value;
}

export function normalizeServerPermissionRole(value: unknown): ServerPermissionRole {
  if (value !== 'operator' && value !== 'player' && value !== 'viewer') {
    throw new TypeError('Invalid server permission role');
  }
  return value;
}

export function normalizeServerInviteDraft(value: unknown): ServerInviteDraft {
  const source = object(value);
  const username = own(source, 'username');
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw new TypeError('Invalid server invite username');
  }
  return { role: normalizeServerPermissionRole(own(source, 'role')), username };
}

export function normalizeServerCommand(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid server command');
  }
  const command = value.trim();
  if (
    !command ||
    command.length > 512 ||
    command.includes('\n') ||
    command.includes('\r') ||
    !isPrintable(command)
  ) {
    throw new TypeError('Invalid server command');
  }
  return command;
}

export function normalizeServerPlayerListMutation(value: unknown): ServerPlayerListMutation {
  const source = object(value);
  const kind = own(source, 'kind');
  const action = own(source, 'action');
  const name = own(source, 'name');
  const uuid = own(source, 'uuid');
  if (!['banned', 'whitelist', 'blacklist', 'operators'].includes(String(kind))) {
    throw new TypeError('Invalid server player list');
  }
  if (action !== 'add' && action !== 'remove') {
    throw new TypeError('Invalid server player list action');
  }
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_]{1,16}$/.test(name)) {
    throw new TypeError('Invalid Minecraft player name');
  }
  if (
    typeof uuid !== 'string' ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(uuid)
  ) {
    throw new TypeError('Invalid Minecraft player UUID');
  }
  return {
    action,
    kind: kind as ServerPlayerListKind,
    name,
    uuid: uuid.toLowerCase(),
  };
}

export function normalizeServerRelativePath(value: unknown, allowRoot = false): string {
  if (typeof value !== 'string' || value.length > 1_024 || value.includes('\0')) {
    throw new TypeError('Invalid server relative path');
  }
  const portable = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (allowRoot && portable === '') {
    return '';
  }
  if (
    !portable ||
    portable.startsWith('/') ||
    /^[a-zA-Z]:/.test(portable) ||
    portable.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Invalid server relative path');
  }
  return portable;
}

export interface ServerInvitation {
  readonly friendName: string;
  readonly serverName: string;
  readonly serverVersion: string;
  readonly subdomain: string;
}

export function normalizeServerInvitation(value: unknown): ServerInvitation {
  const source = object(value);
  const subdomain = text(own(source, 'subdomain'), 'subdomain', 20).toLowerCase();
  if (!domainPattern.test(subdomain)) {
    throw new TypeError('Invalid server domain');
  }
  const serverVersion = text(own(source, 'serverVersion'), 'version', 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(serverVersion)) {
    throw new TypeError('Invalid version');
  }
  return {
    subdomain,
    serverVersion,
    friendName: text(own(source, 'friendName'), 'friend name', 64),
    serverName: text(own(source, 'serverName'), 'server name', 128),
  };
}
