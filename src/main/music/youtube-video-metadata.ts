import { remoteHtmlToText } from '../../shared/home/home-contract';
import { parseMusicDuration, type MusicSong } from '../../shared/music/music-contract';

/** Flat YouTube searches can contain channel/playlist URL entries as well as videos. */
export function parseYouTubeVideo(value: unknown): MusicSong | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const id = source.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return null;
  }
  if (source._type === 'playlist' || source._type === 'multi_video') {
    return null;
  }
  const extractor = source.ie_key ?? source.extractor_key;
  if (typeof extractor === 'string' && /(?:tab|playlist|channel|search)/i.test(extractor)) {
    return null;
  }
  const target = source.webpage_url ?? source.url;
  if (typeof target === 'string' && /youtube\.com\/(?:channel\/|@|playlist\?)/i.test(target)) {
    return null;
  }
  const title = source.title ?? source.name;
  if (typeof title !== 'string' || !title.trim() || title.length > 300) {
    return null;
  }
  const rawArtist = source.channel ?? source.uploader ?? source.artist ?? source.author;
  const artist = typeof rawArtist === 'string' && rawArtist.trim() ? rawArtist : 'Desconocido';
  return {
    id,
    title: remoteHtmlToText(title, 300).trim(),
    artist: remoteHtmlToText(artist, 200).trim(),
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    sourceUrl: null,
    durationSeconds:
      parseMusicDuration(source.duration) ||
      parseMusicDuration(source.duration_string) ||
      parseMusicDuration(source.lengthSeconds),
  };
}
