import { readBoundedResponse } from '../network/read-bounded-response';
import type { MusicPlaylistImport, MusicSong } from '../../shared/music/music-contract';

const maximumResponseBytes = 2 * 1024 * 1024;
const maximumPolls = 120;

function spotifyPlaylistUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new TypeError('Invalid Spotify playlist URL');
  }
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'open.spotify.com' ||
    !/^\/playlist\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  ) {
    throw new TypeError('Invalid Spotify playlist URL');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const content = await readBoundedResponse(
    response,
    maximumResponseBytes,
    'Spotify import response is too large',
  );
  const value = JSON.parse(content) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Spotify import response');
  }
  return value as Record<string, unknown>;
}

function apiMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : fallback;
}

function youtubeSong(value: unknown): MusicSong {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new TypeError('Invalid converted YouTube URL');
  }
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    !['www.youtube.com', 'youtube.com', 'youtu.be'].includes(url.hostname)
  ) {
    throw new TypeError('Invalid converted YouTube URL');
  }
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new TypeError('Invalid converted YouTube video id');
  }
  return {
    id,
    title: 'Desconocido',
    artist: 'Desconocido',
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    durationSeconds: 0,
  };
}

export class SpotifyImportService {
  readonly #base: URL;
  readonly #fetch: typeof fetch;

  constructor(baseUrl = 'https://battlylauncher.com/', fetchImplementation: typeof fetch = fetch) {
    this.#base = new URL(baseUrl);
    if (this.#base.protocol !== 'https:' || this.#base.username || this.#base.password) {
      throw new TypeError('Spotify conversion API must use HTTPS');
    }
    this.#fetch = fetchImplementation;
  }

  async importPlaylist(
    token: string,
    value: unknown,
    onProgress: (progress: number) => void,
  ): Promise<MusicPlaylistImport> {
    if (!token || token.length > 16_384) {
      throw new TypeError('Invalid Battly token');
    }
    const url = spotifyPlaylistUrl(value);
    const started = await this.#fetch(new URL('api/spotify/playlist-to-youtube', this.#base), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ spotifyUrl: url }),
      redirect: 'error',
    });
    const startData = await json(started);
    if (!started.ok) {
      throw new Error(apiMessage(startData.message, 'Error al iniciar la conversión'));
    }
    const taskId = startData.taskId;
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) {
      throw new TypeError('Invalid Spotify conversion task');
    }
    onProgress(0);
    for (let poll = 0; poll < maximumPolls; poll += 1) {
      if (poll) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      const response = await this.#fetch(
        new URL(`api/spotify/playlist-to-youtube/${encodeURIComponent(taskId)}`, this.#base),
        { headers: { authorization: `Bearer ${token}` }, redirect: 'error' },
      );
      const data = await json(response);
      if (!response.ok) {
        throw new Error(apiMessage(data.message, 'Error al consultar el estado'));
      }
      if (data.status === 'completed') {
        if (!Array.isArray(data.youtubeUrls) || data.youtubeUrls.length > 500) {
          throw new TypeError('Invalid Spotify conversion songs');
        }
        const songs = data.youtubeUrls.filter(Boolean).map(youtubeSong);
        if (!songs.length) {
          throw new Error('Spotify no devolvió canciones compatibles');
        }
        onProgress(100);
        return { title: 'Playlist de Spotify', songs };
      }
      if (data.status !== 'pending') {
        throw new Error('Estado de conversión de Spotify inválido');
      }
      const progress = Number(data.progress);
      if (Number.isFinite(progress)) {
        onProgress(Math.max(0, Math.min(99, Math.round(progress))));
      }
    }
    throw new Error('La conversión de Spotify tardó demasiado');
  }
}
