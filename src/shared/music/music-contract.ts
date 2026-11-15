import { normalizeMusicOverlayPlayback, type MusicOverlayPlayback } from './music-overlay';

export interface MusicSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly thumbnailUrl: string | null;
  readonly sourceUrl: string | null;
  readonly durationSeconds: number;
}

/** Accept API seconds, clock strings and ISO 8601 durations without inventing a length. */
export function parseMusicDuration(value: unknown): number {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    return parseMusicDuration(source.seconds ?? source.text ?? source.simpleText);
  }
  let seconds = 0;
  if (typeof value === 'number') {
    seconds = value;
  } else if (typeof value === 'string') {
    const duration = value.trim();
    if (/^\d+(?:\.\d+)?$/.test(duration)) {
      seconds = Number(duration);
    } else if (/^\d+:\d{2}(?::\d{2})?$/.test(duration)) {
      const parts = duration.split(':').map(Number);
      if (parts.slice(1).some((part) => part >= 60)) {
        return 0;
      }
      seconds = parts.reduce((total, part) => total * 60 + part, 0);
    } else {
      const iso = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(
        duration,
      );
      if (iso) {
        seconds = Number(iso[1] ?? 0) * 3600 + Number(iso[2] ?? 0) * 60 + Number(iso[3] ?? 0);
      }
    }
  }
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400 ? Math.floor(seconds) : 0;
}

export function normalizeMusicVideoIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(value)) {
    throw new TypeError('Invalid music video identifier');
  }
  return value;
}

export function normalizeMusicMetadataIdentifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 40) {
    throw new TypeError('Invalid music metadata batch');
  }
  return [...new Set(value.map(normalizeMusicVideoIdentifier))];
}

export type MusicQuality = 'auto' | 'high' | 'low' | 'medium';

export function normalizeMusicQuality(value: unknown): MusicQuality {
  if (value === undefined) {
    return 'auto';
  }
  if (value !== 'auto' && value !== 'high' && value !== 'low' && value !== 'medium') {
    throw new TypeError('Invalid music quality');
  }
  return value;
}

export type MusicControlAction = 'next' | 'play-pause' | 'previous';

export interface MusicPlaybackState {
  readonly overlay?: MusicOverlayPlayback;
  readonly artist: string;
  readonly currentTime?: number;
  readonly duration?: number;
  readonly playing: boolean;
  readonly thumbnailUrl?: string | null;
  readonly title: string;
}

export const emptyMusicPlaybackState: MusicPlaybackState = {
  artist: '',
  currentTime: 0,
  duration: 0,
  playing: false,
  thumbnailUrl: null,
  title: '',
};

export function normalizeMusicPlaybackState(value: unknown): MusicPlaybackState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid music playback state');
  }
  const source = value as Record<string, unknown>;
  const playing = source.playing;
  const title = source.title;
  const artist = source.artist;
  const hasCurrentTime = Object.hasOwn(source, 'currentTime');
  const hasDuration = Object.hasOwn(source, 'duration');
  const hasThumbnailUrl = Object.hasOwn(source, 'thumbnailUrl');
  const currentTime = hasCurrentTime ? Number(source.currentTime) : 0;
  const duration = hasDuration ? Number(source.duration) : 0;
  const thumbnailUrl = source.thumbnailUrl;
  if (
    typeof playing !== 'boolean' ||
    typeof title !== 'string' ||
    typeof artist !== 'string' ||
    title.length > 300 ||
    artist.length > 200 ||
    !Number.isFinite(currentTime) ||
    currentTime < 0 ||
    currentTime > 86_400 ||
    !Number.isFinite(duration) ||
    duration < 0 ||
    duration > 86_400 ||
    (hasThumbnailUrl && thumbnailUrl !== null && typeof thumbnailUrl !== 'string')
  ) {
    throw new TypeError('Invalid music playback state');
  }
  if (typeof thumbnailUrl === 'string') {
    const url = new URL(thumbnailUrl);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new TypeError('Invalid music playback thumbnail');
    }
  }
  return {
    ...(source.overlay !== undefined
      ? { overlay: normalizeMusicOverlayPlayback(source.overlay) }
      : {}),
    artist,
    ...(hasCurrentTime ? { currentTime } : {}),
    ...(hasDuration ? { duration } : {}),
    playing,
    ...(hasThumbnailUrl ? { thumbnailUrl: thumbnailUrl as string | null } : {}),
    title,
  };
}

export function normalizeMusicControlAction(value: unknown): MusicControlAction {
  if (value !== 'next' && value !== 'play-pause' && value !== 'previous') {
    throw new TypeError('Invalid music control action');
  }
  return value;
}

export interface MusicPlaylist {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly coverUrl: string | null;
  readonly songs: readonly MusicSong[];
  readonly collaborative: boolean;
  readonly canDelete: boolean;
  readonly canEditMetadata: boolean;
  readonly canEditSongs: boolean;
  readonly canShare: boolean;
  readonly canManageCollaboration: boolean;
}

export interface MusicPlaylistUpdateDraft {
  readonly name: string;
  readonly description: string;
}

export interface MusicPlaylistShare {
  readonly url: string;
}

export interface MusicSnapshot {
  readonly promotedSong?: MusicSong | null;
  readonly featured: readonly MusicSong[];
  readonly homePlaylists?: readonly MusicPlaylist[];
  readonly playlists: readonly MusicPlaylist[];
  readonly fromCache: boolean;
}

export interface MusicPlaylistImport {
  readonly title: string;
  readonly songs: readonly MusicSong[];
}

export interface GeneratedMusicCollection {
  readonly id: 'discovery' | 'for-you';
  readonly name: string;
  readonly description: string;
  readonly songs: readonly MusicSong[];
}

export function buildGeneratedMusicCollections(
  featured: readonly MusicSong[],
  favorites: readonly MusicSong[],
): readonly GeneratedMusicCollection[] {
  const unique = (songs: readonly MusicSong[]): readonly MusicSong[] =>
    songs.filter(
      (song, index, candidates) =>
        candidates.findIndex((candidate) => candidate.id === song.id) === index,
    );
  const favoriteIds = new Set(favorites.map((song) => song.id));
  const discovery = unique(featured.filter((song) => !favoriteIds.has(song.id))).slice(0, 20);
  const familiar = unique(favorites).slice(0, 10);
  const fresh = discovery.slice(0, 10);
  const forYou =
    familiar.length && fresh.length
      ? familiar
          .flatMap((song, index) => [song, ...(fresh[index] ? [fresh[index]] : [])])
          .concat(fresh.slice(familiar.length))
          .slice(0, 20)
      : [];
  return [
    ...(forYou.length
      ? [
          {
            id: 'for-you' as const,
            name: 'Mix para ti',
            description: favorites.length
              ? 'Tus favoritos junto a las tendencias de Battly.'
              : 'Una selección automática de las tendencias de Battly.',
            songs: forYou,
          },
        ]
      : []),
    ...(discovery.length
      ? [
          {
            id: 'discovery' as const,
            name: 'Descubrimiento',
            description: 'Tendencias que todavía no has guardado en Favoritos.',
            songs: discovery,
          },
        ]
      : []),
  ];
}

export interface MusicCollaborationInvite {
  readonly id: string;
  readonly playlistId: string;
  readonly playlistName: string;
  readonly ownerUsername: string;
}

export interface MusicPlaylistCollaborator {
  readonly id: string;
  readonly username: string;
  readonly addedAt: string | null;
}

export interface MusicPlaylistPendingInvite {
  readonly id: string;
  readonly username: string;
  readonly expiresAt: string | null;
}

export interface MusicPlaylistCollaboration {
  readonly ownerUsername: string;
  readonly collaborators: readonly MusicPlaylistCollaborator[];
  readonly pendingInvites: readonly MusicPlaylistPendingInvite[];
  readonly maxCollaborators: number;
  readonly canManage: boolean;
}

export interface MusicPlaylistActivity {
  readonly id: string;
  readonly action: string;
  readonly actorUsername: string;
  readonly createdAt: string | null;
}

export interface MusicFavoriteDraft {
  readonly artist: string;
  readonly id: string;
  readonly thumbnailUrl: string | null;
  readonly title: string;
}

export function normalizeMusicSearchQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new TypeError('Invalid music search query');
  }
  return value.trim();
}

export function normalizeMusicFavorite(value: unknown): MusicFavoriteDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid music favorite');
  }
  const source = value as Record<string, unknown>;
  const id = normalizeMusicIdentifier(source.id);
  const title = source.title;
  const artist = source.artist;
  const thumbnailUrl = source.thumbnailUrl;
  if (typeof title !== 'string' || !title.trim() || title.length > 300) {
    throw new TypeError('Invalid music favorite title');
  }
  if (typeof artist !== 'string' || !artist.trim() || artist.length > 200) {
    throw new TypeError('Invalid music favorite artist');
  }
  if (thumbnailUrl !== null && typeof thumbnailUrl !== 'string') {
    throw new TypeError('Invalid music favorite thumbnail');
  }
  if (typeof thumbnailUrl === 'string') {
    const url = new URL(thumbnailUrl);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
      throw new TypeError('Invalid music favorite thumbnail');
    }
  }
  return { id, title: title.trim(), artist: artist.trim(), thumbnailUrl };
}

export function normalizeMusicIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError('Invalid music identifier');
  }
  return value;
}

export function normalizeMusicUsername(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    throw new TypeError('Invalid music username');
  }
  return value.trim();
}

export function normalizePlaylistDraft(value: unknown): {
  readonly name: string;
  readonly description: string;
  readonly songs: readonly string[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid playlist draft');
  }
  const source = value as Record<string, unknown>;
  const name = source.name;
  const description = source.description;
  const songs = source.songs;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    throw new TypeError('Invalid playlist name');
  }
  if (typeof description !== 'string' || description.length > 500) {
    throw new TypeError('Invalid playlist description');
  }
  if (!Array.isArray(songs) || !songs.length || songs.length > 500) {
    throw new TypeError('Invalid playlist songs');
  }
  return {
    name: name.trim(),
    description: description.trim(),
    songs: songs.map(normalizeMusicIdentifier),
  };
}

export function normalizePlaylistUpdateDraft(value: unknown): MusicPlaylistUpdateDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid playlist update');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== 'name' && key !== 'description')) {
    throw new TypeError('Unsupported playlist update field');
  }
  const name = source.name;
  const description = source.description;
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    throw new TypeError('Invalid playlist name');
  }
  if (typeof description !== 'string' || description.length > 500) {
    throw new TypeError('Invalid playlist description');
  }
  return { name: name.trim(), description: description.trim() };
}

export function normalizePlaylistSongs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new TypeError('Invalid playlist songs');
  }
  return value.map(normalizeMusicIdentifier);
}
