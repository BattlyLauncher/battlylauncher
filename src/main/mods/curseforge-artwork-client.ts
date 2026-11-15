import { readBoundedResponse } from '../network/read-bounded-response';
import { remoteHtmlToText } from '../../shared/home/home-contract';
import type { InstanceArtwork } from '../../shared/minecraft/instance';
import { modpackSlugs, normalizeModpackName, sameModpackName } from './modpack-name';

type Source = Record<string, unknown>;
const record = (value: unknown): Source =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Source) : {};
const plain = (value: unknown, max = 512): string =>
  typeof value === 'string' ? remoteHtmlToText(value, max).trim() : '';
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const imageUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 4096) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
};

export interface CurseForgeArtworkResult {
  readonly artwork: InstanceArtwork;
  readonly retrySoon: boolean;
}

/** Discover public project IDs via CFWidget, then use Battly's existing CurseForge proxy. */
export class CurseForgeArtworkClient {
  private readonly base: URL;
  constructor(
    baseUrl = 'https://api.battlylauncher.com/curseforge/',
    private readonly request: typeof fetch = fetch,
  ) {
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(this.base.hostname);
    if (
      this.base.username ||
      this.base.password ||
      (this.base.protocol !== 'https:' && !(local && this.base.protocol === 'http:'))
    ) {
      throw new TypeError('Invalid CurseForge artwork API URL');
    }
  }

  async find(name: string, signal?: AbortSignal): Promise<CurseForgeArtworkResult | null> {
    for (const slug of modpackSlugs(name)) {
      const widget = await this.get(
        new URL(`minecraft/modpacks/${slug}`, 'https://api.cfwidget.com/'),
        signal,
      );
      if (!widget) {
        continue;
      }
      const title = plain(widget.title);
      const canonical = imageUrl(record(widget.urls).curseforge);
      const canonicalSlug =
        canonical && new URL(canonical).hostname === 'www.curseforge.com'
          ? new URL(canonical).pathname.match(/^\/minecraft\/modpacks\/([^/]+)\/?$/)?.[1]
          : null;
      const exactPath =
        canonicalSlug && normalizeModpackName(canonicalSlug) === normalizeModpackName(name);
      if (
        widget.game !== 'minecraft' ||
        widget.type !== 'Modpacks' ||
        (!sameModpackName(name, title) && !exactPath)
      ) {
        continue;
      }
      const id = count(widget.id);
      if (!id) {
        continue;
      }
      try {
        return { artwork: await this.project(String(id), signal), retrySoon: false };
      } catch {
        const members = Array.isArray(widget.members) ? widget.members : [];
        return {
          artwork: {
            provider: 'curseforge',
            projectId: String(id),
            title,
            description: plain(widget.summary, 2000),
            author: plain(record(members[0]).username, 256),
            downloads: count(record(widget.downloads).total),
            iconUrl: imageUrl(widget.thumbnail),
            coverUrl: null,
            coverUrls: [],
          },
          retrySoon: true,
        };
      }
    }
    return null;
  }

  async project(id: string, signal?: AbortSignal): Promise<InstanceArtwork> {
    if (!/^\d{1,12}$/.test(id)) {
      throw new TypeError('Invalid CurseForge project ID');
    }
    const envelope = await this.get(new URL(`mod/${id}`, this.base), signal);
    if (!envelope) {
      throw new Error('CurseForge project unavailable');
    }
    const wrapped = record(envelope.data);
    const project = record(wrapped.data ?? wrapped);
    if (count(project.id) !== Number(id) || project.gameId !== 432 || project.classId !== 4471) {
      throw new TypeError('CurseForge project is not a Minecraft modpack');
    }
    const screenshots = Array.isArray(project.screenshots) ? project.screenshots : [];
    const authors = Array.isArray(project.authors) ? project.authors : [];
    const logo = record(project.logo);
    const coverUrls = screenshots
      .map((screenshot) => imageUrl(record(screenshot).url))
      .filter((url): url is string => Boolean(url));
    return {
      provider: 'curseforge',
      projectId: id,
      title: plain(project.name),
      description: plain(project.summary, 2000),
      author: authors
        .slice(0, 3)
        .map((author) => plain(record(author).name, 80))
        .filter(Boolean)
        .join(', '),
      downloads: count(project.downloadCount),
      iconUrl: imageUrl(logo.url) ?? imageUrl(logo.thumbnailUrl),
      coverUrl: coverUrls[0] ?? null,
      coverUrls,
    };
  }

  private async get(url: URL, signal?: AbortSignal): Promise<Source | null> {
    const response = await this.request(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'BattlyLauncher/3.1.0 (+https://battlylauncher.com)',
      },
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`CurseForge artwork request failed (${response.status})`);
    }
    const content = await readBoundedResponse(
      response,
      4 * 1024 * 1024,
      'CurseForge artwork response is too large',
    );
    return record(JSON.parse(content) as unknown);
  }
}
