import { normalizeInstanceDraft, type InstanceDraft, type InstanceArtwork } from './instance';
import type { ModpackInstallProgress } from '../mods/modpack-install-contract';

export const bypackLimits = {
  entries: 50_000,
  fileBytes: 2 * 1024 ** 3,
  totalBytes: 16 * 1024 ** 3,
  manifestBytes: 16 * 1024 ** 2,
} as const;
export interface BypackRemote {
  readonly provider: 'modrinth' | 'curseforge';
  readonly projectId: string;
  readonly versionId: string;
  readonly url: string;
}
export interface BypackFile {
  readonly path: string;
  readonly size: number;
  readonly sha512: string;
  readonly remote?: BypackRemote;
}
export interface BypackManifest {
  readonly format: 'battly-bypack';
  readonly version: 1;
  readonly instance: InstanceDraft;
  readonly author?: string;
  readonly directories: readonly string[];
  readonly files: readonly BypackFile[];
}
export interface BypackPreview {
  readonly artwork?: InstanceArtwork;
  readonly token: string;
  readonly instance: InstanceDraft;
  readonly author: string | null;
  readonly files: number;
  readonly downloads: number;
  readonly bytes: number;
}
export function bypackImportPercent(
  progress: ModpackInstallProgress,
  preview: Pick<BypackPreview, 'files' | 'downloads'>,
): number {
  if (progress.phase === 'complete') {
    return 100;
  }
  const embedded = preview.files - preview.downloads;
  const completed =
    progress.phase === 'extracting'
      ? progress.current
      : progress.phase === 'downloading-files'
        ? embedded + progress.current
        : progress.phase === 'writing'
          ? preview.files
          : 0;
  return Math.min(99, Math.max(0, Math.floor((completed / (preview.files + 1)) * 100)));
}
export interface BypackExportResult {
  readonly path: string;
  readonly archiveBytes: number;
  readonly sourceBytes: number;
  readonly referencedBytes: number;
  readonly embeddedFiles: number;
  readonly modrinthFiles: number;
  readonly curseforgeFiles: number;
  readonly warnings: readonly string[];
}

export function bypackPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\\')) {
    throw new Error('Ruta inválida en el .bypack');
  }
  const parts = value.split('/');
  if (
    parts.length > 32 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.length > 255 ||
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        [...part].some((c) => c.charCodeAt(0) < 32) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error('Ruta insegura en el .bypack');
  }
  return value;
}

const excludedRoots = new Set([
  'assets',
  'loader',
  'libraries',
  'versions',
  'runtime',
  'runtimes',
  'java',
  'bin',
  'natives',
  'saves',
  'world',
  'worlds',
  'backups',
  'screenshots',
  'logs',
  'crash-reports',
  'cache',
  'caches',
  '.cache',
  '.fabric',
  '.quilt',
  '.git',
  'node_modules',
  'webcache',
  'shadercache',
  'xaeroworldmap',
  'xaerowaypoints',
  'journeymap',
  'instance.json',
  'launcher_accounts.json',
  'launcher_profiles.json',
  'accounts.json',
  'usercache.json',
  'usernamecache.json',
  'session.lock',
  'minecraftinstance.json',
]);
export function excludeFromBypack(path: string, isDirectory = false): boolean {
  const parts = path.toLowerCase().split('/');
  const name = parts[parts.length - 1];
  const directories = parts.slice(0, isDirectory ? parts.length : -1);
  return (
    excludedRoots.has(parts[0]) ||
    directories.some(
      (part) => part.startsWith('.') || part.includes('cache') || part === 'neoforge',
    ) ||
    (!isDirectory &&
      ((name.includes('logs') && !name.endsWith('.jar')) ||
        /^authlib[-_]injector(?:[-_].*)?\.jar(?:\.(?:disabled|old))?$/.test(name))) ||
    parts[0].startsWith('.battly') ||
    parts.some(
      (part) =>
        part === '.env' || part.startsWith('.env.') || /\.(bypack|tmp|log|lock)$/.test(part),
    )
  );
}

export function bypackDownloadUrl(value: unknown, provider: BypackRemote['provider']): string {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new Error('URL de mod inválida');
  }
  const url = new URL(value);
  const hosts =
    provider === 'modrinth'
      ? ['cdn.modrinth.com']
      : ['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net'];
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !hosts.includes(url.hostname)
  ) {
    throw new Error('El .bypack contiene una descarga fuera del proveedor permitido');
  }
  return url.toString();
}

export function portableInstance(value: unknown): InstanceDraft {
  const draft = normalizeInstanceDraft(value);
  return {
    ...draft,
    ...(draft.launchProfile
      ? {
          launchProfile: {
            ...draft.launchProfile,
            javaPath: '',
            javaVersion: 'automatic',
          },
        }
      : {}),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Manifiesto .bypack inválido');
  }
  return value as Record<string, unknown>;
}
export function parseBypack(value: unknown): BypackManifest {
  const raw = record(value);
  if (
    raw.author !== undefined &&
    (typeof raw.author !== 'string' ||
      raw.author.length > 254 ||
      [...raw.author].some((character) => character.charCodeAt(0) < 32))
  ) {
    throw new Error('Autor de .bypack inválido');
  }
  if (raw.format !== 'battly-bypack' || raw.version !== 1) {
    throw new Error('Versión de .bypack no compatible');
  }
  if (
    !Array.isArray(raw.files) ||
    !Array.isArray(raw.directories) ||
    raw.files.length + raw.directories.length > bypackLimits.entries
  ) {
    throw new Error('Demasiados archivos en el .bypack');
  }
  const paths = new Map<string, 'file' | 'directory'>();
  const add = (value: unknown, type: 'file' | 'directory'): string => {
    const path = bypackPath(value);
    const key = path.normalize('NFC').toLowerCase();
    if (excludeFromBypack(path, type === 'directory') || paths.has(key)) {
      throw new Error(`Ruta excluida o duplicada: ${path}`);
    }
    paths.set(key, type);
    return path;
  };
  const directories = raw.directories.map((path: unknown) => add(path, 'directory'));
  let total = 0;
  const files = raw.files.map((value: unknown): BypackFile => {
    const file = record(value);
    const path = add(file.path, 'file');
    if (
      !Number.isSafeInteger(file.size) ||
      Number(file.size) < 0 ||
      Number(file.size) > bypackLimits.fileBytes ||
      typeof file.sha512 !== 'string' ||
      !/^[a-f0-9]{128}$/.test(file.sha512)
    ) {
      throw new Error(`Archivo inválido: ${path}`);
    }
    total += Number(file.size);
    if (total > bypackLimits.totalBytes) {
      throw new Error('El .bypack supera el tamaño permitido');
    }
    let remote: BypackRemote | undefined;
    if (file.remote !== undefined) {
      const source = record(file.remote);
      if (source.provider !== 'modrinth' && source.provider !== 'curseforge') {
        throw new Error('Proveedor inválido');
      }
      if (
        typeof source.projectId !== 'string' ||
        typeof source.versionId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(source.projectId) ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(source.versionId)
      ) {
        throw new Error('Identificador de mod inválido');
      }
      remote = {
        provider: source.provider,
        projectId: source.projectId,
        versionId: source.versionId,
        url: bypackDownloadUrl(source.url, source.provider),
      };
    }
    return { path, size: Number(file.size), sha512: file.sha512, ...(remote ? { remote } : {}) };
  });
  for (const path of paths.keys()) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length++) {
      if (paths.get(parts.slice(0, length).join('/')) === 'file') {
        throw new Error('Conflicto entre archivo y carpeta');
      }
    }
  }
  return {
    format: 'battly-bypack',
    version: 1,
    instance: portableInstance(raw.instance),
    ...(typeof raw.author === 'string' && raw.author.trim() ? { author: raw.author.trim() } : {}),
    files,
    directories,
  };
}
