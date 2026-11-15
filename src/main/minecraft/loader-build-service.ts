import { readBoundedResponse } from '../network/read-bounded-response';
import type {
  LoaderBuild,
  LoaderGameVersion,
  LoaderGameVersionSnapshot,
  LoaderBuildSnapshot,
  MinecraftLoaderKind,
} from '../../shared/minecraft/loader-build-contract';

import { fetchOptiFineCatalog } from './optifine-catalog';

type Fetch = typeof fetch;

const maximumBuilds = 2_000;
const buildPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,127}$/;
const gameVersionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function validBuild(value: unknown): string | null {
  return typeof value === 'string' && buildPattern.test(value) ? value : null;
}

function unique(builds: readonly LoaderBuild[]): readonly LoaderBuild[] {
  const seen = new Set<string>();
  return builds.filter((build) => {
    if (seen.has(build.version)) {
      return false;
    }
    seen.add(build.version);
    return true;
  });
}

function uniqueGameVersions(versions: readonly LoaderGameVersion[]): readonly LoaderGameVersion[] {
  const seen = new Set<string>();
  return versions.filter((entry) => {
    if (seen.has(entry.version)) {
      return false;
    }
    seen.add(entry.version);
    return true;
  });
}

function gameVersion(value: unknown): string | null {
  return typeof value === 'string' && gameVersionPattern.test(value) ? value : null;
}

function minecraftFromNeoForge(version: string): string | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
    return null;
  }
  if (major >= 26) {
    const patch = Number(match[3]);
    return Number.isSafeInteger(patch) && patch > 0
      ? `${major}.${minor}.${patch}`
      : `${major}.${minor}`;
  }
  return major >= 20 ? `1.${major}.${minor}` : null;
}

function minecraftFromLegacyNeoForge(version: string): string | null {
  const match = /^(1\.\d+(?:\.\d+)?)-/.exec(version);
  return match ? gameVersion(match[1]) : null;
}

export class LoaderBuildService {
  readonly #cache = new Map<
    string,
    { readonly expiresAt: number; readonly value: Promise<unknown> }
  >();

  constructor(private readonly fetcher: Fetch = fetch) {}

  #cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.#cache.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return existing.value as Promise<T>;
    }
    const value = load().catch((error) => {
      if (this.#cache.get(key)?.value === value) {
        this.#cache.delete(key);
      }
      throw error;
    });
    this.#cache.set(key, { expiresAt: Date.now() + 5 * 60_000, value });
    return value;
  }

  async list(loader: MinecraftLoaderKind, minecraftVersion: string): Promise<LoaderBuildSnapshot> {
    return this.#cached(`builds:${loader}:${minecraftVersion}`, async () => {
      const builds =
        loader === 'optifine'
          ? (await this.#optifine()).filter((entry) => entry.minecraftVersion === minecraftVersion)
          : loader === 'forge'
            ? await this.#forge(minecraftVersion)
            : loader === 'fabric'
              ? await this.#fabric(minecraftVersion)
              : loader === 'legacyfabric'
                ? await this.#legacyFabric(minecraftVersion)
                : loader === 'quilt'
                  ? await this.#quilt(minecraftVersion)
                  : await this.#neoforge(minecraftVersion);
      return { loader, minecraftVersion, builds: unique(builds).slice(0, maximumBuilds) };
    });
  }

  async gameVersions(loader: MinecraftLoaderKind): Promise<LoaderGameVersionSnapshot> {
    return this.#cached(`game-versions:${loader}`, async () => {
      const versions =
        loader === 'optifine'
          ? (await this.#optifine()).map((entry) => ({
              version: entry.minecraftVersion,
              stable: entry.isStable,
            }))
          : loader === 'forge'
            ? await this.#forgeGameVersions()
            : loader === 'fabric'
              ? await this.#fabricGameVersions('https://meta.fabricmc.net/v2/versions')
              : loader === 'legacyfabric'
                ? await this.#fabricGameVersions('https://meta.legacyfabric.net/v2/versions')
                : loader === 'neoforge'
                  ? await this.#neoForgeGameVersions()
                  : await this.#fabricGameVersions('https://meta.quiltmc.org/v3/versions');
      return { loader, versions: uniqueGameVersions(versions).slice(0, maximumBuilds) };
    });
  }

  async #json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Loader catalog request failed (${response.status})`);
    }
    return JSON.parse(
      await readBoundedResponse(response, 8 * 1024 * 1024, 'Loader catalog response is too large'),
    ) as unknown;
  }

  #optifine() {
    return this.#cached('optifine-catalog', () => fetchOptiFineCatalog(this.fetcher));
  }

  async #forge(minecraftVersion: string): Promise<readonly LoaderBuild[]> {
    const value = object(
      await this.#json(
        'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
      ),
    );
    const versions = own(value, minecraftVersion);
    if (!Array.isArray(versions)) {
      return [];
    }
    return versions
      .slice(0, maximumBuilds)
      .reverse()
      .flatMap((candidate) => {
        const version = validBuild(candidate);
        return version ? [{ version, isStable: true }] : [];
      });
  }

  async #fabric(minecraftVersion: string): Promise<readonly LoaderBuild[]> {
    const value = await this.#json(
      `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value.slice(0, maximumBuilds).flatMap((candidate) => {
      const loader = object(own(object(candidate), 'loader'));
      const version = validBuild(own(loader, 'version'));
      return version ? [{ version, isStable: own(loader, 'stable') === true }] : [];
    });
  }

  async #legacyFabric(minecraftVersion: string): Promise<readonly LoaderBuild[]> {
    const value = await this.#json(
      `https://meta.legacyfabric.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value.slice(0, maximumBuilds).flatMap((candidate) => {
      const loader = object(own(object(candidate), 'loader'));
      const version = validBuild(own(loader, 'version'));
      return version ? [{ version, isStable: own(loader, 'stable') === true }] : [];
    });
  }

  async #quilt(minecraftVersion: string): Promise<readonly LoaderBuild[]> {
    const value = await this.#json(
      `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}`,
    );
    if (!Array.isArray(value)) {
      return [];
    }
    return value.slice(0, maximumBuilds).flatMap((candidate) => {
      const loader = object(own(object(candidate), 'loader'));
      const version = validBuild(own(loader, 'version'));
      return version ? [{ version, isStable: true }] : [];
    });
  }

  async #neoforge(minecraftVersion: string): Promise<readonly LoaderBuild[]> {
    const [currentValue, legacyValue] = await Promise.all([
      this.#json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'),
      this.#json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge'),
    ]);
    return [
      ...this.#neoForgeVersions(currentValue, minecraftVersion, false),
      ...this.#neoForgeVersions(legacyValue, minecraftVersion, true),
    ];
  }

  #neoForgeVersions(
    value: unknown,
    minecraftVersion: string,
    legacy: boolean,
  ): readonly LoaderBuild[] {
    const versions = own(object(value), 'versions');
    if (!Array.isArray(versions)) {
      return [];
    }
    return versions
      .slice(0, maximumBuilds)
      .reverse()
      .flatMap((candidate) => {
        const version = validBuild(candidate);
        const matchingMinecraft = version
          ? legacy
            ? minecraftFromLegacyNeoForge(version)
            : minecraftFromNeoForge(version)
          : null;
        return version && matchingMinecraft === minecraftVersion
          ? [{ version, isStable: !version.includes('-beta') }]
          : [];
      });
  }

  async #forgeGameVersions(): Promise<readonly LoaderGameVersion[]> {
    const value = object(
      await this.#json(
        'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
      ),
    );
    return Object.keys(value)
      .reverse()
      .flatMap((candidate) => {
        const version = gameVersion(candidate);
        return version ? [{ version, stable: true }] : [];
      });
  }

  async #fabricGameVersions(url: string): Promise<readonly LoaderGameVersion[]> {
    const value = await this.#json(url);
    const records = Array.isArray(value) ? value : own(object(value), 'game');
    if (!Array.isArray(records)) {
      return [];
    }
    return records.slice(0, maximumBuilds).flatMap((candidate) => {
      const entry = object(candidate);
      const version = gameVersion(own(entry, 'version'));
      return version ? [{ version, stable: own(entry, 'stable') === true }] : [];
    });
  }

  async #neoForgeGameVersions(): Promise<readonly LoaderGameVersion[]> {
    const [currentValue, legacyValue] = await Promise.all([
      this.#json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'),
      this.#json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge'),
    ]);
    const convert = (value: unknown, legacy: boolean): LoaderGameVersion[] => {
      const versions = own(object(value), 'versions');
      if (!Array.isArray(versions)) {
        return [];
      }
      return versions
        .slice(0, maximumBuilds)
        .reverse()
        .flatMap((candidate) => {
          const build = validBuild(candidate);
          const version = build
            ? legacy
              ? minecraftFromLegacyNeoForge(build)
              : minecraftFromNeoForge(build)
            : null;
          return version ? [{ version, stable: !build?.includes('-beta') }] : [];
        });
    };
    return [...convert(currentValue, false), ...convert(legacyValue, true)];
  }
}
