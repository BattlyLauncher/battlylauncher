import { formatPresenceServer } from '../../shared/social/presence-format';
import {
  parseMinecraftServerAddress,
  minecraftServerAddress,
} from '../../shared/minecraft/server-address';
import type { UsageHeartbeat } from '../mybattly/usage-history';
import type { UsageDay } from '../../shared/mybattly/mybattly-contract';
import { remoteHtmlToText } from '../../shared/home/home-contract';
import { OfflineSnapshotCache } from '../network/offline-snapshot-cache';
import {
  normalizeSocialUsername,
  type SocialAction,
  type SocialFriend,
  type SocialProfile,
  type ProfileCustomization,
  type ProfileBackgroundSelection,
  defaultProfileCustomization,
  type SocialSnapshot,
} from '../../shared/social/social-contract';

const maximumResponseBytes = 1024 * 1024;
const maximumProfileBackgroundBytes = 5 * 1024 * 1024;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid social ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function text(value: unknown, label: string, maximum = 128): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new TypeError(`Invalid social ${label}`);
  }
  return remoteHtmlToText(value, maximum).replace(/\s+/g, ' ').trim();
}

function optionalText(value: unknown, maximum: number, fallback = ''): string {
  if (typeof value !== 'string' || value.length > maximum) {
    return fallback;
  }
  const normalized = remoteHtmlToText(value, maximum).replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function usernames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('Invalid social usernames');
  }
  return value.map((name) => normalizeSocialUsername(text(name, 'username', 64)));
}

function presenceServer(value: unknown): SocialFriend['server'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const rawAddress = own(source, 'serverKey') ?? own(source, 'host');
  if (typeof rawAddress !== 'string' || rawAddress.length > 259) {
    return null;
  }
  const explicitPort = own(source, 'port');
  if (
    explicitPort !== undefined &&
    (typeof explicitPort !== 'number' ||
      !Number.isInteger(explicitPort) ||
      explicitPort < 1 ||
      explicitPort > 65535)
  ) {
    return null;
  }
  return parseMinecraftServerAddress(
    rawAddress,
    typeof explicitPort === 'number' ? explicitPort : 25565,
  );
}

async function json(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    throw new TypeError('Social response is too large');
  }
  if (!response.body) {
    throw new TypeError('Social response has no body');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maximumResponseBytes) {
      await reader.cancel();
      throw new TypeError('Social response is too large');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  } catch {
    throw new TypeError('Social response is invalid JSON');
  }
}

function baseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Social API must use HTTPS');
  }
  if (url.username || url.password) {
    throw new TypeError('Social API URL contains credentials');
  }
  return url;
}

function remoteColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

function remoteBackgroundUrl(value: unknown, base: URL): string | null {
  if (typeof value !== 'string' || !value || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value, base);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function remoteBackgroundValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2_048) {
    return null;
  }
  if (/^\/profile-backgrounds\/(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(value)) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function remoteCustomization(source: Record<string, unknown>): ProfileCustomization {
  const borderStyle = own(source, 'borderStyle');
  const width = Number(own(source, 'borderWidth'));
  const allowedStyles = new Set(['solid', 'dashed', 'dotted', 'double', 'groove', 'ridge']);
  return {
    borderColor: remoteColor(own(source, 'borderColor'), defaultProfileCustomization.borderColor),
    borderStyle: allowedStyles.has(String(borderStyle))
      ? (borderStyle as ProfileCustomization['borderStyle'])
      : defaultProfileCustomization.borderStyle,
    borderWidth:
      Number.isInteger(width) && width >= 1 && width <= 10
        ? width
        : defaultProfileCustomization.borderWidth,
    nameColor: remoteColor(own(source, 'nameColor'), defaultProfileCustomization.nameColor),
    backgroundColor: remoteColor(
      own(source, 'backgroundColor'),
      defaultProfileCustomization.backgroundColor,
    ),
    backgroundImage: remoteBackgroundValue(own(source, 'backgroundImage')),
  };
}

function profileBackgroundType(
  bytes: Buffer,
  filename: string,
): { mime: string; extension: string } {
  const extension = extname(filename).toLowerCase();
  if (bytes.length < 10 || bytes.length > maximumProfileBackgroundBytes) {
    throw new TypeError('La imagen de perfil debe ocupar como máximo 5 MB');
  }
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && extension === '.png') {
    return { mime: 'image/png', extension: '.png' };
  }
  if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && ['.jpg', '.jpeg'].includes(extension)) {
    return { mime: 'image/jpeg', extension };
  }
  const gif = bytes.subarray(0, 6).toString('ascii');
  if ((gif === 'GIF87a' || gif === 'GIF89a') && extension === '.gif') {
    return { mime: 'image/gif', extension: '.gif' };
  }
  throw new TypeError('Selecciona una imagen PNG, JPG o GIF válida');
}

export class SocialService {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #snapshots: OfflineSnapshotCache<SocialSnapshot>;
  readonly #pendingSnapshots = new Map<string, Promise<SocialSnapshot>>();

  constructor(
    apiUrl = 'https://api.battlylauncher.com/',
    fetchImplementation: typeof fetch = fetch,
    cacheDirectory?: string,
  ) {
    this.#baseUrl = baseUrl(apiUrl);
    this.#fetch = fetchImplementation;
    this.#snapshots = new OfflineSnapshotCache(cacheDirectory, (value) => {
      const data = objectValue(value, 'cached snapshot');
      const friends = own(data, 'friends');
      if (!Array.isArray(friends) || friends.length > 500) {
        throw new TypeError('Invalid cached friends');
      }
      return {
        friends: friends.map((value) => {
          const friend = objectValue(value, 'cached friend');
          return {
            username: normalizeSocialUsername(text(own(friend, 'username'), 'username', 64)),
            userId: text(own(friend, 'userId'), 'userId', 128),
            client: optionalText(own(friend, 'client'), 64),
            activity: optionalText(own(friend, 'activity'), 255),
            gameVersion: optionalText(own(friend, 'gameVersion'), 128),
            status: own(friend, 'status') === 'online' ? 'online' : 'offline',
            server: presenceServer(own(friend, 'server')),
          };
        }),
        receivedRequests: usernames(own(data, 'receivedRequests') ?? []),
        sentRequests: usernames(own(data, 'sentRequests') ?? []),
      };
    });
  }

  async snapshot(token: string, signal?: AbortSignal): Promise<SocialSnapshot> {
    // Individually cancellable callers keep their own request lifetime.
    if (signal) {
      return this.#loadSnapshot(token, signal);
    }
    let pending = this.#pendingSnapshots.get(token);
    if (!pending) {
      pending = this.#loadSnapshot(token).finally(() => this.#pendingSnapshots.delete(token));
      this.#pendingSnapshots.set(token, pending);
    }
    return structuredClone(await pending);
  }

  async #loadSnapshot(token: string, signal?: AbortSignal): Promise<SocialSnapshot> {
    const result = await this.#snapshots.load(
      token,
      () => this.#remoteSnapshot(token, signal),
      () => ({ friends: [], receivedRequests: [], sentRequests: [] }),
    );
    if (!result.cached) {
      return result.data;
    }
    return {
      ...result.data,
      friends: result.data.friends.map((friend) => ({
        ...friend,
        status: 'offline',
        server: null,
        gameVersion: '',
        activity: 'Desconectado',
      })),
    };
  }

  async #remoteSnapshot(token: string, signal?: AbortSignal): Promise<SocialSnapshot> {
    const optional = (
      request: Promise<Record<string, unknown>>,
      fallback: Record<string, unknown>,
    ) =>
      request.catch((error) => {
        if (signal?.aborted || /Social request failed \(40[13]\)/.test(String(error))) {
          throw error;
        }
        return fallback;
      });
    const [friendsResult, presenceResult, requestsResult] = await Promise.all([
      this.#request(token, 'api/v2/users/obtenerAmigos', 'POST', undefined, signal),
      optional(this.#request(token, 'api/presence/friends/presence', 'GET', undefined, signal), {
        friends: [],
      }),
      optional(this.#request(token, 'api/v2/users/obtenerSolicitudes', 'POST', undefined, signal), {
        recibidas: [],
        enviadas: [],
      }),
    ]);
    const rawFriends = own(friendsResult, 'amigos');
    if (!Array.isArray(rawFriends) || rawFriends.length > 500) {
      throw new TypeError('Invalid friends list');
    }
    const presence = own(presenceResult, 'friends');
    if (!Array.isArray(presence) || presence.length > 500) {
      throw new TypeError('Invalid presence list');
    }
    const presenceMap = new Map<string, Record<string, unknown>>();
    for (const candidate of presence) {
      try {
        const item = objectValue(candidate, 'presence');
        presenceMap.set(normalizeSocialUsername(text(own(item, 'username'), 'username', 64)), item);
      } catch {
        // One malformed presence must not make the complete friends panel disappear.
      }
    }
    const friends: SocialFriend[] = rawFriends.map((candidate) => {
      const friend = objectValue(candidate, 'friend');
      const username = normalizeSocialUsername(text(own(friend, 'username'), 'username', 64));
      const current = presenceMap.get(username);
      const rawClient = own(friend, 'client');
      const launcher =
        rawClient && typeof rawClient === 'object'
          ? own(objectValue(rawClient, 'client'), 'launcher')
          : rawClient;
      const battlyPresence = typeof launcher === 'string' && /battly/i.test(launcher);
      const rawStatus =
        current && own(current, 'source') === 'battly-launcher'
          ? own(current, 'status')
          : battlyPresence
            ? own(friend, 'estado')
            : current
              ? own(current, 'status')
              : own(friend, 'estado');
      const state = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : '';
      const online = !!state && !['offline', 'desconectado', '0', 'false'].includes(state);
      const server = presenceServer(current && own(current, 'server'));
      const rawDetails = optionalText(own(friend, 'details'), 255);
      const minecraftStatus =
        /^(?:ONLINE|OFFLINE|PLAYING_(?:OFFLINE|HOSTED_SERVER|REALMS|SERVER))$/.test(rawDetails);
      const activity = minecraftStatus ? 'Minecraft' : rawDetails || 'Jugando';
      return {
        userId: optionalText(own(friend, 'userId'), 128, username),
        username,
        status: online ? 'online' : 'offline',
        server: online ? server : null,
        gameVersion: online && !minecraftStatus ? optionalText(own(friend, 'details'), 128) : '',
        activity: online
          ? server
            ? `Jugando en ${formatPresenceServer(minecraftServerAddress(server))}`
            : activity
          : 'Desconectado',
        client: typeof launcher === 'string' ? text(launcher, 'client', 64) : '',
      };
    });
    return {
      friends,
      receivedRequests: usernames(own(requestsResult, 'recibidas') ?? []),
      sentRequests: usernames(own(requestsResult, 'enviadas') ?? []),
    };
  }

  async usageHeartbeat(token: string, body: UsageHeartbeat): Promise<void> {
    const result = await this.#request(
      token,
      'api/v2/users/game-stats/desktop/heartbeat',
      'POST',
      body,
      AbortSignal.timeout(2500),
    );
    if (own(result, 'status') !== 'OK') {
      throw new Error('Usage heartbeat rejected');
    }
  }

  async desktopUsage(
    token: string,
    signal?: AbortSignal,
  ): Promise<{ playedSeconds: number; days: UsageDay[] }> {
    const result = await this.#request(
      token,
      `api/v2/users/game-stats/desktop/history?days=90&offsetMinutes=${-new Date().getTimezoneOffset()}`,
      'GET',
      undefined,
      signal,
    );
    if (own(result, 'status') !== 'OK') {
      throw new Error('Usage history unavailable');
    }
    const data = objectValue(own(result, 'data'), 'usage');
    const playedSeconds = Number(own(data, 'tiempoJugado'));
    const history = own(data, 'days');
    if (
      !Number.isSafeInteger(playedSeconds) ||
      playedSeconds < 0 ||
      !Array.isArray(history) ||
      history.length > 90
    ) {
      throw new TypeError('Invalid usage history');
    }
    const seconds = (value: unknown): number => {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100_000_000
      ) {
        throw new TypeError('Invalid usage counter');
      }
      return value;
    };
    const days = history.map((row) => {
      const day = objectValue(row, 'day');
      const date = own(day, 'date');
      const hours = own(day, 'hours');
      if (
        typeof date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Array.isArray(hours) ||
        hours.length !== 24
      ) {
        throw new TypeError('Invalid usage day');
      }
      return {
        date,
        game: seconds(own(day, 'game')),
        launcher: seconds(own(day, 'launcher')),
        hours: hours.map((row, hour) => {
          const item = objectValue(row, 'hour');
          return {
            hour,
            game: seconds(own(item, 'game')),
            launcher: seconds(own(item, 'launcher')),
          };
        }),
      };
    });
    return { playedSeconds, days };
  }

  async playedSeconds(token: string, signal?: AbortSignal): Promise<number> {
    const result = await this.#request(
      token,
      'api/v2/users/getUserStats',
      'GET',
      undefined,
      signal,
    );
    if (own(result, 'error')) {
      throw new Error('Social statistics request failed');
    }
    const data = objectValue(own(result, 'data'), 'statistics');
    const seconds = Number(own(data, 'tiempoJugado'));
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      throw new TypeError('Invalid played time');
    }
    return seconds;
  }

  async profile(userId: string, token = '', signal?: AbortSignal): Promise<SocialProfile> {
    const result = await this.#request(
      token,
      `api/v2/users/profile/${encodeURIComponent(userId)}`,
      'GET',
      undefined,
      signal,
    );
    if (own(result, 'status') !== 200) {
      throw new Error('Social profile was not found');
    }
    const profile = objectValue(own(result, 'profile'), 'profile');
    const username = normalizeSocialUsername(text(own(profile, 'username'), 'username', 64));
    let publicProfile: Record<string, unknown> | null = null;
    try {
      const publicResponse = await this.#fetch(
        `https://battlylauncher.com/api/users/about/get/${encodeURIComponent(username)}`,
        {
          headers: { accept: 'application/json' },
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(6_000)])
            : AbortSignal.timeout(6_000),
        },
      );
      if (publicResponse.ok) {
        const publicRoot = objectValue(await json(publicResponse), 'public profile');
        publicProfile = objectValue(own(publicRoot, 'data'), 'public profile data');
      }
    } catch {
      publicProfile = null;
    }
    const list = (key: string): readonly string[] => {
      const value = own(profile, key) ?? [];
      if (!Array.isArray(value) || value.length > 50) {
        throw new TypeError(`Invalid profile ${key}`);
      }
      return value.map((item) => text(item, key, 64));
    };
    return {
      userId: text(own(profile, 'userId'), 'user id', 128),
      uuid: optionalText(own(profile, 'uuid') ?? own(publicProfile ?? {}, 'uuid'), 128) || null,
      username,
      bio: text(own(publicProfile ?? {}, 'bio') ?? own(profile, 'bio') ?? '', 'bio', 500),
      badges: list('badges'),
      roles: list('roles'),
      premium: own(profile, 'isPremium') === true,
      skinUrl: remoteBackgroundUrl(
        own(profile, 'skinUrl') ??
          `api/skin/${encodeURIComponent(text(own(profile, 'username'), 'username', 64))}.png`,
        this.#baseUrl,
      ),
      backgroundImageUrl: remoteBackgroundUrl(own(profile, 'backgroundImage'), this.#baseUrl),
      customization: remoteCustomization(profile),
      createdAt: (() => {
        const value =
          own(publicProfile ?? {}, 'creationDate') ??
          own(profile, 'createdAt') ??
          own(profile, 'creationDate') ??
          own(profile, 'created_at');
        return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
      })(),
    };
  }

  async updateProfile(
    token: string,
    customization: ProfileCustomization,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.#request(token, 'api/v2/users/profile', 'PUT', customization, signal);
    const status = own(result, 'status');
    if (status !== 200) {
      const message = own(result, 'message');
      throw new Error(
        typeof message === 'string' && message.length <= 500
          ? message
          : 'No se pudo guardar el perfil',
      );
    }
  }

  async uploadProfileBackground(
    token: string,
    bytes: Buffer,
    filename: string,
    signal?: AbortSignal,
  ): Promise<ProfileBackgroundSelection> {
    const type = profileBackgroundType(bytes, filename);
    const form = new FormData();
    form.append(
      'background',
      new Blob([Uint8Array.from(bytes)], { type: type.mime }),
      `background${type.extension}`,
    );
    const response = await this.#fetch(
      new URL('api/v2/users/profile/upload-background', this.#baseUrl),
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Profile background upload failed (${response.status})`);
    }
    const result = objectValue(await json(response), 'profile background upload');
    if (own(result, 'status') !== 200) {
      throw new Error('Profile background upload failed');
    }
    const value = remoteBackgroundValue(own(result, 'imageUrl'));
    const url = remoteBackgroundUrl(own(result, 'imageUrl'), this.#baseUrl);
    if (!value || !url) {
      throw new TypeError('Invalid profile background URL');
    }
    return { value, previewUrl: url };
  }

  async removeProfileBackground(token: string, signal?: AbortSignal): Promise<void> {
    const result = await this.#request(
      token,
      'api/v2/users/profile/background',
      'DELETE',
      undefined,
      signal,
    );
    if (own(result, 'status') !== undefined && own(result, 'status') !== 200) {
      throw new Error('Profile background removal failed');
    }
  }

  async search(token: string, query: string, signal?: AbortSignal): Promise<readonly string[]> {
    const result = await this.#request(
      token,
      'api/v2/users/buscarUsuarios',
      'POST',
      { username: query },
      signal,
    );
    return usernames(own(result, 'usuarios') ?? []);
  }

  async action(
    token: string,
    action: SocialAction,
    username: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const endpoints: Record<SocialAction, readonly [string, string]> = {
      send: ['api/v2/users/enviarSolicitud', 'amigo'],
      accept: ['api/v2/users/aceptarSolicitud', 'solicitud'],
      reject: ['api/v2/users/rechazarSolicitud', 'amigo'],
      cancel: ['api/v2/users/cancelarSolicitud', 'amigo'],
      remove: ['api/v2/social/friends/remove', 'username'],
    };
    const [endpoint, field] = endpoints[action];
    const result = await this.#request(token, endpoint, 'POST', { [field]: username }, signal);
    if (own(result, 'status') !== 200) {
      throw new Error('Social action failed');
    }
  }

  async #request(
    token: string,
    path: string,
    method: 'DELETE' | 'GET' | 'POST' | 'PUT',
    body?: object,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.#fetch(new URL(path, this.#baseUrl), {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Social request failed (${response.status}): ${method} ${path}`);
    }
    return objectValue(await json(response), 'response');
  }
}
import { extname } from 'node:path';
