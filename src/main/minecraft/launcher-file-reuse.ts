import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readBoundedRegularFile } from '../files/atomic-file';

export interface CachedVersionHandler {
  options: {
    root: string;
    directory?: string;
    cache?: string;
    version: { number: string };
    overrides: { versionJson?: string };
  };
  version?: unknown;
}

/** MCLC only falls back for ENOTFOUND and can hang/throw inside request callbacks.
 * Read its installed metadata before that request path, including its on-disk cache. */
export async function cachedLauncherVersion(
  handler: CachedVersionHandler,
): Promise<Record<string, unknown> | null> {
  const { options } = handler;
  const id = options.version.number;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(id)) {
    return null;
  }
  const paths = [
    options.overrides.versionJson,
    join(options.directory ?? join(options.root, 'versions', id), `${id}.json`),
    join(options.root, 'versions', id, `${id}.json`),
    join(options.cache ?? join(options.root, 'cache'), 'json', `${id}.json`),
  ];
  for (const path of paths) {
    if (!path) {
      continue;
    }
    try {
      const value: unknown = JSON.parse(
        (await readBoundedRegularFile(path, 4 * 1024 * 1024)).toString('utf8'),
      );
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const data = value as Record<string, unknown>;
      if (data.id !== id || typeof data.mainClass !== 'string' || !Array.isArray(data.libraries)) {
        continue;
      }
      handler.version = data;
      return data;
    } catch {
      /* Corrupt caches never replace usable installed metadata. */
    }
  }
  return null;
}

interface Handler {
  options: {
    root: string;
    version: { custom?: string; number: string };
    overrides: { assetRoot?: string; url: { resource: string } };
  };
  version: { assetIndex: { url: string; id?: string } };
  client: { emit(event: string, data: unknown): void };
  isLegacy(): boolean;
  downloadAsync(
    url: string,
    directory: string,
    name: string,
    retry: boolean,
    type: string,
  ): Promise<unknown>;
}

/** Reuse immutable Mojang objects only when their content matches the URL hash. */
export async function reusableMojangObject(url: string, file: string): Promise<boolean> {
  const match =
    /^https:\/\/(?:launcher\.mojang\.com|piston-data\.mojang\.com)\/v1\/objects\/([a-f0-9]{40})\//.exec(
      url,
    );
  if (!match) {
    return false;
  }
  try {
    return (
      createHash('sha1')
        .update(await readFile(file))
        .digest('hex') === match[1]
    );
  } catch {
    return false;
  }
}

/** One index pass, bounded filesystem work, and progress only at visible intervals. */
export async function checkModernAssets(this: Handler): Promise<void> {
  const root = resolve(this.options.overrides.assetRoot || join(this.options.root, 'assets'));
  const id = this.options.version.custom || this.options.version.number;
  const canonicalId = this.version.assetIndex.id;
  const canonicalPath =
    canonicalId && /^[a-zA-Z0-9._+-]{1,128}$/.test(canonicalId)
      ? join(root, 'indexes', `${canonicalId}.json`)
      : null;
  let indexPath = join(root, 'indexes', `${id}.json`);
  if (
    canonicalPath &&
    (await stat(canonicalPath).then(
      (info) => info.isFile(),
      () => false,
    ))
  ) {
    indexPath = canonicalPath;
  }
  try {
    await stat(indexPath);
  } catch {
    await this.downloadAsync(
      this.version.assetIndex.url,
      join(root, 'indexes'),
      `${id}.json`,
      true,
      'asset-json',
    );
  }
  const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
    objects: Record<string, { hash: string; size: number }>;
  };
  const entries = Object.values(index.objects);
  let cursor = 0,
    completed = 0,
    last = 0;
  await Promise.all(
    Array.from({ length: Math.min(32, entries.length) }, async () => {
      while (cursor < entries.length) {
        const asset = entries[cursor++];
        if (
          !/^[a-f0-9]{40}$/.test(asset.hash) ||
          !Number.isSafeInteger(asset.size) ||
          asset.size < 0
        ) {
          throw new Error('Invalid Minecraft asset index');
        }
        const directory = join(root, 'objects', asset.hash.slice(0, 2));
        const file = join(directory, asset.hash);
        const metadata = await stat(file).catch(() => null);
        if (!metadata?.isFile() || metadata.size !== asset.size) {
          await this.downloadAsync(
            `${this.options.overrides.url.resource}/${asset.hash.slice(0, 2)}/${asset.hash}`,
            directory,
            asset.hash,
            true,
            'assets',
          );
          const bytes = await readFile(file);
          if (
            bytes.length !== asset.size ||
            createHash('sha1').update(bytes).digest('hex') !== asset.hash
          ) {
            throw new Error('Minecraft asset verification failed');
          }
        }
        completed++;
        if (completed === entries.length || Date.now() - last >= 100) {
          last = Date.now();
          this.client.emit('battly-check', {
            task: completed,
            total: entries.length,
            type: 'assets',
          });
        }
      }
    }),
  );
}
