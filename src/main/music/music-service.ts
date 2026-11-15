import { readBoundedResponse } from '../network/read-bounded-response';
import { isAbsolute } from 'node:path';

import { parseMusicDuration } from '../../shared/music/music-contract';
import { remoteHtmlToText } from '../../shared/home/home-contract';
import type {
  MusicCollaborationInvite,
  MusicFavoriteDraft,
  MusicPlaylist,
  MusicPlaylistActivity,
  MusicPlaylistCollaboration,
  MusicPlaylistShare,
  MusicPlaylistUpdateDraft,
  MusicSnapshot,
  MusicSong,
} from '../../shared/music/music-contract';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { OfflineSnapshotCache } from '../network/offline-snapshot-cache';

const maximumResponseBytes = 4 * 1024 * 1024;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid music ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new TypeError(`Invalid music ${label}`);
  }
  const normalized = remoteHtmlToText(value, maximum).replace(/\s+/g, ' ').trim();
  if (!allowEmpty && !normalized) {
    throw new TypeError(`Invalid music ${label}`);
  }
  return normalized;
}

function safeUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.length > 4096) {
    throw new TypeError('Invalid music URL');
  }
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Invalid music URL');
  }
  if (url.username || url.password) {
    throw new TypeError('Invalid music URL');
  }
  return url.toString();
}

function song(value: unknown): MusicSong {
  const source = object(value, 'song');
  const durationSeconds =
    parseMusicDuration(own(source, 'durationSeconds')) ||
    parseMusicDuration(own(source, 'duration')) ||
    parseMusicDuration(own(source, 'duration_string')) ||
    parseMusicDuration(own(source, 'lengthSeconds'));
  return {
    id: text(own(source, 'id') ?? own(source, '_id') ?? own(source, 'musicID'), 'song id', 128),
    title: text(own(source, 'title') || own(source, 'name') || 'Sin título', 'song title', 300),
    artist: text(
      own(source, 'artist') || own(source, 'author') || own(source, 'author_name') || 'Desconocido',
      'song artist',
      200,
    ),
    thumbnailUrl: safeUrl(
      own(source, 'thumbnail') ?? own(source, 'thumbnailUrl') ?? own(source, 'thumbnail_url'),
    ),
    sourceUrl: safeUrl(own(source, 'src') ?? own(source, 'sourceUrl') ?? own(source, 'audioUrl')),
    durationSeconds,
  };
}

function playlist(value: unknown): MusicPlaylist {
  const source = object(value, 'playlist');
  const songs = own(source, 'songs');
  if (!Array.isArray(songs) || songs.length > 500) {
    throw new TypeError('Invalid playlist songs');
  }
  const collaboration = own(source, 'collaboration');
  const collaborationData =
    collaboration && typeof collaboration === 'object'
      ? object(collaboration, 'collaboration')
      : {};
  const permissions = own(source, 'permissions');
  const permissionData =
    permissions && typeof permissions === 'object' ? object(permissions, 'permissions') : {};
  const virtual = own(source, 'virtual') === true;
  return {
    id: text(own(source, '_id') ?? own(source, 'id'), 'playlist id', 128),
    name: text(own(source, 'name'), 'playlist name', 100),
    description: text(own(source, 'description') ?? '', 'playlist description', 500, true),
    coverUrl: safeUrl(own(source, 'cover')),
    songs: songs.map(song),
    collaborative:
      own(collaborationData, 'enabled') === true ||
      Number(own(collaborationData, 'collaboratorsCount')) > 0,
    canDelete: !virtual && own(permissionData, 'canDelete') !== false,
    canEditMetadata: !virtual && own(permissionData, 'isOwner') !== false,
    canEditSongs: !virtual && own(permissionData, 'canEditSongs') !== false,
    canShare: !virtual && own(permissionData, 'canShare') !== false,
    canManageCollaboration:
      own(permissionData, 'canManageCollaboration') === true ||
      own(permissionData, 'isOwner') === true,
  };
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const result = text(value, 'date', 64);
  return Number.isNaN(Date.parse(result)) ? null : result;
}

async function responseJson(response: Response): Promise<unknown> {
  const content = await readBoundedResponse(
    response,
    maximumResponseBytes,
    'Music response is too large',
  );
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new TypeError('Music response is invalid JSON');
  }
}

function apiBase(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Music API must use HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('Music API URL contains credentials');
  }
  return url;
}

export class MusicService {
  readonly #base: URL;
  readonly #cachePath: string;
  readonly #fetch: typeof fetch;
  readonly #metadata = new Map<string, MusicSong>();
  readonly #favoritesCache: OfflineSnapshotCache<readonly MusicSong[]>;

  constructor(
    cachePath: string,
    apiUrl = 'https://musicapi.battlylauncher.com/',
    fetchImplementation: typeof fetch = fetch,
  ) {
    if (!isAbsolute(cachePath)) {
      throw new TypeError('Music cache path must be absolute');
    }
    this.#cachePath = cachePath;
    this.#base = apiBase(apiUrl);
    this.#fetch = fetchImplementation;
    this.#favoritesCache = new OfflineSnapshotCache(cachePath + '.favorites', (value) => {
      if (!Array.isArray(value)) {
        throw new TypeError('Invalid music favorites');
      }
      return value.map(song);
    });
  }

  async snapshot(token: string): Promise<MusicSnapshot> {
    try {
      let featured: readonly MusicSong[] = [];
      let homePlaylists: readonly MusicPlaylist[] = [];
      let promotedSong: MusicSong | null = null;
      try {
        const homeResult = await this.#request(token, 'api/home');
        if (homeResult.promotedSong) {
          promotedSong = song(homeResult.promotedSong);
        }
        const sections = own(homeResult, 'sections');
        if (!Array.isArray(sections) || sections.length > 20) {
          throw new TypeError('Invalid music home');
        }
        const endpoints = sections.map((candidate) => {
          const section = object(candidate, 'home section');
          const endpoint = text(own(section, 'endpoint'), 'home endpoint', 160);
          if (!/^\/api\/home\/[a-z0-9-]+$/.test(endpoint)) {
            throw new TypeError('Invalid music home endpoint');
          }
          return {
            endpoint,
            slug: text(own(section, 'slug'), 'home slug', 80),
          };
        });
        const homeResponses = (
          await Promise.allSettled(
            endpoints.map(async ({ endpoint, slug }) => ({
              slug,
              value: await this.#request(token, endpoint.slice(1)),
            })),
          )
        ).flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        const parsedHome = homeResponses.map(({ value }) => playlist(own(value, 'playlist')));
        const recentIndex = homeResponses.findIndex(({ slug }) => slug === 'recent');
        const recent = recentIndex >= 0 ? parsedHome[recentIndex] : undefined;
        featured = await Promise.all(
          (recent?.songs ?? []).map((candidate) => this.#enrichSong(candidate)),
        );
        homePlaylists = parsedHome.filter((_, index) => index !== recentIndex);
      } catch {
        // Older Music API deployments only expose the public top endpoint.
        const topResult = await this.#request('', 'api/v1/top');
        const top = own(topResult, 'songs');
        if (!Array.isArray(top) || top.length > 100) {
          throw new TypeError('Invalid music top songs');
        }
        featured = await Promise.all(top.map((candidate) => this.#enrichSong(candidate)));
      }
      const playlistsResult = await this.#request(token, 'api/user/playlists');
      const lists = own(playlistsResult, 'playlists');
      if (!Array.isArray(lists) || lists.length > 200) {
        throw new TypeError('Invalid music snapshot');
      }
      const snapshot: MusicSnapshot = {
        promotedSong,
        featured,
        homePlaylists,
        playlists: lists.map(playlist),
        fromCache: false,
      };
      await writeFileAtomically(this.#cachePath, `${JSON.stringify(snapshot)}\n`);
      return snapshot;
    } catch (error) {
      try {
        const cached = JSON.parse(
          (await readBoundedRegularFile(this.#cachePath, maximumResponseBytes)).toString('utf8'),
        ) as unknown;
        const source = object(cached, 'cache');
        const featured = own(source, 'featured');
        const homePlaylists = own(source, 'homePlaylists');
        const playlists = own(source, 'playlists');
        if (!Array.isArray(featured) || !Array.isArray(playlists)) {
          throw new TypeError('Invalid music cache', { cause: error });
        }
        return {
          // A cached promotion may have been disabled or expired while offline.
          promotedSong: null,
          featured: featured.map(song),
          homePlaylists: Array.isArray(homePlaylists) ? homePlaylists.map(playlist) : [],
          playlists: playlists.map(playlist),
          fromCache: true,
        };
      } catch {
        throw error;
      }
    }
  }

  async recordPlay(token: string, id: string): Promise<void> {
    await this.#request(token, `api/v1/play/${encodeURIComponent(id)}`);
  }

  async favorites(token: string): Promise<readonly MusicSong[]> {
    return (
      await this.#favoritesCache.load(
        token,
        async () => {
          const result = await this.#request(token, 'api/user/likes');
          const songs = own(result, 'songs');
          if (!Array.isArray(songs) || songs.length > 500) {
            throw new TypeError('Invalid music favorites');
          }
          return Promise.all(songs.map((candidate) => this.#enrichSong(candidate)));
        },
        () => [],
      )
    ).data;
  }

  async setFavorite(
    token: string,
    favorite: MusicFavoriteDraft,
    enabled: boolean,
  ): Promise<readonly MusicSong[]> {
    await this.#request(
      token,
      `api/user/likes/${encodeURIComponent(favorite.id)}`,
      enabled ? 'POST' : 'DELETE',
      enabled
        ? { title: favorite.title, artist: favorite.artist, thumbnail: favorite.thumbnailUrl ?? '' }
        : undefined,
    );
    return this.favorites(token);
  }

  async createPlaylist(
    token: string,
    draft: {
      readonly name: string;
      readonly description: string;
      readonly songs: readonly string[];
    },
  ): Promise<MusicPlaylist> {
    const result = await this.#request(token, 'api/user/playlist/create', 'POST', draft);
    return playlist(own(result, 'playlist'));
  }

  async updatePlaylist(
    token: string,
    playlistId: string,
    draft: MusicPlaylistUpdateDraft,
  ): Promise<MusicPlaylist> {
    const result = await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/edit`,
      'PATCH',
      draft,
    );
    return playlist(own(result, 'playlist'));
  }

  async updatePlaylistSongs(
    token: string,
    playlistId: string,
    songs: readonly string[],
  ): Promise<MusicPlaylist> {
    const result = await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/songs`,
      'PUT',
      { songs },
    );
    return playlist(own(result, 'playlist'));
  }

  async deletePlaylist(token: string, playlistId: string): Promise<void> {
    await this.#request(token, `api/user/playlist/${encodeURIComponent(playlistId)}`, 'DELETE');
  }

  async sharePlaylist(token: string, playlistId: string): Promise<MusicPlaylistShare> {
    const result = await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/share`,
      'POST',
      { regenerate: false, expiresInDays: null },
    );
    const share = object(own(result, 'share'), 'playlist share');
    const url = safeUrl(own(share, 'url'));
    if (!url) {
      throw new TypeError('Invalid music playlist share URL');
    }
    return { url };
  }

  async importSharedPlaylist(token: string, shareToken: string): Promise<MusicPlaylist> {
    const result = await this.#request(
      token,
      `api/public/playlist/${encodeURIComponent(shareToken)}/import`,
      'POST',
    );
    return playlist(own(result, 'playlist'));
  }

  async collaborationInvites(token: string): Promise<readonly MusicCollaborationInvite[]> {
    const result = await this.#request(token, 'api/user/collaboration/invites');
    const invites = own(result, 'invites');
    if (!Array.isArray(invites) || invites.length > 200) {
      throw new TypeError('Invalid collaboration invites');
    }
    return invites.map((candidate) => {
      const invite = object(candidate, 'invite');
      return {
        id: text(own(invite, '_id'), 'invite id', 128),
        playlistId: text(own(invite, 'playlistId'), 'playlist id', 128),
        playlistName: text(own(invite, 'playlistName'), 'playlist name', 100),
        ownerUsername: text(own(invite, 'ownerUsername'), 'owner username', 64),
      };
    });
  }

  async playlistCollaboration(
    token: string,
    playlistId: string,
  ): Promise<MusicPlaylistCollaboration> {
    const result = await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/collaboration`,
    );
    const collaboration = object(own(result, 'collaboration'), 'playlist collaboration');
    const owner = object(own(collaboration, 'owner'), 'playlist owner');
    const permissions = object(own(collaboration, 'permissions') ?? {}, 'playlist permissions');
    const collaborators = own(collaboration, 'collaborators');
    const pendingInvites = own(collaboration, 'pendingInvites');
    if (!Array.isArray(collaborators) || collaborators.length > 50) {
      throw new TypeError('Invalid music collaborators');
    }
    if (!Array.isArray(pendingInvites) || pendingInvites.length > 100) {
      throw new TypeError('Invalid music pending invites');
    }
    const maximum = Number(own(collaboration, 'maxCollaborators'));
    return {
      ownerUsername: text(own(owner, 'username'), 'owner username', 64),
      collaborators: collaborators.map((value) => {
        const member = object(value, 'collaborator');
        return {
          id: text(own(member, 'userId') ?? own(member, '_id'), 'collaborator id', 128),
          username: text(own(member, 'username'), 'collaborator username', 64),
          addedAt: optionalDate(own(member, 'addedAt')),
        };
      }),
      pendingInvites: pendingInvites.map((value) => {
        const invite = object(value, 'pending invite');
        return {
          id: text(own(invite, '_id') ?? own(invite, 'id'), 'pending invite id', 128),
          username: text(
            own(invite, 'targetUsername') ?? own(invite, 'targetUserId'),
            'invite username',
            64,
          ),
          expiresAt: optionalDate(own(invite, 'expiresAt')),
        };
      }),
      maxCollaborators:
        Number.isSafeInteger(maximum) && maximum > 0 && maximum <= 50 ? maximum : 10,
      canManage: own(permissions, 'canManageCollaboration') === true,
    };
  }

  async invitePlaylistCollaborator(
    token: string,
    playlistId: string,
    username: string,
  ): Promise<void> {
    await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/collaboration/invite`,
      'POST',
      { username },
    );
  }

  async cancelPlaylistInvite(token: string, playlistId: string, inviteId: string): Promise<void> {
    await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/collaboration/invite/${encodeURIComponent(inviteId)}`,
      'DELETE',
    );
  }

  async removePlaylistCollaborator(
    token: string,
    playlistId: string,
    collaboratorId: string,
  ): Promise<void> {
    await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/collaboration/collaborator/${encodeURIComponent(collaboratorId)}`,
      'DELETE',
    );
  }

  async playlistActivity(
    token: string,
    playlistId: string,
  ): Promise<readonly MusicPlaylistActivity[]> {
    const result = await this.#request(
      token,
      `api/user/playlist/${encodeURIComponent(playlistId)}/activity?limit=80`,
    );
    const logs = own(result, 'logs');
    if (!Array.isArray(logs) || logs.length > 200) {
      throw new TypeError('Invalid music activity');
    }
    return logs.map((value, index) => {
      const log = object(value, 'activity');
      const actorValue = own(log, 'actor');
      const actor =
        actorValue && typeof actorValue === 'object' ? object(actorValue, 'activity actor') : {};
      return {
        id: text(own(log, '_id') ?? own(log, 'id') ?? `activity_${index}`, 'activity id', 128),
        action: text(own(log, 'action') ?? own(log, 'type') ?? 'update', 'activity action', 100),
        actorUsername: text(
          own(log, 'actorUsername') ?? own(actor, 'username') ?? 'Battly',
          'activity actor',
          64,
        ),
        createdAt: optionalDate(own(log, 'createdAt')),
      };
    });
  }

  async respondInvite(token: string, inviteId: string, action: 'accept' | 'reject'): Promise<void> {
    await this.#request(
      token,
      `api/user/collaboration/invites/${encodeURIComponent(inviteId)}/respond`,
      'POST',
      { action },
    );
  }

  async #enrichSong(value: unknown): Promise<MusicSong> {
    const parsed = song(value);
    if (parsed.title !== 'Sin título' && parsed.thumbnailUrl) {
      return parsed;
    }
    const cached = this.#metadata.get(parsed.id);
    if (cached) {
      return cached;
    }
    if (!/^[a-zA-Z0-9_-]{6,32}$/.test(parsed.id)) {
      return parsed;
    }
    try {
      const endpoint = new URL('https://www.youtube.com/oembed');
      endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${parsed.id}`);
      endpoint.searchParams.set('format', 'json');
      const response = await this.#fetch(endpoint, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) {
        return parsed;
      }
      const metadata = object(await responseJson(response), 'YouTube metadata');
      const enriched = song({
        ...metadata,
        id: parsed.id,
        title: own(metadata, 'title') ?? parsed.title,
        artist: own(metadata, 'author_name') ?? parsed.artist,
        thumbnail: own(metadata, 'thumbnail_url') ?? parsed.thumbnailUrl,
        durationSeconds: parsed.durationSeconds,
      });
      this.#metadata.set(parsed.id, enriched);
      return enriched;
    } catch {
      return parsed;
    }
  }

  async #request(
    token: string,
    path: string,
    method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' = 'GET',
    body?: object,
  ): Promise<Record<string, unknown>> {
    const response = await this.#fetch(new URL(path, this.#base), {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      throw new Error(`Music request failed (${response.status})`);
    }
    return object(await responseJson(response), 'response');
  }
}
