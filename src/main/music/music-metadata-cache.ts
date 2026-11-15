import { isAbsolute } from 'node:path';

import { parseMusicDuration, type MusicSong } from '../../shared/music/music-contract';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';

interface MetadataEntry {
  readonly song: MusicSong | null;
  readonly expiresAt: number;
  readonly retryAt: number;
}

const successLifetime = 30 * 24 * 60 * 60 * 1000;
const failureLifetime = 15 * 60 * 1000;
const maximumEntries = 2_000;

/** Public video metadata only. Audio URLs, account tokens and search queries never go here. */
export class MusicMetadataCache {
  readonly #path: string;
  readonly #entries = new Map<string, MetadataEntry>();
  #loading: Promise<void> | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path)) {
      throw new TypeError('Music metadata cache path must be absolute');
    }
    this.#path = path;
  }

  async get(id: string): Promise<MetadataEntry | undefined> {
    await this.#load();
    const entry = this.#entries.get(id);
    return entry && entry.expiresAt > Date.now() ? entry : undefined;
  }

  async remember(songs: readonly MusicSong[]): Promise<void> {
    await this.#load();
    for (const song of songs) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(song.id)) {
        continue;
      }
      const previousEntry = this.#entries.get(song.id);
      const previous = previousEntry?.song;
      const durationSeconds =
        parseMusicDuration(song.durationSeconds) || previous?.durationSeconds || 0;
      this.#entries.delete(song.id);
      this.#entries.set(song.id, {
        song: {
          ...song,
          title: song.title === 'Sin título' ? (previous?.title ?? song.title) : song.title,
          artist: song.artist === 'Desconocido' ? (previous?.artist ?? song.artist) : song.artist,
          sourceUrl: null,
          durationSeconds,
        },
        expiresAt: Date.now() + successLifetime,
        retryAt: durationSeconds ? Date.now() + successLifetime : (previousEntry?.retryAt ?? 0),
      });
    }
    await this.#save();
  }

  async rememberDuration(id: string, seconds: number): Promise<void> {
    const previous = (await this.get(id))?.song;
    await this.remember([
      {
        id,
        title: previous?.title ?? 'Sin título',
        artist: previous?.artist ?? 'Desconocido',
        thumbnailUrl: previous?.thumbnailUrl ?? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
        sourceUrl: null,
        durationSeconds: seconds,
      },
    ]);
  }

  async failed(id: string): Promise<void> {
    await this.#load();
    const previous = this.#entries.get(id);
    this.#entries.set(id, {
      song: previous?.song ?? null,
      expiresAt: Math.max(previous?.expiresAt ?? 0, Date.now() + failureLifetime),
      retryAt: Date.now() + failureLifetime,
    });
    await this.#save();
  }

  async #load(): Promise<void> {
    this.#loading ??= (async () => {
      try {
        const raw: unknown = JSON.parse(
          (await readBoundedRegularFile(this.#path, 4 * 1024 * 1024)).toString('utf8'),
        );
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return;
        }
        const entries = (raw as Record<string, unknown>).entries;
        if (!Array.isArray(entries)) {
          return;
        }
        for (const value of entries.slice(-maximumEntries)) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            continue;
          }
          const entry = value as Record<string, unknown>;
          const id = entry.id;
          if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
            continue;
          }
          if (
            typeof entry.expiresAt !== 'number' ||
            !Number.isFinite(entry.expiresAt) ||
            entry.expiresAt <= Date.now()
          ) {
            continue;
          }
          if (typeof entry.retryAt !== 'number' || !Number.isFinite(entry.retryAt)) {
            continue;
          }
          let song: MusicSong | null = null;
          if (entry.song && typeof entry.song === 'object' && !Array.isArray(entry.song)) {
            const item = entry.song as Record<string, unknown>;
            if (
              typeof item.title !== 'string' ||
              item.title.length > 300 ||
              typeof item.artist !== 'string' ||
              item.artist.length > 200
            ) {
              continue;
            }
            const thumbnail = item.thumbnailUrl;
            if (thumbnail !== null && (typeof thumbnail !== 'string' || thumbnail.length > 4096)) {
              continue;
            }
            if (typeof thumbnail === 'string') {
              const url = new URL(thumbnail);
              if (url.protocol !== 'https:' || url.username || url.password) {
                continue;
              }
            }
            song = {
              id,
              title: item.title,
              artist: item.artist,
              thumbnailUrl: thumbnail,
              sourceUrl: null,
              durationSeconds: parseMusicDuration(item.durationSeconds),
            };
          }
          this.#entries.set(id, { song, expiresAt: entry.expiresAt, retryAt: entry.retryAt });
        }
      } catch {
        // Missing/corrupt caches never prevent catalog or player use.
      }
    })();
    await this.#loading;
  }

  async #save(): Promise<void> {
    while (this.#entries.size > maximumEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest) {
        this.#entries.delete(oldest);
      }
    }
    this.#writing = this.#writing
      .catch(() => undefined)
      .then(async () => {
        const entries = [...this.#entries].map(([id, value]) => ({ id, ...value }));
        await writeFileAtomically(this.#path, `${JSON.stringify({ version: 1, entries })}\n`);
      });
    await this.#writing.catch(() => undefined);
  }
}
