import { readBoundedResponse } from '../network/read-bounded-response';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { delimiter, dirname, isAbsolute, resolve, sep } from 'node:path';
import { CustomClientInstaller } from './custom-client-installer';
import { customClientProfileDirectory } from './play-version-service';
import { writeFileAtomically } from '../files/atomic-file';
import {
  battlyClientBuildId,
  compareClientVersions,
  validateBattlyClientBuilds,
  type BattlyClientBuild,
} from '../../shared/minecraft/battly-client-contract';

function target(root: string, path: string): string {
  if (
    typeof path !== 'string' ||
    !/^(libraries|versions)\/[a-zA-Z0-9_./+ -]+$/.test(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..')
  ) {
    throw new TypeError('Invalid Battly Client file path');
  }
  const file = resolve(root, path);
  if (!file.startsWith(resolve(root) + sep)) {
    throw new TypeError('Invalid Battly Client target');
  }
  return file;
}

export class BattlyClientService {
  #busy = false;
  #abort?: AbortController;
  cancel(): boolean {
    if (!this.#abort) {
      return false;
    }
    this.#abort.abort();
    return true;
  }
  constructor(
    private readonly request: typeof fetch = fetch,
    private readonly catalogUrl = 'https://api.battlylauncher.com/launcher/battly-client/builds',
    private readonly platform = process.platform,
    private readonly architecture = process.arch,
  ) {}

  async versions(): Promise<readonly BattlyClientBuild[]> {
    const response = await this.request(this.catalogUrl, {
      cache: 'no-store',
      signal: this.#abort
        ? AbortSignal.any([AbortSignal.timeout(20_000), this.#abort.signal])
        : AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Battly Client catalog HTTP ${response.status}`);
    }
    const bytes = await readBoundedResponse(
      response,
      1024 * 1024,
      'Battly Client catalog too large',
    );
    return validateBattlyClientBuilds(JSON.parse(bytes)).filter(
      (build) => build.platform === this.platform && build.architecture === this.architecture,
    );
  }

  async updateAvailable(
    root: string,
    customVersion: string,
  ): Promise<{
    latest: BattlyClientBuild;
    installedVersion: string;
    installedBuild: number;
  } | null> {
    if (!/^battly-(\d+\.\d+(?:\.\d+)?)$/.test(customVersion)) {
      return null;
    }
    const profile = await readFile(
      target(root, `versions/${customVersion}/${customVersion}.json`),
      'utf8',
    )
      .then(
        (text) =>
          JSON.parse(text) as {
            battlyClient?: { clientVersion?: unknown; build?: unknown; channel?: unknown };
          },
      )
      .catch(() => null);
    const installed = profile?.battlyClient;
    if (
      !installed ||
      typeof installed.clientVersion !== 'string' ||
      !Number.isSafeInteger(installed.build) ||
      Number(installed.build) < 1
    ) {
      return null;
    }
    const installedVersion = installed.clientVersion,
      installedBuild = Number(installed.build);
    const channel =
      installed.channel === 'stable' || installed.channel === 'beta'
        ? installed.channel
        : installedVersion.includes('-')
          ? 'beta'
          : 'stable';
    const candidates = (await this.versions()).filter(
      (build) => build.minecraftVersion === customVersion.slice(7) && build.channel === channel,
    );
    candidates.sort(
      (a, b) => compareClientVersions(b.clientVersion, a.clientVersion) || b.build - a.build,
    );
    const latest = candidates[0];
    if (!latest) {
      return null;
    }
    const delta = compareClientVersions(latest.clientVersion, installedVersion);
    return delta > 0 || (delta === 0 && latest.build > installedBuild)
      ? { latest, installedVersion, installedBuild }
      : null;
  }

  async install(
    id: string,
    root: string,
    progress: (message: string, current: number, total: number) => void,
  ) {
    battlyClientBuildId(id);
    if (!isAbsolute(root)) {
      throw new TypeError('Invalid Battly Client installation root');
    }
    if (this.#busy) {
      throw new Error('Battly Client installation is already running');
    }
    this.#busy = true;
    const abort = (this.#abort = new AbortController());
    const staging = resolve(root, `.battly-client-${randomUUID()}`);
    try {
      const build = (await this.versions()).find((item) => item.id === id);
      if (!build) {
        throw new Error('Battly Client build is no longer available');
      }
      const customVersion = `battly-${build.minecraftVersion}`;
      await mkdir(staging, { recursive: true });
      progress('Preparando instalación…', 0, 1);
      await new CustomClientInstaller({
        fetchImplementation: this.request,
        signal: abort.signal,
      }).install(
        {
          id,
          name: 'Battly Client',
          folderName: customVersion,
          downloadUrl: build.downloadUrl,
          sha256: build.sha256,
          size: build.size,
          requiredJavaVersion: String(build.javaVersion),
        },
        staging,
      );
      const spec = JSON.parse(
        await readFile(target(staging, `versions/${customVersion}/battly-install.json`), 'utf8'),
      ) as {
        schema: number;
        minecraftVersion: string;
        builtins: { path: string; sha256?: string; sha1?: string }[];
        downloads: { path: string; url: string; sha1: string }[];
        addons?: { id: string; versionId: string; filename: string }[];
      };
      if (
        spec.schema !== 1 ||
        spec.minecraftVersion !== build.minecraftVersion ||
        !Array.isArray(spec.downloads) ||
        spec.downloads.length > 5000 ||
        !Array.isArray(spec.builtins) ||
        !spec.builtins.length ||
        spec.builtins.length > 1000
      ) {
        throw new TypeError('Invalid Battly Client installation manifest');
      }
      const files = spec.downloads;
      let completed = 0;
      // Bound concurrency; every remote library is pinned by the trusted bundle.
      let cursor = 0;
      const workers = await Promise.allSettled(
        Array.from({ length: Math.min(6, files.length) }, async () => {
          while (cursor < files.length) {
            abort.signal.throwIfAborted();
            const file = files[cursor++],
              destination = target(staging, file.path);
            if (!/^[a-f0-9]{40}$/.test(file.sha1)) {
              throw new TypeError('Missing library checksum');
            }
            let data = await readFile(destination).catch(() =>
              readFile(target(root, file.path)).catch(() => null),
            );
            if (!data || createHash('sha1').update(data).digest('hex') !== file.sha1) {
              const url = new URL(file.url);
              if (url.protocol !== 'https:' || url.username || url.password) {
                throw new TypeError('Invalid library URL');
              }
              const response = await this.request(url, {
                signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)]),
              });
              if (!response.ok || new URL(response.url || url.href).protocol !== 'https:') {
                throw new Error('Battly Client library download failed');
              }
              if (Number(response.headers.get('content-length')) > 256 * 1024 * 1024) {
                throw new Error('Library too large');
              }
              const chunks: Uint8Array[] = [];
              let size = 0;
              if (!response.body) {
                throw new Error('Missing library body');
              }
              const reader = response.body.getReader();
              while (true) {
                const part = await reader.read();
                if (part.done) {
                  break;
                }
                size += part.value.length;
                if (size > 256 * 1024 * 1024) {
                  await reader.cancel();
                  throw new Error('Library too large');
                }
                chunks.push(part.value);
              }
              data = Buffer.concat(chunks);
              if (createHash('sha1').update(data).digest('hex') !== file.sha1) {
                throw new Error('Battly Client library checksum mismatch');
              }
            }
            await mkdir(dirname(destination), { recursive: true });
            await writeFileAtomically(destination, data);
            progress('Preparando instalación…', ++completed, files.length);
          }
        }),
      );
      const failure = workers.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) {
        throw failure.reason;
      }
      abort.signal.throwIfAborted();
      const builtins: string[] = [];
      for (const file of spec.builtins) {
        const destination = target(staging, file.path);
        const algorithm = file.sha256 ? 'sha256' : 'sha1',
          hash = file.sha256 || file.sha1 || '';
        if (
          !(algorithm === 'sha256' ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/).test(hash) ||
          createHash(algorithm)
            .update(await readFile(destination))
            .digest('hex') !== hash
        ) {
          throw new Error('Battly Client built-in checksum mismatch');
        }
        builtins.push(target(root, file.path));
      }
      const profilePath = target(staging, `versions/${customVersion}/${customVersion}.json`);
      const profile = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, unknown> & {
        arguments?: { jvm?: unknown[] };
        javaVersion?: { majorVersion?: unknown };
      };
      if (
        profile.id !== customVersion ||
        profile.inheritsFrom !== build.minecraftVersion ||
        !Array.isArray(profile.arguments?.jvm) ||
        (profile.javaVersion?.majorVersion !== undefined &&
          profile.javaVersion.majorVersion !== build.javaVersion)
      ) {
        throw new TypeError('Invalid Battly Client profile');
      }
      profile.arguments.jvm = profile.arguments.jvm.filter(
        (arg: unknown) => typeof arg !== 'string' || !arg.startsWith('-Dfabric.addMods='),
      );
      let addonList: string | undefined;
      const gameDirectory = customClientProfileDirectory(root, customVersion);
      if (spec.addons !== undefined) {
        if (!Array.isArray(spec.addons) || spec.addons.length > 500) {
          throw new TypeError('Invalid addon catalog');
        }
        const state: { disabled?: unknown } = await readFile(
          resolve(gameDirectory, 'config/battly-mods-state.json'),
          'utf8',
        )
          .then((text) => JSON.parse(text) as { disabled?: unknown })
          .catch(() => ({}));
        const disabled = new Set(
          Array.isArray(state.disabled) ? (state.disabled as unknown[]) : [],
        );
        const paths: string[] = [];
        for (const addon of spec.addons) {
          if (
            !/^[a-z0-9_-]+$/.test(addon.id) ||
            !/^[A-Za-z0-9]+$/.test(addon.versionId) ||
            !/^[A-Za-z0-9._+ -]+\.jar$/.test(addon.filename)
          ) {
            throw new TypeError('Invalid addon path');
          }
          const relative = `libraries/net/battly/addons/${addon.id}/${addon.versionId}/${addon.filename}`;
          if (!files.some((file) => file.path === relative)) {
            throw new TypeError('Addon missing from pinned downloads');
          }
          if (!disabled.has(addon.id)) {
            paths.push(target(root, relative));
          }
        }
        addonList = paths.join('\n') + '\n';
        builtins.push(`@${resolve(root, 'battly-addons-0.9.list')}`);
      }
      profile.arguments.jvm.push(
        `-Dfabric.addMods=${builtins.join(delimiter)}`,
        '-Dminecraft.launcher.brand=Battly',
        '--enable-native-access=ALL-UNNAMED',
      );
      profile.javaVersion = { majorVersion: build.javaVersion };
      profile.battlyClient = {
        id: build.id,
        clientVersion: build.clientVersion,
        build: build.build,
        sha256: build.sha256,
        channel: build.channel,
      };
      // Install the final profile last; a failed download keeps the old build usable.
      await rm(profilePath);
      abort.signal.throwIfAborted();
      for (const directory of ['libraries', 'versions']) {
        await cp(resolve(staging, directory), resolve(root, directory), {
          recursive: true,
          force: true,
        });
      }
      if (addonList !== undefined) {
        await mkdir(gameDirectory, { recursive: true });
        await writeFileAtomically(
          resolve(gameDirectory, 'battly-mods-lock.json'),
          JSON.stringify(spec.addons, null, 2),
        );
        await writeFileAtomically(resolve(root, 'battly-addons-0.9.list'), addonList);
      }
      await writeFileAtomically(
        target(root, `versions/${customVersion}/${customVersion}.json`),
        JSON.stringify(profile, null, 2),
      );
      return {
        customVersion,
        minecraftVersion: build.minecraftVersion,
        requiredJavaVersion: String(build.javaVersion),
      };
    } finally {
      try {
        await rm(staging, { recursive: true, force: true });
      } finally {
        this.#busy = false;
        this.#abort = undefined;
      }
    }
  }
}
