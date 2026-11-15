import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { readBoundedRegularFile } from '../files/atomic-file';
import { networkAvailable } from '../network/connectivity';
import type { MinecraftLaunchOptions } from './launcher-adapter';

interface Artifact {
  path: string;
  size?: number;
}
interface Profile {
  mainClass?: string;
  downloads?: { client?: { size?: number } };
  inheritsFrom?: string;
  assetIndex?: { id?: string };
  objects?: Record<string, { hash: string; size: number }>;
  libraries?: {
    name?: string;
    rules?: {
      action: string;
      features?: unknown;
      os?: { name?: string; arch?: string; version?: string };
    }[];
    downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> };
    natives?: Record<string, string>;
  }[];
}

export class OfflineFilesMissing extends Error {
  constructor(file: string) {
    super(`BATTLY_OFFLINE_MISSING_FILES: ${file}`);
  }
}

/** Stop incomplete offline installs before third-party download retry loops. */
export async function assertOfflineFiles(options: MinecraftLaunchOptions): Promise<void> {
  if (networkAvailable()) {
    return;
  }
  const root = resolve(options.root);
  const file = (path: string): string => {
    const target = resolve(root, path),
      local = relative(root, target);
    if (isAbsolute(local) || local === '..' || /^\.\.[/\\]/.test(local)) {
      throw new OfflineFilesMissing(path);
    }
    return target;
  };
  const requireFile = async (path: string, size?: number): Promise<void> => {
    const info = await stat(file(path)).catch(() => null);
    if (!info?.isFile() || info.size === 0 || (size !== undefined && info.size !== size)) {
      throw new OfflineFilesMissing(path);
    }
  };
  const json = async (path: string): Promise<Profile> => {
    try {
      const value: unknown = JSON.parse(
        (await readBoundedRegularFile(file(path), 8 * 1024 * 1024)).toString('utf8'),
      );
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
      }
    } catch {
      /* No network can repair this cache. */
    }
    throw new OfflineFilesMissing(path);
  };
  const os =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const seen = new Set<string>();
  let id: string | undefined = options.version.customId ?? options.version.id;
  while (id) {
    if (seen.has(id) || seen.size >= 16 || !/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(id)) {
      throw new OfflineFilesMissing(id);
    }
    seen.add(id);
    const profile = await json(`versions/${id}/${id}.json`);
    if (!profile.inheritsFrom && (typeof profile.mainClass !== 'string' || !profile.mainClass)) {
      throw new OfflineFilesMissing(`versions/${id}/${id}.json`);
    }
    if (profile.downloads?.client) {
      await requireFile(`versions/${id}/${id}.jar`, profile.downloads.client.size);
    }
    for (const library of Array.isArray(profile.libraries) ? profile.libraries : []) {
      let allowed = !library.rules?.length;
      for (const rule of library.rules ?? []) {
        if (
          rule.features ||
          (rule.os?.name && rule.os.name !== os) ||
          (rule.os?.arch && rule.os.arch !== process.arch)
        ) {
          continue;
        }
        // Leave uncommon version-sensitive rules to the core instead of executing cached regexes here.
        if (rule.os?.version) {
          continue;
        }
        allowed = rule.action === 'allow';
      }
      if (!allowed) {
        continue;
      }
      const nativeName = library.name?.split(':')[3];
      if (nativeName?.startsWith('natives-')) {
        const arch = nativeName.endsWith('-arm64')
          ? 'arm64'
          : nativeName.endsWith('-x86')
            ? 'ia32'
            : 'x64';
        if (arch !== process.arch) {
          continue;
        }
      }
      const artifact = library.downloads?.artifact;
      if (artifact?.path) {
        await requireFile(`libraries/${artifact.path}`, artifact.size);
      }
      const native = library.natives?.[os]?.replace(
        '${arch}',
        process.arch === 'ia32' ? '32' : '64',
      );
      const classifier = native ? library.downloads?.classifiers?.[native] : undefined;
      if (classifier?.path) {
        await requireFile(`libraries/${classifier.path}`, classifier.size);
      }
    }
    const index = profile.assetIndex;
    if (index?.id && /^[a-zA-Z0-9._+-]{1,128}$/.test(index.id)) {
      const assets = await json(`assets/indexes/${index.id}.json`);
      if (!assets.objects || typeof assets.objects !== 'object') {
        throw new OfflineFilesMissing('assets/indexes');
      }
      const objects = Object.values(assets.objects);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(16, objects.length) }, async () => {
          while (cursor < objects.length) {
            const asset = objects[cursor++];
            if (!/^[a-f0-9]{40}$/.test(asset.hash)) {
              throw new OfflineFilesMissing('assets/objects');
            }
            await requireFile(`assets/objects/${asset.hash.slice(0, 2)}/${asset.hash}`, asset.size);
          }
        }),
      );
    }
    id = typeof profile.inheritsFrom === 'string' ? profile.inheritsFrom : undefined;
  }
}
