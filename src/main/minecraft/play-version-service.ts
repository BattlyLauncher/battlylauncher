import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import type {
  InstalledPlayVersion,
  LauncherVersionEntry,
  PlayRecentVersion,
  PlayVersionLaunchRequest,
  PlayVersionSnapshot,
} from '../../shared/minecraft/play-version-contract';
import type { JsonValue } from '../../shared/storage/legacy-storage';
import { writeFileAtomically } from '../files/atomic-file';
import { readProfileValuesFile } from '../storage/profile-values-file';
import { enqueueProfileWrite } from '../storage/profile-write-queue';

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;
const selectableLoaders = new Set([
  'fabric',
  'forge',
  'legacyfabric',
  'neoforge',
  'optifine',
  'quilt',
]);

export function customClientProfileDirectory(root: string, customId: string): string {
  if (!isAbsolute(root)) {
    throw new TypeError('Custom client root must be absolute');
  }
  if (!identifier.test(customId)) {
    throw new TypeError('Invalid custom version');
  }
  return resolve(root, 'client-profiles', customId);
}

function neoForgeMinecraftVersion(build: string): string | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(build);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major >= 26) {
    return match[3] && Number(match[3]) > 0 ? `${major}.${minor}.${match[3]}` : `${major}.${minor}`;
  }
  return major >= 20 ? `1.${major}${minor ? `.${minor}` : ''}` : null;
}

function loaderInstallation(
  loader: string,
  folder: string,
  knownMinecraftVersions: readonly string[],
): { readonly build: string; readonly minecraftVersion: string } | null {
  if (loader === 'neoforge') {
    const build = folder.replace(/^neoforge-/i, '');
    const minecraftVersion = neoForgeMinecraftVersion(build);
    return minecraftVersion ? { build, minecraftVersion } : null;
  }
  let minecraftVersion = [...knownMinecraftVersions]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => folder.toLowerCase().endsWith(`-${candidate.toLowerCase()}`));
  if (loader === 'fabric' || loader === 'legacyfabric' || loader === 'quilt') {
    minecraftVersion ??= folder.match(/^(?:fabric|quilt)-loader-[0-9.]+-(.+)$/i)?.[1];
    if (!minecraftVersion || !identifier.test(minecraftVersion)) {
      return null;
    }
    const prefix = loader === 'quilt' ? 'quilt-loader-' : 'fabric-loader-';
    const build = folder.slice(prefix.length, -(minecraftVersion.length + 1));
    return build && folder.toLowerCase().startsWith(prefix) ? { build, minecraftVersion } : null;
  }
  if (loader === 'optifine') {
    const base = [...knownMinecraftVersions]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => folder.toLowerCase().includes(candidate.toLowerCase()));
    if (!base) {
      return null;
    }
    const build = folder
      .replace(new RegExp(base.replaceAll('.', '\\.'), 'i'), '')
      .replace(/optifine|^[-_ ]+|[-_ ]+$/gi, '')
      .replace(/^hd[-_ ]*/i, '');
    return { build: build || 'latest', minecraftVersion: base };
  }
  if (loader !== 'forge') {
    return null;
  }
  const base = [...knownMinecraftVersions]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => folder.toLowerCase().startsWith(`${candidate.toLowerCase()}-forge`));
  if (!base) {
    return null;
  }
  let build = folder.slice(`${base}-forge`.length).replace(new RegExp(`^${base}-`, 'i'), '');
  if (build.startsWith('-')) {
    build = build.slice(1);
  }
  return build ? { build: `${base}-${build}`, minecraftVersion: base } : null;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 128 && !value.includes('\0')
    ? value.trim() || null
    : null;
}

export function validateLauncherVersionCatalog(value: unknown): readonly LauncherVersionEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid launcher versions catalog');
  }
  const versions = own(value as Record<string, unknown>, 'versions');
  if (!Array.isArray(versions) || versions.length > 2000) {
    throw new TypeError('Invalid launcher versions catalog');
  }
  return versions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const source = candidate as Record<string, unknown>;
    const version = optionalText(own(source, 'version'));
    const realVersion = optionalText(own(source, 'realVersion'));
    if (!version || !realVersion || !identifier.test(version) || !identifier.test(realVersion)) {
      return [];
    }
    return [
      {
        version,
        realVersion,
        name: optionalText(own(source, 'name')) ?? version,
        type: optionalText(own(source, 'type')) ?? '',
        folderName: optionalText(own(source, 'folderName')),
        requiredJavaVersion: optionalText(own(source, 'requiredJavaVersion')),
      },
    ];
  });
}

function recent(values: Readonly<Record<string, JsonValue>>): PlayRecentVersion[] {
  const raw = values.latest3Versions;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.slice(0, 3).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const source = candidate as Record<string, JsonValue>;
    const version = optionalText(source.version);
    const customVersion = optionalText(source.customVersion) ?? '';
    const dateOpened = optionalText(source.dateOpened);
    if (!version || !dateOpened) {
      return [];
    }
    return [
      {
        version,
        customVersion,
        dateOpened,
        isExtra: source.isExtra === true || source.isExtra === 'true',
        loader: optionalText(source.loader) ?? 'vanilla',
        loaderVersion: optionalText(source.loaderVersion) ?? '',
        requiredJavaVersion: optionalText(source.requiredJavaVersion) ?? '',
      },
    ];
  });
}

interface InstalledVersionMetadata {
  readonly baseVersion: string | null;
  readonly vanilla: boolean;
}

function officialClientUrl(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'launcher.mojang.com' || url.hostname === 'piston-data.mojang.com')
    );
  } catch {
    return false;
  }
}

function isVanillaMainClass(value: unknown): boolean {
  return value === 'net.minecraft.client.main.Main' || value === 'net.minecraft.client.Minecraft';
}

function inferredMinecraftVersion(...values: readonly (string | null)[]): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const matches = [
      ...value.matchAll(
        /(?:^|[^0-9])((?:1\.\d+(?:\.\d+)?|(?:2[6-9]|[3-9]\d)\.\d+(?:\.\d+)?))(?!\d)/g,
      ),
    ].map((match) => match[1]);
    if (matches.length) {
      return matches.at(-1) ?? null;
    }
  }
  return null;
}

async function installedVersionMetadata(
  versionsRoot: string,
  id: string,
): Promise<InstalledVersionMetadata> {
  try {
    const parsed = JSON.parse(
      await readFile(join(versionsRoot, id, `${id}.json`), 'utf8'),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { baseVersion: null, vanilla: false };
    }
    const source = parsed as Record<string, unknown>;
    const inherited = optionalText(own(source, 'inheritsFrom'));
    const legacyJar = optionalText(own(source, 'jar'));
    const manifestId = optionalText(own(source, 'id'));
    const mainClass = optionalText(own(source, 'mainClass'));
    const assets = optionalText(own(source, 'assets'));
    const explicitMinecraftVersion = optionalText(own(source, '_minecraftVersion'));
    const rawAssetIndex = own(source, 'assetIndex');
    const assetIndex =
      rawAssetIndex && typeof rawAssetIndex === 'object' && !Array.isArray(rawAssetIndex)
        ? optionalText(own(rawAssetIndex as Record<string, unknown>, 'id'))
        : null;
    const downloads = own(source, 'downloads');
    const client =
      downloads && typeof downloads === 'object' && !Array.isArray(downloads)
        ? own(downloads as Record<string, unknown>, 'client')
        : null;
    const clientUrl =
      client && typeof client === 'object' && !Array.isArray(client)
        ? own(client as Record<string, unknown>, 'url')
        : null;
    const vanilla =
      manifestId === id &&
      !inherited &&
      isVanillaMainClass(mainClass) &&
      officialClientUrl(clientUrl);
    return {
      baseVersion:
        inherited ??
        legacyJar ??
        (vanilla
          ? manifestId
          : inferredMinecraftVersion(explicitMinecraftVersion, manifestId, id, assetIndex, assets)),
      vanilla,
    };
  } catch {
    return { baseVersion: null, vanilla: false };
  }
}

export class PlayVersionService {
  readonly #profilePath: string;
  readonly #loaderRoot: string;
  readonly #versionsRoot: string;

  constructor(
    versionsRoot: string,
    profilePath: string,
    loaderRoot = join(versionsRoot, '..', 'loader'),
  ) {
    if (!isAbsolute(versionsRoot) || !isAbsolute(profilePath) || !isAbsolute(loaderRoot)) {
      throw new TypeError('Play version paths must be absolute');
    }
    this.#versionsRoot = versionsRoot;
    this.#profilePath = profilePath;
    this.#loaderRoot = loaderRoot;
  }

  async snapshot(catalog: readonly LauncherVersionEntry[]): Promise<PlayVersionSnapshot> {
    const [entries, values] = await Promise.all([
      readdir(this.#versionsRoot, { withFileTypes: true }).catch(() => []),
      readProfileValuesFile(this.#profilePath),
    ]);
    const installed: InstalledPlayVersion[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !identifier.test(entry.name)) {
        continue;
      }
      const exact = catalog.find(
        (candidate) => candidate.folderName === entry.name || candidate.version === entry.name,
      );
      const catalogNormal = catalog.some((candidate) => candidate.realVersion === entry.name);
      const metadata = catalogNormal
        ? { baseVersion: entry.name, vanilla: true }
        : await installedVersionMetadata(this.#versionsRoot, entry.name);
      const normal = catalogNormal || metadata.vanilla;
      const custom = Boolean(exact?.folderName) || !normal;
      const compatibleLoaders = custom
        ? []
        : [
            'vanilla',
            ...new Set(
              catalog
                .filter(
                  (candidate) =>
                    candidate.realVersion === entry.name &&
                    selectableLoaders.has(candidate.type.toLowerCase()),
                )
                .map((candidate) => candidate.type.toLowerCase()),
            ),
          ];
      const detectedLoader = ['legacyfabric', 'fabric', 'quilt', 'neoforge', 'forge']
        .sort((a, b) => b.length - a.length)
        .find((loader) => entry.name.toLowerCase().includes(loader));
      const detected =
        custom && detectedLoader
          ? loaderInstallation(
              detectedLoader,
              entry.name,
              metadata.baseVersion ? [metadata.baseVersion] : [],
            )
          : null;
      installed.push({
        installedAt: await stat(join(this.#versionsRoot, entry.name, `${entry.name}.json`)).then(
          (info) => info.mtimeMs,
          () => 0,
        ),
        id: entry.name,
        // Profiles in the public versions directory are launched by their exact ID.
        // Loader installations managed under loaderRoot are grouped separately below.
        custom,
        compatibleLoaders,
        loader: detected ? detectedLoader! : 'vanilla',
        loaderVersion: detected?.build ?? '',
        requiredJavaVersion: exact?.requiredJavaVersion ?? null,
        version:
          detected?.minecraftVersion ??
          (custom ? (metadata.baseVersion ?? entry.name) : entry.name),
      });
    }
    const knownMinecraftVersions = installed
      .filter((entry) => !entry.custom)
      .map((entry) => entry.version);
    const sharedVersionsRoot = join(this.#loaderRoot, 'versions');
    const sharedLoaderEntries = await readdir(sharedVersionsRoot, {
      withFileTypes: true,
    }).catch(() => []);
    const loaderNames = [...selectableLoaders].sort((a, b) => b.length - a.length);
    for (const loader of selectableLoaders) {
      const versionsRoot = join(this.#loaderRoot, loader, 'versions');
      const loaderEntries = await readdir(versionsRoot, {
        withFileTypes: true,
      }).catch(() => []);
      const candidates = [
        ...loaderEntries.map((entry) => ({ entry, root: versionsRoot })),
        ...sharedLoaderEntries
          .filter(
            (entry) =>
              loaderNames.find((name) => entry.name.toLowerCase().includes(name)) === loader,
          )
          .map((entry) => ({ entry, root: sharedVersionsRoot })),
      ];
      for (const { entry, root } of candidates) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !identifier.test(entry.name)) {
          continue;
        }
        const metadata = await installedVersionMetadata(root, entry.name);
        const parsed = loaderInstallation(loader, entry.name, [
          ...knownMinecraftVersions,
          ...(metadata.baseVersion ? [metadata.baseVersion] : []),
        ]);
        if (!parsed) {
          continue;
        }
        const minecraftVersion = metadata.baseVersion ?? parsed.minecraftVersion;
        installed.push({
          installedAt: await stat(join(root, entry.name, `${entry.name}.json`)).then(
            (info) => info.mtimeMs,
            () => 0,
          ),
          id: entry.name,
          custom: false,
          compatibleLoaders: [],
          loader,
          loaderVersion: parsed.build,
          requiredJavaVersion:
            catalog.find(
              (candidate) =>
                candidate.realVersion === minecraftVersion &&
                candidate.type.toLowerCase() === loader,
            )?.requiredJavaVersion ?? null,
          version: minecraftVersion,
        });
      }
    }
    const preferredById = new Map<string, InstalledPlayVersion>();
    for (const entry of installed) {
      const current = preferredById.get(entry.id);
      if (!current) {
        preferredById.set(entry.id, entry);
      }
    }
    const distinctInstalled = [...preferredById.values()];
    const withCompatibility = distinctInstalled.map((entry) => ({
      ...entry,
      compatibleLoaders:
        entry.loader === 'vanilla' && !entry.custom
          ? [
              'vanilla',
              ...new Set(
                distinctInstalled
                  .filter(
                    (candidate) =>
                      candidate.version === entry.version && candidate.loader !== 'vanilla',
                  )
                  .map((candidate) => candidate.loader),
              ),
            ]
          : [],
    }));
    withCompatibility.sort((left, right) =>
      left.id.localeCompare(right.id, undefined, { numeric: true }),
    );
    const installedRecent = recent(values).flatMap((entry) => {
      const matches = (candidate: InstalledPlayVersion): boolean => {
        if (entry.isExtra) {
          return candidate.id === entry.customVersion;
        }
        return (
          candidate.version === entry.version &&
          candidate.loader === entry.loader &&
          (!entry.loaderVersion ||
            entry.loaderVersion === 'latest' ||
            candidate.loaderVersion === entry.loaderVersion)
        );
      };
      // Older launchers recorded the loader without a build, including profiles
      // installed directly in versions/. Prefer a managed installation if both exist.
      const installedEntry =
        withCompatibility.find((candidate) => !candidate.custom && matches(candidate)) ??
        withCompatibility.find(matches);
      if (!installedEntry) {
        return [];
      }
      return [
        {
          ...entry,
          version: installedEntry.version,
          customVersion:
            installedEntry.custom || installedEntry.loader === 'optifine' ? installedEntry.id : '',
          isExtra: installedEntry.custom,
          loader: installedEntry.loader,
          loaderVersion: installedEntry.loaderVersion,
          requiredJavaVersion: installedEntry.requiredJavaVersion ?? entry.requiredJavaVersion,
        },
      ];
    });
    return { installed: withCompatibility, recent: installedRecent };
  }

  async customBaseVersion(id: string): Promise<string | null> {
    if (!identifier.test(id)) {
      throw new TypeError('Invalid custom version');
    }
    return (await installedVersionMetadata(this.#versionsRoot, id)).baseVersion;
  }

  async recordLaunch(request: PlayVersionLaunchRequest): Promise<void> {
    return enqueueProfileWrite(this.#profilePath, async () => {
      const values = await readProfileValuesFile(this.#profilePath);
      const uniqueId =
        request.customVersion || `${request.version}-${request.loader}-${request.loaderVersion}`;
      const previous = recent(values).filter((entry) => {
        const entryId =
          entry.customVersion || `${entry.version}-${entry.loader}-${entry.loaderVersion}`;
        if (entryId === uniqueId) {
          return false;
        }
        if (entry.isExtra || request.custom) {
          return true;
        }
        const sameVersion = entry.version === request.version && entry.loader === request.loader;
        const unspecifiedBuild =
          !entry.loaderVersion ||
          entry.loaderVersion === 'latest' ||
          !request.loaderVersion ||
          request.loaderVersion === 'latest';
        return !(sameVersion && unspecifiedBuild);
      });
      const latest3Versions: JsonValue[] = [
        {
          uniqueId,
          version: request.version,
          customVersion: request.customVersion,
          dateOpened: new Date().toISOString(),
          isExtra: request.custom ? 'true' : 'false',
          loader: request.loader,
          loaderVersion: request.loaderVersion,
          requiredJavaVersion: request.requiredJavaVersion,
        },
        ...previous.map((entry) => ({
          uniqueId:
            entry.customVersion || `${entry.version}-${entry.loader}-${entry.loaderVersion}`,
          version: entry.version,
          customVersion: entry.customVersion,
          dateOpened: entry.dateOpened,
          isExtra: entry.isExtra ? 'true' : 'false',
          loader: entry.loader,
          loaderVersion: entry.loaderVersion,
          requiredJavaVersion: entry.requiredJavaVersion,
        })),
      ].slice(0, 3);
      await writeFileAtomically(
        this.#profilePath,
        `${JSON.stringify({ ...values, latest3Versions }, null, 2)}\n`,
      );
    });
  }
}
