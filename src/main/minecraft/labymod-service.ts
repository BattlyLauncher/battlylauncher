import { readBoundedResponse } from '../network/read-bounded-response';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { LabyModVersion } from '../../shared/minecraft/labymod-contract';

const manifestUrl = 'https://releases.r2.labymod.net/api/v1/manifest/production/latest.json';
const librariesUrl = 'https://releases.r2.labymod.net/api/v1/libraries/production.json';
const maximumFileBytes = 256 * 1024 * 1024;
export const labyLwjglModules = [
  'lwjgl',
  'lwjgl-freetype',
  'lwjgl-glfw',
  'lwjgl-jemalloc',
  'lwjgl-openal',
  'lwjgl-opengl',
  'lwjgl-stb',
  'lwjgl-tinyfd',
] as const;
const labyAssetNames = [
  'shader',
  'common',
  'fonts',
  'vanilla-theme',
  'fancy-theme',
  'i18n',
] as const;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid LabyMod ${label}`);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new TypeError(`Invalid LabyMod ${label}`);
  }
  return value.trim();
}

function httpsUrl(value: unknown, label: string): string {
  const url = new URL(text(value, label));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError(`Invalid LabyMod ${label}`);
  }
  return url.href;
}

function within(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference !== '' &&
    difference !== '..' &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function mavenPath(nameValue: unknown): string {
  const parts = text(nameValue, 'library name').replaceAll('+', '.').split(':');
  if (
    parts.length < 3 ||
    parts.length > 4 ||
    parts.some((part) => !/^[a-zA-Z0-9._+-]+$/.test(part))
  ) {
    throw new TypeError('Invalid LabyMod library name');
  }
  const [group, artifact, version, classifier] = parts;
  return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
}

function safeArtifactPath(value: unknown, fallbackName: unknown): string {
  const path =
    typeof value === 'string' && value.trim()
      ? value.trim().replaceAll('\\', '/')
      : mavenPath(fallbackName);
  const parts = path.split('/');
  if (
    parts.some(
      (part) => !part || part === '.' || part === '..' || part.includes('\0') || part.includes(':'),
    )
  ) {
    throw new TypeError('Invalid LabyMod library path');
  }
  return parts.join('/');
}

export interface LabyModInstallResult {
  readonly customVersion: string;
  readonly minecraftVersion: string;
}

export class LabyModService {
  readonly #fetch: typeof fetch;
  #manifest: JsonObject | null = null;

  constructor(fetchImplementation: typeof fetch = fetch) {
    this.#fetch = fetchImplementation;
  }

  async #json(url: string): Promise<JsonObject> {
    const response = await this.#fetch(url, {
      headers: { 'Release-Channel': 'production', 'User-Agent': 'BattlyLauncher/3.1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new Error(`LabyMod API returned HTTP ${response.status}`);
    }
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== 'https:') {
      throw new TypeError('LabyMod API redirected insecurely');
    }
    return object(
      JSON.parse(
        await readBoundedResponse(response, 8 * 1024 * 1024, 'LabyMod response is too large'),
      ) as unknown,
      'response',
    );
  }

  async #loadManifest(): Promise<JsonObject> {
    this.#manifest ??= await this.#json(manifestUrl);
    return this.#manifest;
  }

  async versions(): Promise<readonly LabyModVersion[]> {
    const manifest = await this.#loadManifest();
    if (!Array.isArray(manifest.minecraftVersions)) {
      throw new TypeError('Invalid LabyMod versions');
    }
    return manifest.minecraftVersions.map((entry) => {
      const source = object(entry, 'version');
      return {
        version: text(source.version, 'Minecraft version'),
        tag: text(source.tag, 'version tag'),
        customManifestUrl: httpsUrl(source.customManifestUrl, 'custom manifest URL'),
      };
    });
  }

  async installed(
    version: string,
    root: string,
  ): Promise<(LabyModInstallResult & { commit: string }) | null> {
    const folders = await readdir(resolve(root, 'versions')).catch(() => []);
    for (const id of folders.filter((name) => /^LabyMod-[a-zA-Z0-9._-]+$/.test(name))) {
      try {
        const profile = object(
          JSON.parse(await readFile(resolve(root, 'versions', id, `${id}.json`), 'utf8')),
          'installed profile',
        );
        const data = object(profile.labymod_data, 'installed metadata');
        if (
          profile.inheritsFrom !== version ||
          data?.runtimeRevision !== 1 ||
          !data.librariesSynced ||
          typeof data.commitReference !== 'string' ||
          !/^[a-f0-9]{7,64}$/i.test(data.commitReference)
        ) {
          continue;
        }
        const client = await stat(
          resolve(root, 'labymod-neo', 'clients', `${data.commitReference}.jar`),
        );
        if (!client.isFile() || client.size < 100000) {
          continue;
        }
        return { customVersion: id, minecraftVersion: version, commit: data.commitReference };
      } catch {
        /* Ignore incomplete installations and repair them through the installer. */
      }
    }
    return null;
  }

  async updateAvailable(commit: string): Promise<boolean> {
    // Recheck each decision; a failed network check must not prevent a local launch.
    try {
      const manifest = await this.#json(manifestUrl);
      this.#manifest = manifest;
      return (
        typeof manifest.commitReference === 'string' &&
        /^[a-f0-9]{7,64}$/i.test(manifest.commitReference) &&
        manifest.commitReference !== commit
      );
    } catch {
      return false;
    }
  }

  async #download(
    urlValue: unknown,
    destination: string,
    expectedSha1: unknown,
    expectedSize: unknown,
  ): Promise<void> {
    const url = httpsUrl(urlValue, 'library URL');
    const wantedHash =
      typeof expectedSha1 === 'string' && /^[a-f0-9]{40}$/i.test(expectedSha1)
        ? expectedSha1.toLowerCase()
        : '';
    const wantedSize = Number(expectedSize);
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile()) {
      const sizeMatches =
        !Number.isFinite(wantedSize) || wantedSize <= 0 || existing.size === wantedSize;
      const hashMatches = wantedHash
        ? createHash('sha1')
            .update(await readFile(destination))
            .digest('hex') === wantedHash
        : true;
      if (sizeMatches && hashMatches) {
        return;
      }
    }
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await this.#fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'BattlyLauncher/3.1.0' },
      signal: controller.signal,
    }).catch((error) => {
      clearTimeout(timeout);
      throw error;
    });
    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      throw new Error(`LabyMod download returned HTTP ${response.status}`);
    }
    if (new URL(response.url || url).protocol !== 'https:') {
      clearTimeout(timeout);
      throw new TypeError('LabyMod download redirected insecurely');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maximumFileBytes) {
      clearTimeout(timeout);
      throw new TypeError('LabyMod file is too large');
    }
    const handle = await open(temporary, 'wx');
    const digest = createHash('sha1');
    let bytes = 0;
    try {
      const reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        bytes += part.value.byteLength;
        if (bytes > maximumFileBytes) {
          await reader.cancel();
          throw new TypeError('LabyMod file is too large');
        }
        digest.update(part.value);
        await handle.write(part.value);
      }
      await handle.sync();
    } catch (error) {
      clearTimeout(timeout);
      await handle.close();
      await rm(temporary, { force: true });
      throw error;
    }
    await handle.close();
    const actualHash = digest.digest('hex');
    if (
      (wantedHash && actualHash !== wantedHash) ||
      (Number.isFinite(wantedSize) && wantedSize > 0 && bytes !== wantedSize)
    ) {
      await rm(temporary, { force: true });
      throw new Error('LabyMod file integrity check failed');
    }
    await rm(destination, { force: true });
    await rename(temporary, destination);
    clearTimeout(timeout);
  }

  async install(
    versionValue: string,
    rootValue: string,
    progress: (message: string, current: number, total: number) => void,
  ): Promise<LabyModInstallResult> {
    const root = resolve(rootValue);
    if (!isAbsolute(root)) {
      throw new TypeError('Invalid LabyMod root');
    }
    const versions = await this.versions();
    const selected = versions.find((entry) => entry.version === versionValue);
    if (!selected) {
      throw new TypeError('Unsupported LabyMod version');
    }
    const [manifest, librariesData, baseJson] = await Promise.all([
      this.#loadManifest(),
      this.#json(librariesUrl),
      this.#json(selected.customManifestUrl),
    ]);
    const rawLibraries = Array.isArray(librariesData.libraries) ? librariesData.libraries : [];
    const libraries = rawLibraries
      .map((entry) => object(entry, 'library'))
      .filter(
        (entry) =>
          !entry.minecraftVersion ||
          entry.minecraftVersion === 'all' ||
          entry.minecraftVersion === selected.version,
      )
      .map((entry) => ({
        name: text(entry.name, 'library name'),
        downloads: {
          artifact: {
            path: mavenPath(entry.name),
            url: httpsUrl(entry.url, 'library URL'),
            ...(typeof entry.sha1 === 'string' ? { sha1: entry.sha1 } : {}),
            ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
          },
        },
      }));
    // Laby's core (including its unsafe variant) defines the ABI for every LWJGL module.
    const coreLibrary = libraries.find((entry) =>
      /^org\.lwjgl:lwjgl:[^:]+(?::unsafe)?$/.test(entry.name),
    );
    const lwjglVersion = coreLibrary?.name.split(':')[2];
    if (!lwjglVersion || !/^[a-zA-Z0-9._+-]+$/.test(lwjglVersion)) {
      throw new Error('LabyMod no ha indicado la versión de su entorno gráfico');
    }
    const commitReference = text(manifest.commitReference, 'commit reference');
    const manifestAssets = object(manifest.assets, 'assets');
    const labyAssets = labyAssetNames.map((name) => {
      const hash = text(manifestAssets[name], `${name} asset hash`).toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(hash)) {
        throw new TypeError(`Invalid LabyMod ${name} asset hash`);
      }
      return { name, hash };
    });
    libraries.push({
      name: `net.labymod:LabyMod:${commitReference}`,
      downloads: {
        artifact: {
          path: `labymod-neo/clients/${commitReference}.jar`,
          url: `https://releases.r2.labymod.net/api/v1/download/labymod4/production/${encodeURIComponent(commitReference)}.jar`,
        },
      },
    });
    const existingLibraries: JsonObject[] = Array.isArray(baseJson.libraries)
      ? baseJson.libraries.map((entry) => object(entry, 'base library'))
      : [];
    baseJson.libraries = [...existingLibraries, ...libraries];
    const customVersion = `LabyMod-${selected.tag}`;
    baseJson.id = customVersion;
    baseJson.inheritsFrom = selected.version;
    const now = new Date().toISOString();
    baseJson.time = now;
    baseJson.releaseTime = now;
    baseJson.labymod_data = {
      channelType: 'production',
      version: typeof manifest.labyModVersion === 'string' ? manifest.labyModVersion : '4',
      versionType: 'release',
      commitReference,
      assets: Object.fromEntries(labyAssets.map((asset) => [asset.name, asset.hash])),
      librariesSynced: true,
      lwjglVersion,
      runtimeRevision: 0,
    };
    const downloadable = (baseJson.libraries as unknown[])
      .map((entry) => object(entry, 'library'))
      .flatMap((entry) => {
        if (entry.downloads === undefined) {
          return [];
        }
        const downloads = object(entry.downloads, 'library downloads');
        // Native-only libraries (JInput/Twitch in older versions) have classifiers,
        // but no classpath artifact. Keep them in the profile for the native resolver.
        if (downloads.artifact === undefined) {
          return [];
        }
        const artifact = object(downloads.artifact, 'artifact');
        const path = safeArtifactPath(artifact.path, entry.name);
        const directUrl = typeof artifact.url === 'string' ? artifact.url : '';
        const repositoryUrl =
          typeof entry.url === 'string'
            ? httpsUrl(entry.url, 'library repository URL').replace(/\/$/, '')
            : '';
        const url =
          directUrl ||
          (repositoryUrl ? `${repositoryUrl}/${path}` : `https://libraries.minecraft.net/${path}`);
        return [{ path, url, sha1: artifact.sha1, size: artifact.size }];
      });
    progress('Guardando manifiesto de LabyMod…', 0, downloadable.length || 1);
    const versionDirectory = resolve(root, 'versions', customVersion);
    if (!within(root, versionDirectory)) {
      throw new TypeError('Invalid LabyMod version directory');
    }
    await mkdir(versionDirectory, { recursive: true });
    const assetIndex = object(baseJson.assetIndex, 'asset index');
    const assetIndexDirectory = resolve(root, 'assets', 'indexes');
    await mkdir(assetIndexDirectory, { recursive: true });
    progress('Comprobando índice de recursos de Minecraft…', 0, downloadable.length || 1);
    await this.#download(
      assetIndex.url,
      resolve(assetIndexDirectory, `${selected.version}.json`),
      assetIndex.sha1,
      assetIndex.size,
    );
    const nativeClassifier =
      process.platform === 'win32'
        ? 'natives-windows'
        : process.platform === 'darwin'
          ? 'natives-macos'
          : 'natives-linux';
    for (const module of labyLwjglModules) {
      const runtimeDirectory = resolve(
        root,
        'labymod-neo',
        'libraries',
        'org',
        'lwjgl',
        module,
        lwjglVersion,
      );
      for (const classifier of ['', `-${nativeClassifier}`]) {
        const file = `${module}-${lwjglVersion}${classifier}.jar`;
        progress(`Preparando entorno gráfico de LabyMod (${module})…`, 0, downloadable.length || 1);
        await this.#download(
          `https://releases.r2.labymod.net/libraries/org/lwjgl/${module}/${lwjglVersion}/${file}`,
          resolve(runtimeDirectory, file),
          undefined,
          undefined,
        );
      }
    }
    for (let index = 0; index < labyAssets.length; index += 1) {
      const asset = labyAssets[index];
      progress(
        `Comprobando recursos de LabyMod (${index + 1}/${labyAssets.length}): ${asset.name}…`,
        index,
        labyAssets.length,
      );
      await this.#download(
        `https://laby-releases.s3.de.io.cloud.ovh.net/api/v1/download/assets/labymod4/production/${encodeURIComponent(commitReference)}/${encodeURIComponent(asset.name)}/${asset.hash}.jar`,
        resolve(root, 'labymod-neo', 'assets', `${asset.name}.jar`),
        asset.hash,
        undefined,
      );
    }
    for (let index = 0; index < downloadable.length; index += 1) {
      const artifact = downloadable[index];
      const destination = resolve(root, 'libraries', artifact.path);
      if (!within(root, destination)) {
        throw new TypeError('Invalid LabyMod library destination');
      }
      progress(
        `Comprobando librerías de LabyMod (${index + 1}/${downloadable.length})…`,
        index,
        downloadable.length,
      );
      await this.#download(artifact.url, destination, artifact.sha1, artifact.size);
    }
    (baseJson.labymod_data as JsonObject).runtimeRevision = 1;
    await writeFile(
      resolve(versionDirectory, `${customVersion}.json`),
      `${JSON.stringify(baseJson, null, 2)}\n`,
      { mode: 0o600 },
    );
    progress('LabyMod instalado', downloadable.length, downloadable.length || 1);
    return { customVersion, minecraftVersion: selected.version };
  }
}
