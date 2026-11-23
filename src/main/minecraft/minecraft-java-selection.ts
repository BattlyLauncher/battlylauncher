import { readBoundedResponse } from '../network/read-bounded-response';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ManagedJavaMajor } from '../../shared/settings/java-runtime-contract';
import { networkAvailable } from '../network/connectivity';

const supportedMajors = new Set<ManagedJavaMajor>([8, 16, 17, 21, 25]);
const versionIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;
const remoteMajors = new Map<string, Promise<ManagedJavaMajor | null>>();
let officialVersions: Promise<readonly { id: string; url: string }[]> | undefined;
let officialVersionsExpiresAt = 0;

function managedMajor(value: unknown): ManagedJavaMajor | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value.match(/\d+/)?.[0] ?? '', 10)
        : Number.NaN;
  return Number.isInteger(parsed) && supportedMajors.has(parsed as ManagedJavaMajor)
    ? (parsed as ManagedJavaMajor)
    : null;
}

function releaseParts(version: string): readonly number[] {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
  return match ? match.slice(1).map((part) => Number.parseInt(part ?? '0', 10)) : [];
}

export function inferMinecraftJavaMajor(version: string): ManagedJavaMajor {
  const [major = 0, minor = 0, patch = 0] = releaseParts(version);
  if (major >= 26) {
    return 25;
  }
  if (major === 1 && (minor > 20 || (minor === 20 && patch >= 5))) {
    return 21;
  }
  if (major === 1 && minor >= 18) {
    return 17;
  }
  if (major === 1 && minor === 17) {
    return 16;
  }
  return 8;
}

export function isLabyModVersion(versionId: string): boolean {
  return /^labymod(?:-|$)/i.test(versionId);
}

function forcedClientJavaMajor(versionId: string): ManagedJavaMajor | null {
  if (
    /^battly(?:-client)?[- ](?:26\.3|1\.8\.9|1\.12\.2|1\.16\.5|1\.20\.1|1\.21\.11)$/i.test(
      versionId,
    )
  ) {
    return 25;
  }
  if (!isLabyModVersion(versionId)) {
    return null;
  }
  const embeddedVersions: string[] = versionId.match(/\d+(?:\.\d+){1,2}/g) ?? [];
  const minecraftVersion = [...embeddedVersions]
    .reverse()
    .find((candidate) => candidate.startsWith('1.') || Number.parseInt(candidate, 10) >= 26);
  return minecraftVersion && inferMinecraftJavaMajor(minecraftVersion) === 25 ? 25 : 21;
}

function runtimeDirectoryMajor(name: string): ManagedJavaMajor | null {
  const match = /^(?:jre|java)-(?:1\.)?(\d+)/i.exec(name);
  return managedMajor(match?.[1]);
}

async function declaredMajor(
  versionsRoots: readonly string[],
  versionId: string,
  visited = new Set<string>(),
): Promise<ManagedJavaMajor | null> {
  if (!versionIdentifier.test(versionId) || visited.has(versionId) || visited.size >= 16) {
    return null;
  }
  visited.add(versionId);
  for (const versionsRoot of versionsRoots) {
    try {
      const value = JSON.parse(
        await readFile(join(versionsRoot, versionId, `${versionId}.json`), 'utf8'),
      ) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const javaVersion = value.javaVersion as Record<string, unknown> | undefined;
      const major = managedMajor(javaVersion?.majorVersion);
      if (major) {
        return major;
      }
      if (typeof value.inheritsFrom === 'string') {
        const inherited = await declaredMajor(versionsRoots, value.inheritsFrom, visited);
        if (inherited) {
          return inherited;
        }
      }
    } catch {
      // An inherited manifest may live in the shared game directory instead.
    }
  }
  return null;
}

async function officialJson(url: string): Promise<Record<string, unknown>> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    !['piston-meta.mojang.com', 'launchermeta.mojang.com'].includes(parsed.hostname)
  ) {
    throw new Error('URL de metadatos de Minecraft no válida');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`Metadatos de Minecraft: HTTP ${response.status}`);
  }
  const content = await readBoundedResponse(
    response,
    8 * 1024 * 1024,
    'Metadatos de Minecraft demasiado grandes',
  );
  return JSON.parse(content) as Record<string, unknown>;
}

async function loadOfficialVersions(
  refresh = false,
): Promise<readonly { id: string; url: string }[]> {
  if (refresh || Date.now() >= officialVersionsExpiresAt) {
    officialVersions = undefined;
  }
  if (!officialVersions) {
    officialVersionsExpiresAt = Date.now() + 5 * 60_000;
    officialVersions = officialJson(
      'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    )
      .then((manifest) => {
        if (!Array.isArray(manifest.versions)) {
          throw new Error('Índice de Minecraft no válido');
        }
        return (manifest.versions as unknown[]).filter(
          (value): value is { id: string; url: string } =>
            value !== null &&
            typeof value === 'object' &&
            'id' in value &&
            typeof value.id === 'string' &&
            'url' in value &&
            typeof value.url === 'string',
        );
      })
      .catch((error: unknown) => {
        officialVersions = undefined;
        throw error;
      });
  }
  return officialVersions;
}

async function officialMajor(versionId: string): Promise<ManagedJavaMajor | null> {
  if (!networkAvailable()) {
    return null;
  }
  let pending = remoteMajors.get(versionId);
  if (!pending) {
    pending = (async () => {
      let version = (await loadOfficialVersions()).find((item) => item.id === versionId);
      if (!version) {
        version = (await loadOfficialVersions(true)).find((item) => item.id === versionId);
      }
      if (!version) {
        return null;
      }
      const metadata = await officialJson(version.url);
      const javaVersion = metadata.javaVersion as Record<string, unknown> | undefined;
      return managedMajor(javaVersion?.majorVersion) ?? 8;
    })().catch(() => {
      remoteMajors.delete(versionId);
      return null;
    });
    remoteMajors.set(versionId, pending);
    void pending.then((major) => {
      if (major === null) {
        remoteMajors.delete(versionId);
      }
    });
  }
  return pending;
}

async function executable(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

export interface MinecraftJavaSelection {
  readonly major: ManagedJavaMajor;
  readonly path: string | null;
  readonly maximumMajor?: ManagedJavaMajor;
}

export async function ensureMinecraftJava(
  resolveSelection: () => Promise<MinecraftJavaSelection>,
  install: (major: ManagedJavaMajor) => Promise<unknown>,
): Promise<MinecraftJavaSelection> {
  const first = await resolveSelection();
  if (first.path) {
    return first;
  }
  await install(first.major);
  const installed = await resolveSelection();
  if (!installed.path) {
    throw new Error(`Java ${installed.major} no se pudo instalar`);
  }
  return installed;
}

export async function resolveMinecraftJava(
  contentRoot: string,
  versionId: string,
  requiredJavaVersion = '',
  versionContentRoot = contentRoot,
  baseVersionId = versionId,
): Promise<MinecraftJavaSelection> {
  const versionsRoots = [...new Set([versionContentRoot, contentRoot])].map((root) =>
    join(root, 'versions'),
  );
  const declared = await declaredMajor(versionsRoots, versionId);
  const baseDeclared =
    baseVersionId === versionId ? declared : await declaredMajor(versionsRoots, baseVersionId);
  const baseMajor =
    baseDeclared ??
    (await officialMajor(baseVersionId)) ??
    (/^\d{2}w\d{2}[a-z]$/i.test(baseVersionId) ? null : inferMinecraftJavaMajor(baseVersionId));
  // A loader/client may require a newer JVM than the Minecraft profile it inherits.
  const requirements = [
    baseMajor,
    declared,
    forcedClientJavaMajor(versionId),
    managedMajor(requiredJavaVersion),
  ].filter((value): value is ManagedJavaMajor => value !== null);
  // LabyMod 3 uses the original LaunchWrapper, which casts the application
  // classloader to URLClassLoader. Java 9+ cannot run it, even if a recent
  // launch entry saved Java 21 while sharing LabyMod 4's runtime rule.
  const legacyLabyMod = /^labymod-3-1\.(?:8\.9|12(?:\.2)?)$/i.test(versionId);
  const major = legacyLabyMod
    ? 8
    : requirements.length
      ? (Math.max(...requirements) as ManagedJavaMajor)
      : null;
  const compatibility = legacyLabyMod ? { maximumMajor: 8 as const } : {};
  if (!major) {
    throw new Error(
      `No se pudo obtener la versión de Java necesaria para ${baseVersionId}. Comprueba la conexión e inténtalo de nuevo.`,
    );
  }
  const executableName = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const runtimeRoot = join(contentRoot, 'runtime');
  const managedPath = join(runtimeRoot, `java-${major}`, 'bin', executableName);
  if (await executable(managedPath)) {
    return { major, path: managedPath, ...compatibility };
  }

  const directories = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  const candidates = directories
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        runtimeDirectoryMajor(entry.name) === major,
    )
    .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true }))
    .map((entry) => join(runtimeRoot, entry.name, 'bin', executableName));
  for (const candidate of candidates) {
    if (await executable(candidate)) {
      return { major, path: candidate, ...compatibility };
    }
  }
  return { major, path: null, ...compatibility };
}
