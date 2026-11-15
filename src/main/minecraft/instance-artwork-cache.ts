import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstanceSummary, InstanceArtwork } from '../../shared/minecraft/instance';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ModrinthClient } from '../mods/modrinth-client';
import { CurseForgeArtworkClient } from '../mods/curseforge-artwork-client';
import { sameModpackName } from '../mods/modpack-name';

interface CacheEntry {
  schemaVersion: number;
  name: string;
  expires: number;
  explicit: boolean;
  artwork: InstanceArtwork | null;
}

export interface InstanceArtworkCacheOptions {
  readonly curseForgeApiBaseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
}

function artworkValue(value: unknown): InstanceArtwork | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const provider = item.provider === 'curseforge' ? 'curseforge' : 'modrinth';
  if (typeof item.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.projectId)) {
    return null;
  }
  for (const [field, maximum] of [
    ['title', 512],
    ['description', 2000],
    ['author', 256],
  ] as const) {
    if (typeof item[field] !== 'string' || item[field].length > maximum) {
      return null;
    }
  }
  if (
    typeof item.downloads !== 'number' ||
    !Number.isSafeInteger(item.downloads) ||
    item.downloads < 0
  ) {
    return null;
  }
  for (const field of ['coverUrl', 'iconUrl'] as const) {
    if (item[field] === null) {
      continue;
    }
    if (typeof item[field] !== 'string' || item[field].length > 4096) {
      return null;
    }
    const url = new URL(item[field]);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
  }
  const coverUrls: string[] = [];
  if (Array.isArray(item.coverUrls)) {
    for (const value of item.coverUrls.slice(0, 100)) {
      if (typeof value !== 'string' || value.length > 4096) {
        continue;
      }
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        coverUrls.push(url.toString());
      }
    }
  }
  return {
    provider,
    projectId: item.projectId,
    title: item.title as string,
    description: item.description as string,
    author: item.author as string,
    downloads: item.downloads,
    iconUrl: item.iconUrl as string | null,
    coverUrl: item.coverUrl as string | null,
    coverUrls,
  };
}

export class InstanceArtworkCache {
  private readonly pending = new Map<string, Promise<InstanceSummary>>();
  private readonly curseForge: CurseForgeArtworkClient;
  constructor(
    private readonly root: string,
    private readonly client: ModrinthClient,
    options: InstanceArtworkCacheOptions = {},
  ) {
    this.curseForge = new CurseForgeArtworkClient(
      options.curseForgeApiBaseUrl,
      options.fetchImplementation,
    );
  }

  enrich(instance: InstanceSummary, projectId?: string): Promise<InstanceSummary> {
    const key = instance.id + ':' + instance.name + ':' + (projectId ?? '');
    const existing = this.pending.get(key);
    if (existing) {
      return existing;
    }
    const result = this.load(instance, projectId)
      .catch(() => instance)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, result);
    return result;
  }

  async list(instances: readonly InstanceSummary[]): Promise<InstanceSummary[]> {
    const output: InstanceSummary[] = [];
    for (let offset = 0; offset < instances.length; offset += 3) {
      output.push(
        ...(await Promise.all(
          instances.slice(offset, offset + 3).map((instance) => this.enrich(instance)),
        )),
      );
    }
    return output;
  }

  private async load(instance: InstanceSummary, projectId?: string): Promise<InstanceSummary> {
    const path = join(this.root, createHash('sha256').update(instance.id).digest('hex') + '.json');
    let cached: CacheEntry | null = null;
    try {
      const raw: unknown = JSON.parse(
        (await readBoundedRegularFile(path, 100_000)).toString('utf8'),
      );
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const value = raw as Record<string, unknown>;
        if (
          typeof value.name === 'string' &&
          typeof value.expires === 'number' &&
          Number.isFinite(value.expires)
        ) {
          cached = {
            name: value.name,
            expires: value.expires,
            explicit: value.explicit === true,
            schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : 1,
            artwork: artworkValue(value.artwork),
          };
        }
      }
    } catch {
      // Old or damaged metadata is refreshed without touching the instance itself.
    }
    const matching = cached?.name === instance.name || cached?.explicit === true;
    if (!projectId && cached?.schemaVersion === 3 && matching && cached.expires > Date.now()) {
      return cached.artwork ? { ...instance, artwork: cached.artwork } : instance;
    }
    let artwork: InstanceArtwork | null;
    let expires = Date.now() + 7 * 86_400_000;
    const explicit = Boolean(projectId) || Boolean(matching && cached?.explicit);
    const previous = matching ? cached?.artwork : null;
    try {
      if (!projectId && previous?.provider === 'curseforge') {
        artwork = await this.curseForge.project(previous.projectId);
      } else {
        // A supplied project ID comes directly from an installation and wins over name matching.
        const knownId = projectId ?? previous?.projectId;
        let modrinthFailed = false;
        try {
          artwork = await this.modrinth(instance.name, knownId);
        } catch {
          modrinthFailed = true;
          artwork = null;
        }
        if (!artwork) {
          const found = await this.curseForge.find(instance.name, AbortSignal.timeout(16_000));
          artwork = found?.artwork ?? (modrinthFailed ? (previous ?? null) : null);
          if (modrinthFailed || found?.retrySoon) {
            expires = Date.now() + 15 * 60_000;
          }
        }
      }
      if (artwork && expires > Date.now() + 60 * 60_000) {
        expires = Date.now() + 30 * 86_400_000;
      }
    } catch {
      artwork = previous ?? null;
      expires = Date.now() + 15 * 60_000;
    }
    await mkdir(this.root, { recursive: true });
    await writeFileAtomically(
      path,
      JSON.stringify({ schemaVersion: 3, name: instance.name, expires, explicit, artwork }),
    );
    return artwork ? { ...instance, artwork } : instance;
  }

  private async modrinth(name: string, knownId?: string): Promise<InstanceArtwork | null> {
    const signal = AbortSignal.timeout(8000);
    let projectId = knownId;
    let author = '';
    let selectedCover: string | null = null;
    if (!projectId) {
      const result = await this.client.search(
        {
          query: name,
          projectType: 'modpack',
          sort: 'relevance',
          loader: null,
          category: null,
          gameVersions: [],
          offset: 0,
          limit: 12,
        },
        signal,
      );
      const hit = result.projects.find((project) => sameModpackName(name, project.title));
      if (!hit) {
        return null;
      }
      projectId = hit.id;
      author = hit.author;
      selectedCover = hit.featuredGallery ?? hit.gallery?.[0] ?? null;
      // Search carries the exact selected project's featured cover and all card metadata.
      if (selectedCover) {
        return {
          provider: 'modrinth',
          projectId,
          title: hit.title,
          description: hit.description,
          author,
          downloads: hit.downloads,
          iconUrl: hit.iconUrl,
          coverUrl: selectedCover,
          coverUrls: [
            ...new Set(
              [hit.featuredGallery, ...(hit.gallery ?? [])].filter((url): url is string =>
                Boolean(url),
              ),
            ),
          ],
        };
      }
    }
    const project = await this.client.project(projectId, signal);
    if (!author) {
      author =
        (await this.client.projectMembers(project.teamId, signal).catch(() => []))[0]?.username ??
        '';
    }
    const coverUrls = [
      ...new Set(
        [
          selectedCover,
          project.gallery.find((image) => image.featured)?.url,
          ...project.gallery.map((image) => image.url),
        ].filter((url): url is string => Boolean(url)),
      ),
    ];
    return {
      provider: 'modrinth',
      projectId,
      title: project.title,
      description: project.description,
      author,
      downloads: project.downloads,
      iconUrl: project.iconUrl,
      coverUrl: coverUrls[0] ?? null,
      coverUrls,
    };
  }
}
