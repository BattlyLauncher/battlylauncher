import { readBoundedResponse } from '../network/read-bounded-response';
import {
  paperMinecraftVersion,
  type ServerSoftwareAvailability,
  type ServerSoftwareKind,
} from '../../shared/servers/server-contract';

const maximumMetadataBytes = 8 * 1024 * 1024;
class MissingArtifact extends Error {}
function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

export interface ModloaderInstallerArtifact {
  readonly build: string;
  readonly kind: 'forge' | 'neoforge';
  readonly sha1: string;
  readonly url: string;
}

export interface ServerModloaderCatalogOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly forgeMavenUrl?: string;
  readonly forgePromotionsUrl?: string;
  readonly neoForgeMavenUrl?: string;
}

function secureUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new TypeError('Modloader source must use HTTPS');
  }
  return url.href;
}

function safeVersion(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9.+_-]{1,128}$/.test(value)) {
    throw new TypeError(`Invalid ${label} version`);
  }
  return value;
}

async function boundedText(response: Response, label: string): Promise<string> {
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }
  return readBoundedResponse(response, maximumMetadataBytes, `${label} exceeds its size limit`);
}

function neoForgePrefix(gameVersion: string): string {
  const match = /^(?:1\.)?(\d+)(?:\.(\d+))?$/.exec(gameVersion);
  if (!match?.[1]) {
    throw new TypeError('Invalid Minecraft version for NeoForge');
  }
  const generation = Number(match[1]);
  const patch = Number(match[2] ?? 0);
  if (!Number.isInteger(generation) || !Number.isInteger(patch)) {
    throw new TypeError('Invalid Minecraft version for NeoForge');
  }
  return `${generation}.${patch}.`;
}

export class ServerModloaderCatalog {
  readonly #fetch: typeof fetch;
  readonly #availability = new Map<
    string,
    { expires: number; result: Promise<ServerSoftwareAvailability> }
  >();
  readonly #forgeMavenUrl: string;
  readonly #forgePromotionsUrl: string;
  readonly #neoForgeMavenUrl: string;

  constructor(options: ServerModloaderCatalogOptions = {}) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#forgeMavenUrl = secureUrl(options.forgeMavenUrl ?? 'https://maven.minecraftforge.net/');
    this.#forgePromotionsUrl = secureUrl(
      options.forgePromotionsUrl ??
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    );
    this.#neoForgeMavenUrl = secureUrl(
      options.neoForgeMavenUrl ?? 'https://maven.neoforged.net/releases/',
    );
  }

  availability(value: string): Promise<ServerSoftwareAvailability> {
    const version = safeVersion(value, 'Minecraft');
    const cached = this.#availability.get(version);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }
    const result = this.#checkAvailability(version);
    this.#availability.set(version, { expires: Date.now() + 60_000, result });
    void result.catch(() => this.#availability.delete(version));
    return result;
  }

  async assertAvailable(version: string, kind: ServerSoftwareKind): Promise<void> {
    const result = await this.availability(version);
    if (!result.available.includes(kind)) {
      throw new Error(
        result.unavailable[kind] ?? `${kind} no está disponible para Minecraft ${version}`,
      );
    }
  }

  async #json(url: string): Promise<unknown> {
    const response = await this.#fetch(url, {
      headers: { 'user-agent': 'BattlyLauncher/3.1.0 (contacto@tecnobros.es)' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404 || response.status === 400) {
      return null;
    }
    return JSON.parse(await boundedText(response, 'Catálogo de servidores'));
  }

  async #checkAvailability(version: string): Promise<ServerSoftwareAvailability> {
    const available: ServerSoftwareKind[] = [];
    const unavailable: Partial<Record<ServerSoftwareKind, string>> = {};
    const kinds: ServerSoftwareKind[] = [
      'vanilla',
      'fabric',
      'forge',
      'neoforge',
      'paper',
      'spigot',
    ];
    await Promise.all(
      kinds.map(async (kind) => {
        try {
          let supported = false;
          if (kind === 'forge' || kind === 'neoforge') {
            await this.resolve(kind, version);
            supported = true;
          } else if (kind === 'fabric') {
            const entries = await this.#json(
              `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`,
            );
            supported = Array.isArray(entries) && entries.length > 0;
          } else if (kind === 'paper') {
            const entries = await this.#json(
              `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(paperMinecraftVersion(version))}/builds`,
            );
            supported =
              Array.isArray(entries) &&
              entries.some(
                (entry: unknown) =>
                  field(entry, 'channel') === 'STABLE' &&
                  field(field(entry, 'downloads'), 'server:default'),
              );
          } else if (kind === 'spigot') {
            const entry = await this.#json(
              `https://hub.spigotmc.org/versions/${encodeURIComponent(version)}.json`,
            );
            supported = Boolean(field(field(entry, 'refs'), 'BuildData'));
          } else {
            const manifest = await this.#json(
              'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
            );
            const entries = field(manifest, 'versions');
            const entry: unknown = Array.isArray(entries)
              ? entries.find((entry: unknown) => field(entry, 'id') === version)
              : undefined;
            const url = field(entry, 'url');
            if (typeof url === 'string' && url.startsWith('https://piston-meta.mojang.com/')) {
              const metadata = await this.#json(url);
              supported = Boolean(field(field(metadata, 'downloads'), 'server'));
            }
          }
          if (supported) {
            available.push(kind);
          } else {
            unavailable[kind] =
              `${kind} no publica un servidor compatible con Minecraft ${version}.`;
          }
        } catch {
          unavailable[kind] =
            `No se pudo verificar ${kind} para Minecraft ${version}. Vuelve a cargar las versiones para reintentar.`;
        }
      }),
    );
    return { available: kinds.filter((kind) => available.includes(kind)), unavailable };
  }

  async resolve(
    kindValue: ServerSoftwareKind,
    gameVersionValue: string,
    build?: string,
  ): Promise<ModloaderInstallerArtifact> {
    const gameVersion = safeVersion(gameVersionValue, 'Minecraft');
    if (kindValue !== 'forge' && kindValue !== 'neoforge') {
      throw new TypeError('Software does not use a ModLoader installer');
    }
    return kindValue === 'forge'
      ? this.#resolveForge(gameVersion, build)
      : this.#resolveNeoForge(gameVersion, build);
  }

  async #resolveForge(
    gameVersion: string,
    requested?: string,
  ): Promise<ModloaderInstallerArtifact> {
    if (requested !== undefined) {
      const target = safeVersion(requested, 'Forge');
      const prefix = gameVersion + '-';
      const suffix = '-' + gameVersion;
      const bare = target.startsWith(prefix) ? target.slice(prefix.length) : target;
      const version = bare.endsWith(suffix) ? bare.slice(0, -suffix.length) : bare;
      if (!/^\d+(?:\.\d+){1,4}(?:-[a-zA-Z][a-zA-Z0-9._-]*)?$/.test(version)) {
        throw new TypeError(
          'Esta versión de Forge no es compatible con la versión de Minecraft del servidor.',
        );
      }
      return this.#forgeArtifact(gameVersion, version);
    }
    const text = await boundedText(
      await this.#fetch(this.#forgePromotionsUrl, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      }),
      'Forge promotions',
    );
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Invalid Forge promotions');
    }
    const promos = Reflect.get(parsed, 'promos') as unknown;
    if (!promos || typeof promos !== 'object' || Array.isArray(promos)) {
      throw new TypeError('Invalid Forge promotions');
    }
    const selected: unknown =
      Reflect.get(promos, `${gameVersion}-recommended`) ??
      Reflect.get(promos, `${gameVersion}-latest`);
    if (!selected) {
      throw new Error(`Forge no publica un instalador para Minecraft ${gameVersion}`);
    }
    const version = safeVersion(selected, 'Forge');
    return this.#forgeArtifact(gameVersion, version);
  }

  async #forgeArtifact(gameVersion: string, version: string): Promise<ModloaderInstallerArtifact> {
    const base = `${gameVersion}-${version}`;
    // Older Forge releases publish a Minecraft suffix in their Maven coordinate.
    for (const build of [base, `${base}-${gameVersion}`]) {
      const relative = `net/minecraftforge/forge/${build}/forge-${build}-installer.jar`;
      try {
        return await this.#artifact('forge', build, new URL(relative, this.#forgeMavenUrl).href);
      } catch (error) {
        if (!(error instanceof MissingArtifact)) {
          throw error;
        }
      }
    }
    throw new Error(`Forge no publica un instalador para Minecraft ${gameVersion}`);
  }

  async #resolveNeoForge(
    gameVersion: string,
    requested?: string,
  ): Promise<ModloaderInstallerArtifact> {
    if (requested !== undefined) {
      const build = safeVersion(requested, 'NeoForge');
      if (!build.startsWith(neoForgePrefix(gameVersion))) {
        throw new TypeError(
          'Esta versión de NeoForge no es compatible con la versión de Minecraft del servidor.',
        );
      }
      return this.#artifact(
        'neoforge',
        build,
        new URL(
          'net/neoforged/neoforge/' + build + '/neoforge-' + build + '-installer.jar',
          this.#neoForgeMavenUrl,
        ).href,
      );
    }
    const metadataUrl = new URL('net/neoforged/neoforge/maven-metadata.xml', this.#neoForgeMavenUrl)
      .href;
    const xml = await boundedText(
      await this.#fetch(metadataUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) }),
      'NeoForge metadata',
    );
    const prefix = neoForgePrefix(gameVersion);
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((match) => match[1])
      .filter((value): value is string => typeof value === 'string' && value.startsWith(prefix));
    const version =
      versions.filter((value) => !/-beta|-alpha/i.test(value)).at(-1) ?? versions.at(-1);
    if (!version) {
      throw new Error(`NeoForge no publica un instalador para Minecraft ${gameVersion}`);
    }
    const build = safeVersion(version, 'NeoForge');
    const relative = `net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`;
    return this.#artifact('neoforge', build, new URL(relative, this.#neoForgeMavenUrl).href);
  }

  async #artifact(
    kind: 'forge' | 'neoforge',
    build: string,
    urlValue: string,
  ): Promise<ModloaderInstallerArtifact> {
    const url = secureUrl(urlValue);
    const checksum = await this.#fetch(`${url}.sha1`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (checksum.status === 404) {
      throw new MissingArtifact('Installer not published');
    }
    const sha1 = (await boundedText(checksum, `${kind} checksum`)).trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(sha1)) {
      throw new TypeError(`Invalid ${kind} checksum`);
    }
    return { build, kind, sha1, url };
  }
}
