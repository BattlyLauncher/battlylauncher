import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { networkAvailable } from '../network/connectivity';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';

function buildParts(build: string): readonly number[] {
  return /^(\d+)\.(\d+)\.(\d+)(?:[-+][a-z\d.+-]+)?$/i.exec(build)?.slice(1).map(Number) ?? [];
}

/** Fabric Loader 0.17.0 was the first release to ship ASM 9.8 with Java 25 support. */
export function isObsoleteFabricLoader(minecraft: string, build: string): boolean {
  const gameYear = Number(/^(\d+)\./.exec(minecraft)?.[1]);
  const [major, minor] = buildParts(build);
  return gameYear >= 26 && major === 0 && minor !== undefined && minor < 17;
}

async function installedFabricLoader(root: string, minecraft: string): Promise<string | undefined> {
  const versions = join(root, 'loader', 'versions');
  const prefix = 'fabric-loader-';
  const suffix = `-${minecraft}`;
  const entries = await readdir(versions, { withFileTypes: true }).catch(() => []);
  const candidates = entries.flatMap((entry) => {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix) || !entry.name.endsWith(suffix)) {
      return [];
    }
    const build = entry.name.slice(prefix.length, -suffix.length);
    const [major, minor, patch] = buildParts(build);
    if (major === undefined || isObsoleteFabricLoader(minecraft, build)) {
      return [];
    }
    return [{ build, id: entry.name, major, minor, patch }];
  });
  candidates.sort((a, b) => b.major - a.major || b.minor - a.minor || b.patch - a.patch);
  for (const { build, id } of candidates) {
    const metadata = await stat(join(versions, id, id + '.json')).catch(() => undefined);
    if (metadata?.isFile() && metadata.size > 0) {
      return build;
    }
  }
  return undefined;
}

export async function resolveFabricLoader(
  options: MinecraftLaunchOptions,
  emit: MinecraftLaunchEventSink,
  online = networkAvailable(),
): Promise<MinecraftLaunchOptions> {
  const core = options.core;
  const minecraft = options.version.id;
  if (
    !core?.loader?.enabled ||
    core.loader.type !== 'fabric' ||
    !isObsoleteFabricLoader(minecraft, core.loader.build)
  ) {
    return options;
  }

  // Reuse the instance's own installation before asking the core to download another build.
  const installed = await installedFabricLoader(options.root, minecraft);
  if (!installed && !online) {
    throw new Error(
      `Fabric Loader ${core.loader.build} no es compatible con Minecraft ${minecraft}. Conéctate a Internet para instalar una versión compatible.`,
    );
  }
  const build = installed ?? (/^26\.1(?:\D|$)/.test(minecraft) ? '0.18.4' : '0.19.3');
  emit({
    type: 'log',
    stream: 'game',
    message: `[Battly] Fabric Loader actualizado de ${core.loader.build} a ${build} para Minecraft ${minecraft}.`,
  });
  return { ...options, core: { ...core, loader: { ...core.loader, build } } };
}
