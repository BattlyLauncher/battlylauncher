import { readBoundedResponseBytes } from '../network/read-bounded-response';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, open, rename, rm, readFile } from 'node:fs/promises';
import { writeFileAtomically } from '../files/atomic-file';
import { dirname, join } from 'node:path';

import type {
  MusicPlaylistImport,
  MusicQuality,
  MusicSong,
} from '../../shared/music/music-contract';
import {
  normalizeMusicMetadataIdentifiers,
  normalizeMusicVideoIdentifier,
  parseMusicDuration,
} from '../../shared/music/music-contract';
import { MusicMetadataCache } from './music-metadata-cache';
import { parseYouTubeVideo } from './youtube-video-metadata';

interface ReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
  readonly size: number;
}

type CommandRunner = (
  binary: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string>;

const runCommand: CommandRunner = (binary, args, signal) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(binary, [...args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 8 * 1024 * 1024) {
        child.kill();
        reject(new Error('Music metadata response is too large'));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errors.length < 2048) {
        errors += chunk.toString('utf8');
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new Error(`yt-dlp failed (${code ?? 'unknown'}): ${errors.slice(0, 500)}`));
      }
    });
  });

const qualityFormats: Readonly<Record<MusicQuality, string>> = {
  auto: 'bestaudio/best',
  high: 'bestaudio[abr<=256]/bestaudio/best',
  medium: 'bestaudio[abr<=128]/bestaudio/best',
  low: 'bestaudio[abr<=64]/worstaudio/best',
};

const privatePlaylistMessage =
  'La playlist de YouTube es privada. Cámbiala a No listada para poder importarla.';
const unavailablePlaylistMessage =
  'La playlist de YouTube no está disponible. Comprueba el enlace y que se pueda abrir sin iniciar sesión.';

function waitForBinary(installation: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) {
    return installation;
  }
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const cancel = (): void => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error ? reason : new Error('Music request cancelled', { cause: reason }),
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    void installation.then(
      (binary) => {
        signal.removeEventListener('abort', cancel);
        resolve(binary);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', cancel);
        reject(
          error instanceof Error ? error : new Error('Music runtime unavailable', { cause: error }),
        );
      },
    );
  });
}

async function bounded(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`yt-dlp download failed (${response.status})`);
  }
  return readBoundedResponseBytes(response, maximum, 'yt-dlp download is too large');
}

function validateDownloadResponseUrl(response: Response): void {
  const url = new URL(response.url);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  const trustedGithubHost =
    url.hostname === 'github.com' ||
    url.hostname === 'objects.githubusercontent.com' ||
    url.hostname === 'release-assets.githubusercontent.com';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    (!loopback && !trustedGithubHost) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('yt-dlp download redirected to an untrusted URL');
  }
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function writeBinaryAtomically(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.yt-dlp-${randomBytes(6).toString('hex')}.pending`);
  const displaced = join(dirname(path), `.yt-dlp-${randomBytes(6).toString('hex')}.displaced`);
  const handle = await open(temporary, 'wx', 0o700);
  try {
    await handle.write(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  let hadExisting = false;
  try {
    try {
      await rename(path, displaced);
      hadExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    await rename(temporary, path);
    await chmod(path, 0o700);
  } catch (error) {
    await rm(temporary, { force: true });
    if (hadExisting) {
      await rename(displaced, path).catch(() => undefined);
    }
    throw error;
  }
  if (hadExisting) {
    await rm(displaced, { force: true });
  }
}

export interface YtDlpResolverOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly platform?: NodeJS.Platform;
  readonly releaseApiUrl?: string;
  readonly runner?: CommandRunner;
  readonly metadataCachePath?: string;
}

export class YtDlpResolver {
  readonly #binaryPath: string;
  readonly #fetch: typeof fetch;
  readonly #platform: NodeJS.Platform;
  readonly #releaseApiUrl: string;
  readonly #runner: CommandRunner;
  readonly #metadataCache: MusicMetadataCache;
  readonly #metadataRequests = new Map<string, Promise<MusicSong | null>>();
  readonly #metadataWaiters: Array<() => void> = [];
  #metadataActive = 0;
  #readyBinary: string | undefined;
  #installing: Promise<string> | undefined;
  readonly #sources = new Map<string, { readonly expiresAt: number; readonly url: string }>();
  readonly #searchRequests = new Map<string, Promise<readonly MusicSong[]>>();
  readonly #searches = new Map<
    string,
    { readonly expiresAt: number; readonly songs: readonly MusicSong[] }
  >();

  constructor(directory: string, options: YtDlpResolverOptions = {}) {
    this.#platform = options.platform ?? process.platform;
    const binaryName =
      this.#platform === 'win32'
        ? 'yt-dlp.exe'
        : this.#platform === 'darwin'
          ? 'yt-dlp_macos'
          : 'yt-dlp_linux';
    this.#binaryPath = join(directory, binaryName);
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#releaseApiUrl =
      options.releaseApiUrl ?? 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
    this.#runner = options.runner ?? runCommand;
    this.#metadataCache = new MusicMetadataCache(
      options.metadataCachePath ?? join(directory, 'music-metadata.json'),
    );
  }

  invalidate(videoId: string, quality: MusicQuality): void {
    this.#sources.delete(`${videoId}:${quality}`);
  }

  async resolve(
    videoId: string,
    quality: MusicQuality = 'auto',
    signal?: AbortSignal,
  ): Promise<string> {
    normalizeMusicVideoIdentifier(videoId);
    const cacheKey = `${videoId}:${quality}`;
    const cached = this.#sources.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }
    const binary = await this.#binary(signal);
    const deadline = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000);
    const output = await this.#runner(
      binary,
      [
        '--ignore-config',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--socket-timeout',
        '12',
        '--extractor-retries',
        '2',
        '--get-url',
        '-f',
        qualityFormats[quality],
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      deadline,
    );
    const source = output.split(/\r?\n/).find(Boolean);
    if (!source) {
      throw new Error('yt-dlp returned no audio source');
    }
    const url = new URL(source);
    if (url.protocol !== 'https:') {
      throw new Error('yt-dlp returned an insecure audio source');
    }
    const resolved = url.toString();
    const expiry = Number(url.searchParams.get('expire')) * 1000;
    const expiresAt = Math.min(
      Date.now() + 20 * 60 * 1000,
      Number.isFinite(expiry) && expiry > 0 ? expiry - 60000 : Infinity,
    );
    this.#sources.set(cacheKey, { url: resolved, expiresAt });
    const oldest = this.#sources.keys().next().value;
    if (this.#sources.size > 180 && oldest) {
      this.#sources.delete(oldest);
    }
    return resolved;
  }

  async search(query: string, signal?: AbortSignal): Promise<readonly MusicSong[]> {
    const key = query.trim().toLowerCase();
    const pending = this.#searchRequests.get(key);
    if (pending) {
      return pending;
    }
    const request = this.#search(query, signal).finally(() => this.#searchRequests.delete(key));
    this.#searchRequests.set(key, request);
    return request;
  }

  async #search(query: string, signal?: AbortSignal): Promise<readonly MusicSong[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized || normalized.length > 120) {
      throw new TypeError('Invalid music search query');
    }
    const cached = this.#searches.get(normalized);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.songs;
    }
    const output = await this.#runner(
      await this.#binary(signal),
      [
        '--ignore-config',
        '--flat-playlist',
        '--skip-download',
        '--dump-single-json',
        '--playlist-end',
        '20',
        '--no-warnings',
        `ytsearch20:${normalized}`,
      ],
      signal,
    );
    if (output.length > 2 * 1024 * 1024) {
      throw new TypeError('Music search response is too large');
    }
    const result: unknown = JSON.parse(output);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('Invalid music search response');
    }
    const entries = (result as Record<string, unknown>).entries;
    if (!Array.isArray(entries) || entries.length > 20) {
      throw new TypeError('Invalid music search entries');
    }
    const videos = entries
      .map(parseYouTubeVideo)
      .filter((entry): entry is MusicSong => entry !== null);
    const songs = await Promise.all(
      videos.map(async (video) => {
        const cached = (await this.#metadataCache.get(video.id))?.song;
        return { ...video, durationSeconds: video.durationSeconds || cached?.durationSeconds || 0 };
      }),
    );
    void this.#metadataCache.remember(songs).catch(() => undefined);
    this.#searches.set(normalized, { songs, expiresAt: Date.now() + 5 * 60 * 1000 });
    const oldest = this.#searches.keys().next().value;
    if (this.#searches.size > 120 && oldest) {
      this.#searches.delete(oldest);
    }
    return songs;
  }

  async playlist(value: string, signal?: AbortSignal): Promise<MusicPlaylistImport> {
    const url = value.length <= 2048 ? URL.parse(value.trim()) : null;
    const list = url?.searchParams.get('list');
    if (
      !url ||
      url.protocol !== 'https:' ||
      ![
        'www.youtube.com',
        'youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtu.be',
      ].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port ||
      !list ||
      !/^[A-Za-z0-9_-]{2,150}$/.test(list)
    ) {
      throw new TypeError('URL de lista de reproducción YouTube no válida');
    }
    const binary = await this.#binary(signal);
    let output: string;
    try {
      output = await this.#runner(
        binary,
        [
          '--ignore-config',
          '--flat-playlist',
          '--skip-download',
          '--dump-single-json',
          '--playlist-end',
          '500',
          '--no-warnings',
          `https://www.youtube.com/playlist?list=${list}`,
        ],
        signal,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      if (/\b(?:private playlist|playlist is private)\b/i.test(detail)) {
        throw new Error(privatePlaylistMessage, { cause: error });
      }
      if (/\bplaylist (?:does not exist|is (?:not available|unavailable))\b/i.test(detail)) {
        throw new Error(unavailablePlaylistMessage, { cause: error });
      }
      throw error;
    }
    if (output.length > 4 * 1024 * 1024) {
      throw new TypeError('YouTube playlist is too large');
    }
    const result: unknown = JSON.parse(output);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('Invalid YouTube playlist response');
    }
    const source = result as Record<string, unknown>;
    if (source.availability === 'private') {
      throw new Error(privatePlaylistMessage);
    }
    if (source.availability === 'needs_auth') {
      throw new Error(unavailablePlaylistMessage);
    }
    const entries = source.entries;
    if (!Array.isArray(entries) || entries.length > 500) {
      throw new TypeError('Invalid YouTube playlist entries');
    }
    const rawTitle = source.title;
    const title =
      typeof rawTitle === 'string' && rawTitle.trim() && rawTitle.length <= 100
        ? rawTitle.trim()
        : 'Playlist de YouTube';
    const videos = entries
      .filter((entry: unknown) => {
        const video = entry as { availability?: unknown; title?: unknown } | null;
        return (
          video?.availability !== 'private' &&
          !(
            typeof video?.title === 'string' && /^\[(?:Private|Deleted) video\]$/i.test(video.title)
          )
        );
      })
      .map(parseYouTubeVideo)
      .filter((entry): entry is MusicSong => entry !== null);
    if (!videos.length) {
      throw new Error('La playlist está vacía o no se pudo leer');
    }
    const songs = await Promise.all(
      videos.map(async (video) => {
        const cached = (await this.#metadataCache.get(video.id))?.song;
        return { ...video, durationSeconds: video.durationSeconds || cached?.durationSeconds || 0 };
      }),
    );
    await this.#metadataCache.remember(songs);
    return { title, songs };
  }

  async metadata(ids: readonly string[], signal?: AbortSignal): Promise<readonly MusicSong[]> {
    const normalized = normalizeMusicMetadataIdentifiers(ids);
    const results = await Promise.all(normalized.map((id) => this.#videoMetadata(id, signal)));
    return results.filter((song): song is MusicSong => song !== null);
  }

  async rememberDuration(videoId: string, duration: number): Promise<void> {
    const id = normalizeMusicVideoIdentifier(videoId);
    const seconds = parseMusicDuration(duration);
    if (!seconds) {
      throw new TypeError('Invalid music duration');
    }
    await this.#metadataCache.rememberDuration(id, seconds);
  }

  async #videoMetadata(id: string, signal?: AbortSignal): Promise<MusicSong | null> {
    const cached = await this.#metadataCache.get(id);
    if (cached && (cached.song?.durationSeconds || cached.retryAt > Date.now())) {
      return cached.song;
    }
    const pending = this.#metadataRequests.get(id);
    if (pending) {
      return pending;
    }
    const request = this.#readVideoMetadata(id, signal).finally(() =>
      this.#metadataRequests.delete(id),
    );
    this.#metadataRequests.set(id, request);
    return request;
  }

  async #readVideoMetadata(id: string, signal?: AbortSignal): Promise<MusicSong | null> {
    if (this.#metadataActive >= 3) {
      await new Promise<void>((resolve) => this.#metadataWaiters.push(resolve));
    } else {
      this.#metadataActive += 1;
    }
    try {
      const deadline = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);
      const output = await this.#runner(
        await this.#binary(deadline),
        [
          '--ignore-config',
          '--skip-download',
          '--no-playlist',
          '--dump-single-json',
          '--ignore-no-formats-error',
          '--no-warnings',
          '--no-progress',
          '--socket-timeout',
          '10',
          '--retries',
          '0',
          '--extractor-retries',
          '0',
          `https://www.youtube.com/watch?v=${id}`,
        ],
        deadline,
      );
      const song = parseYouTubeVideo(JSON.parse(output) as unknown);
      if (!song || song.id !== id) {
        throw new Error('Invalid music video metadata');
      }
      await this.#metadataCache.remember([song]);
      if (!song.durationSeconds) {
        await this.#metadataCache.failed(id);
      }
      return song;
    } catch {
      await this.#metadataCache.failed(id);
      return (await this.#metadataCache.get(id))?.song ?? null;
    } finally {
      const next = this.#metadataWaiters.shift();
      if (next) {
        next();
      } else {
        this.#metadataActive -= 1;
      }
    }
  }

  async #binary(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    if (this.#readyBinary) {
      return this.#readyBinary;
    }
    // Installation is shared; each consumer can stop waiting without cancelling the others.
    const installation = (this.#installing ??= this.#ensureBinary(AbortSignal.timeout(90_000))
      .then((binary) => {
        this.#readyBinary = binary;
        return binary;
      })
      .finally(() => {
        this.#installing = undefined;
      }));
    return waitForBinary(installation, signal);
  }

  async #ensureBinary(signal?: AbortSignal): Promise<string> {
    const verificationPath = `${this.#binaryPath}.verified.json`;
    try {
      const cached = JSON.parse(await readFile(verificationPath, 'utf8')) as {
        checksum?: string;
        checkedAt?: number;
      };
      if (
        typeof cached.checkedAt === 'number' &&
        cached.checkedAt <= Date.now() &&
        Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000 &&
        typeof cached.checksum === 'string' &&
        /^[a-f0-9]{64}$/.test(cached.checksum) &&
        (await fileSha256(this.#binaryPath)) === cached.checksum
      ) {
        return this.#binaryPath;
      }
    } catch {
      /* A missing or changed binary goes through release verification. */
    }
    const response = await this.#fetch(this.#releaseApiUrl, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Battly-Remake' },
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    const release = JSON.parse(
      new TextDecoder().decode(await bounded(response, 2 * 1024 * 1024)),
    ) as unknown;
    if (!release || typeof release !== 'object' || Array.isArray(release)) {
      throw new TypeError('Invalid yt-dlp release');
    }
    const assetsValue = Object.getOwnPropertyDescriptor(release, 'assets')?.value as unknown;
    if (!Array.isArray(assetsValue) || assetsValue.length > 100) {
      throw new TypeError('Invalid yt-dlp assets');
    }
    const assets = assetsValue.map((value): ReleaseAsset => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Invalid yt-dlp asset');
      }
      const source = value as Record<string, unknown>;
      const name = Object.getOwnPropertyDescriptor(source, 'name')?.value as unknown;
      const url = Object.getOwnPropertyDescriptor(source, 'browser_download_url')?.value as unknown;
      const size = Object.getOwnPropertyDescriptor(source, 'size')?.value as unknown;
      if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') {
        throw new TypeError('Invalid yt-dlp asset');
      }
      const parsedUrl = new URL(url);
      const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname);
      if (parsedUrl.protocol !== 'https:' && !(parsedUrl.protocol === 'http:' && loopback)) {
        throw new TypeError('Invalid yt-dlp asset URL');
      }
      return { name, browser_download_url: url, size };
    });
    const name = this.#binaryPath.split(/[\\/]/).at(-1);
    const binaryAsset = assets.find((asset) => asset.name === name);
    const sumsAsset = assets.find((asset) => asset.name === 'SHA2-256SUMS');
    if (!binaryAsset || !sumsAsset || binaryAsset.size < 1 || binaryAsset.size > 64 * 1024 * 1024) {
      throw new Error('yt-dlp release has no supported assets');
    }
    const sumsResponse = await this.#fetch(sumsAsset.browser_download_url, {
      redirect: 'follow',
      signal,
    });
    validateDownloadResponseUrl(sumsResponse);
    const sums = new TextDecoder().decode(await bounded(sumsResponse, 64 * 1024));
    const match = sums
      .split(/\r?\n/)
      .find((line) => line.endsWith(`  ${name}`))
      ?.match(/^([a-f0-9]{64})\s+/i);
    const expected = match?.[1]?.toLowerCase();
    if (!expected) {
      throw new Error('yt-dlp checksum is unavailable');
    }
    try {
      if ((await fileSha256(this.#binaryPath)) === expected) {
        await writeFileAtomically(
          verificationPath,
          JSON.stringify({ checksum: expected, checkedAt: Date.now() }),
        );
        return this.#binaryPath;
      }
    } catch {
      // Missing or unreadable binaries are replaced below.
    }
    const binaryResponse = await this.#fetch(binaryAsset.browser_download_url, {
      redirect: 'follow',
      signal,
    });
    validateDownloadResponseUrl(binaryResponse);
    const binary = await bounded(binaryResponse, binaryAsset.size);
    if (binary.byteLength !== binaryAsset.size || sha256(binary) !== expected) {
      throw new Error('yt-dlp checksum mismatch');
    }
    await writeBinaryAtomically(this.#binaryPath, binary);
    await writeFileAtomically(
      verificationPath,
      JSON.stringify({ checksum: expected, checkedAt: Date.now() }),
    );
    return this.#binaryPath;
  }
}
