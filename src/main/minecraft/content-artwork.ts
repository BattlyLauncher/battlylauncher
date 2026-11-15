import { readBoundedResponse } from '../network/read-bounded-response';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { InstanceContentEntry } from '../../shared/minecraft/instance-content';
import type { BypackSources, BypackCandidate } from './bypack-sources';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** Exact file recognition supplies project artwork when authors omit a JAR logo. */
export class ContentArtwork {
  private readonly cache = new Map<
    string,
    { stamp: string; icon: string | null; expires: number }
  >();
  constructor(private readonly sources: BypackSources) {}

  async enrich(directory: string, entries: InstanceContentEntry[]): Promise<void> {
    const pending: BypackCandidate[] = [];
    const stamps = new Map<string, string>();
    for (const entry of entries) {
      if (entry.iconDataUrl || entry.directory) {
        continue;
      }
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        continue;
      }
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      const cached = this.cache.get(path);
      if (cached?.stamp === stamp && cached.expires > Date.now()) {
        entries[entries.indexOf(entry)] = { ...entry, iconDataUrl: cached.icon };
        continue;
      }
      const sha1 = createHash('sha1');
      const sha512 = createHash('sha512');
      for await (const chunk of createReadStream(path)) {
        sha1.update(chunk as Buffer);
        sha512.update(chunk as Buffer);
      }
      stamps.set(path, stamp);
      pending.push({
        path: entry.name,
        absolutePath: path,
        size: stat.size,
        sha1: sha1.digest('hex'),
        sha512: sha512.digest('hex'),
      });
    }
    if (!pending.length) {
      return;
    }
    const { matches } = await this.sources.identify(pending);
    const projects = new Map<string, Promise<string | null>>();
    const queue = [...pending];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) {
          const source = matches.get(file.path);
          let icon: string | null = null;
          if (source) {
            const key = `${source.provider}:${source.projectId}`;
            if (!projects.has(key)) {
              projects.set(key, this.projectIcon(source.provider, source.projectId));
            }
            icon = await projects.get(key)!;
          }
          const entry = entries.find((entry) => entry.name === file.path);
          if (entry) {
            entries[entries.indexOf(entry)] = { ...entry, iconDataUrl: icon };
          }
          if (this.cache.size > 4000) {
            this.cache.clear();
          }
          this.cache.set(file.absolutePath, {
            stamp: stamps.get(file.absolutePath)!,
            icon,
            expires: Date.now() + (icon ? 86400000 : 60000),
          });
        }
      }),
    );
  }

  private async projectIcon(provider: string, id: string): Promise<string | null> {
    try {
      const url =
        provider === 'modrinth'
          ? `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`
          : `https://api.battlylauncher.com/curseforge/mod/${encodeURIComponent(id)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'user-agent': 'BattlyLauncher (contacto@tecnobros.es)' },
      });
      if (!response.ok) {
        return null;
      }
      let data = record(
        JSON.parse(
          await readBoundedResponse(response, 4 * 1024 * 1024, 'Artwork response is too large'),
        ) as unknown,
      );
      for (let i = 0; i < 3 && data.data; i++) {
        data = record(data.data);
      }
      const value = provider === 'modrinth' ? data.icon_url : record(data.logo).url;
      if (typeof value !== 'string') {
        return null;
      }
      const image = new URL(value);
      return image.protocol === 'https:' && !image.username && !image.password ? image.href : null;
    } catch {
      return null;
    }
  }
}
