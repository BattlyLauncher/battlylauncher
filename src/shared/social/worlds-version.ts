import type {
  InstalledPlayVersion,
  PlayVersionLaunchRequest,
} from '../minecraft/play-version-contract';
import type { InstanceSummary } from '../minecraft/instance';

export interface WorldsVersion {
  version: string;
  loader: string;
  loaderVersion: string;
  label: string;
}
const names: Record<string, string> = {
  vanilla: 'Minecraft',
  fabric: 'Fabric',
  legacyfabric: 'Legacy Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine',
};
const game =
  '(?:\\d{2}w\\d{2}[a-z]|(?:1\\.\\d{1,2}|[2-9]\\d\\.\\d{1,2})(?:\\.\\d{1,2})?(?:[- ](?:pre(?:-release)?|rc|snapshot)[- ]?\\d+)?)';

/** A custom ID is opaque: never interpret it as a filesystem path or download URL. */
export function isWorldsVersionId(value: string): boolean {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,95}$/.test(value) &&
    !value.includes('..')
  );
}

export function normalizeWorldsOptiFineBuild(value: string, version: string): string {
  let build = value.replace(/\.jar$/i, '').replace(/^preview[_-]/i, '');
  build = build.replace(/^OptiFine[_ -]*/i, '');
  if (build.startsWith(version)) {
    build = build.slice(version.length).replace(/^[_ -]+/, '');
  }
  return build.replace(/^HD[_ -]*/i, '').replace(/[ -]+/g, '_');
}

/** Parse a room label, not an arbitrary client/modpack title. Unknown labels require selection. */
export function parseWorldsVersion(raw: string): WorldsVersion | null {
  if (typeof raw !== 'string' || raw.length > 128) {
    return null;
  }
  const input = raw
    .trim()
    .replace(/\.jar$/i, '')
    .replace(/^preview[_-](?=OptiFine)/i, '')
    .replace(/\s+/g, ' ')
    .replace(/-OptiFine_OptiFine_/i, '-OptiFine_');
  let version: string, loader: string, loaderVersion: string;
  const fabric = input.match(
    new RegExp(`^(?:Minecraft )?(legacyfabric|fabric|quilt)-loader-([\\w.+-]+?)-(${game})$`, 'i'),
  );
  const optifineWords = input.match(
    new RegExp(`^(?:OptiFine )?(${game})[ _-]+(?:OptiFine[ _-]+)?HD[ _-]+([\\w -]+)$`, 'i'),
  );
  const optifinePrefix = input.match(
    new RegExp(`^OptiFine[_-](${game})[_-](?:HD[_-])?([\\w.+-]+)$`, 'i'),
  );
  const neoPrefix = input.match(/^neoforge-((2[0-5])\.(\d+)\.[\w.+-]+)$/i);
  const forgePrefix = input.match(new RegExp(`^forge-(${game})-(.+)$`, 'i'));
  const forge = input.match(
    new RegExp(`^(?:Minecraft )?(${game})-(neoforge|forge)-?([\\w.+-]+)?$`, 'i'),
  );
  const optifine = input.match(
    new RegExp(`^(?:Minecraft )?(${game})[-_ ]OptiFine(?:[-_]([\\w.+-]+))?$`, 'i'),
  );
  if (optifineWords) {
    version = optifineWords[1];
    loader = 'optifine';
    loaderVersion = optifineWords[2];
  } else if (optifinePrefix) {
    version = optifinePrefix[1];
    loader = 'optifine';
    loaderVersion = optifinePrefix[2];
  } else if (neoPrefix) {
    version = `1.${neoPrefix[2]}.${neoPrefix[3]}`;
    loader = 'neoforge';
    loaderVersion = neoPrefix[1];
  } else if (fabric) {
    [, loader, loaderVersion, version] = fabric;
  } else if (forgePrefix) {
    version = forgePrefix[1];
    loader = 'forge';
    loaderVersion = forgePrefix[2];
  } else if (forge) {
    version = forge[1];
    loader = forge[2];
    loaderVersion = forge[3] || '';
  } else if (optifine) {
    version = optifine[1];
    loader = 'optifine';
    loaderVersion = optifine[2] || '';
  } else {
    const label = input.match(
      new RegExp(
        `^(?:(Minecraft|Vanilla|Legacy ?Fabric|Fabric|Quilt|NeoForge|Forge|OptiFine)[: -]+)?(${game})(?:[ -]+(Legacy ?Fabric|Fabric|Quilt|NeoForge|Forge|OptiFine))?(?: \\(([\\w.+_-]+)\\))?$`,
        'i',
      ),
    );
    if (!label) {
      return null;
    }
    version = label[2];
    loader = (label[3] || label[1] || 'vanilla').replace(/ /g, '').toLowerCase();
    loaderVersion = label[4] || '';
    if (loader === 'minecraft') {
      loader = 'vanilla';
    }
  }
  loader = loader.toLowerCase();
  if (loader === 'optifine') {
    loaderVersion = normalizeWorldsOptiFineBuild(loaderVersion, version);
  }
  version = version
    .toLowerCase()
    .replace(/ pre(?:-release)? ?/, '-pre-')
    .replace(/ rc ?/, '-rc');
  if (loader === 'forge' && loaderVersion && !loaderVersion.startsWith(version + '-')) {
    loaderVersion = version + '-' + loaderVersion;
  }
  return {
    version,
    loader,
    loaderVersion,
    label: `${names[loader]} ${version}${loaderVersion ? ` (${loaderVersion})` : ''}`,
  };
}

export function matchesWorldsVersion(instance: InstanceSummary, target: WorldsVersion): boolean {
  const detected = parseWorldsVersion(instance.version);
  const version = detected?.version || instance.version.toLowerCase();
  const loader = (instance.loader || detected?.loader || 'vanilla').toLowerCase();
  let build = instance.loaderVersion || detected?.loaderVersion || '';
  if (loader === 'forge' && build && !build.startsWith(version + '-')) {
    build = version + '-' + build;
  }
  if (loader === 'optifine') {
    build = normalizeWorldsOptiFineBuild(build, version);
  }
  return (
    version === target.version &&
    loader === target.loader &&
    (!target.loaderVersion || build.toLowerCase() === target.loaderVersion.toLowerCase())
  );
}

/** IDs consumed by Mobile's VersionResolver and MinecraftDownloader, never display labels. */
export function worldsVersionId(raw: string): string {
  const v = parseWorldsVersion(raw);
  if (!v && isWorldsVersionId(raw)) {
    return raw;
  }
  if (!v) {
    throw new Error(
      'No se reconoce la versión del mundo. Selecciona una versión de Minecraft válida.',
    );
  }
  const build = v.loaderVersion === 'latest' ? '' : v.loaderVersion;
  switch (v.loader) {
    case 'vanilla':
      return v.version;
    case 'fabric':
    case 'legacyfabric':
    case 'quilt':
      return build ? `${v.loader}-loader-${build}-${v.version}` : `${v.version}-${v.loader}`;
    case 'forge':
      return `${v.version}-forge${build ? '-' + build.replace(v.version + '-', '') : ''}`;
    case 'neoforge':
      return `${v.version}-neoforge${build ? '-' + build : ''}`;
    case 'optifine':
      return `${v.version}-OptiFine${build ? '_HD_' + build : ''}`;
    default:
      throw new Error('Cargador no reconocido');
  }
}

export function findWorldsPlayVersion(
  raw: string,
  installed: readonly InstalledPlayVersion[],
): InstalledPlayVersion | undefined {
  const target = parseWorldsVersion(raw);
  return (
    installed.find((entry) => entry.id === raw) ||
    (target
      ? installed.find((entry) => {
          const parsed = parseWorldsVersion(entry.id);
          const loader = entry.custom ? parsed?.loader || entry.loader : entry.loader;
          const version = parsed?.version || entry.version;
          let build = entry.loaderVersion || parsed?.loaderVersion || '';
          if (loader === 'forge' && build && !build.startsWith(version + '-')) {
            build = version + '-' + build;
          }
          if (loader === 'optifine') {
            build = normalizeWorldsOptiFineBuild(build, version);
          }
          return (
            version === target.version &&
            loader === target.loader &&
            (!target.loaderVersion || build.toLowerCase() === target.loaderVersion.toLowerCase())
          );
        })
      : undefined)
  );
}
export function worldsPlayRequest(
  raw: string,
  installed: readonly InstalledPlayVersion[],
  address: string,
): PlayVersionLaunchRequest {
  const entry = findWorldsPlayVersion(raw, installed),
    target = parseWorldsVersion(raw) || (entry ? parseWorldsVersion(entry.id) : null);
  if (!target && !entry) {
    throw new Error('No se reconoce esta versión. Selecciona una versión instalada.');
  }
  const connection = address.match(/^127\.0\.0\.1:(\d{1,5})$/);
  if (address && !connection) {
    throw new Error('La dirección de la sala no es válida');
  }
  return {
    version: target?.version || entry!.version,
    custom: Boolean(entry?.custom && !target),
    customVersion: entry?.custom && !target ? entry.id : '',
    installedVersionId: entry && (entry.custom || target?.loader === 'optifine') ? entry.id : '',
    loader: target?.loader || entry!.loader,
    loaderVersion: target?.loaderVersion || entry?.loaderVersion || 'latest',
    requiredJavaVersion: entry?.requiredJavaVersion || '',
    safeMode: false,
    directConnect: connection ? { host: '127.0.0.1', port: Number(connection[1]) } : null,
  };
}
