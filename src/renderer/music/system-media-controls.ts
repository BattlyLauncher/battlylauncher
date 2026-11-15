import type { MusicSong } from '../../shared/music/music-contract';

export interface SystemMusicActions {
  readonly song: () => MusicSong | undefined;
  readonly play: () => void;
  readonly next: () => void;
  readonly previous: () => void;
}

/** Only the window that owns the audio publishes a system media session. */
export function bindSystemMediaControls(
  audio: HTMLAudioElement,
  actions: SystemMusicActions,
  fallbackArtwork: string,
  session = navigator.mediaSession,
): { update: () => void; dispose: () => void } {
  if (!session) {
    return { update: () => {}, dispose: () => {} };
  }
  let metadataKey = '';
  const position = (): void => {
    if (!session.setPositionState) {
      return;
    }
    const duration = audio.duration;
    try {
      if (!Number.isFinite(duration) || duration <= 0 || !actions.song()) {
        session.setPositionState();
        return;
      }
      session.setPositionState({
        duration,
        playbackRate: audio.playbackRate > 0 ? audio.playbackRate : 1,
        position: Math.max(0, Math.min(duration, audio.currentTime || 0)),
      });
    } catch {
      /* Some desktop media backends do not expose a seek bar. */
    }
  };
  const update = (): void => {
    const song = actions.song();
    if (!song) {
      metadataKey = '';
      session.metadata = null;
      session.playbackState = 'none';
      position();
      return;
    }
    const key = JSON.stringify([song.id, song.title, song.artist, song.thumbnailUrl]);
    if (key !== metadataKey) {
      let artwork = fallbackArtwork;
      try {
        const candidate = new URL(song.thumbnailUrl || fallbackArtwork, document.baseURI);
        if (['https:', 'http:', 'file:'].includes(candidate.protocol)) {
          artwork = candidate.href;
        }
      } catch {
        /* Use the bundled Battly icon for invalid covers. */
      }
      session.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        album: 'Battly Music',
        artwork: [{ src: artwork }],
      });
      metadataKey = key;
    }
    session.playbackState = audio.paused || audio.ended ? 'paused' : 'playing';
    position();
  };
  const seek = (time: number): void => {
    if (
      !actions.song() ||
      !Number.isFinite(time) ||
      !Number.isFinite(audio.duration) ||
      audio.duration <= 0
    ) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration, time));
    position();
  };
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => {
      if (actions.song()) {
        actions.play();
      }
    },
    pause: () => audio.pause(),
    previoustrack: () => {
      if (actions.song()) {
        actions.previous();
      }
    },
    nexttrack: () => {
      if (actions.song()) {
        actions.next();
      }
    },
    seekbackward: (details) => seek(audio.currentTime - (details.seekOffset ?? 10)),
    seekforward: (details) => seek(audio.currentTime + (details.seekOffset ?? 10)),
    seekto: (details) => {
      if (details.seekTime !== undefined) {
        seek(details.seekTime);
      }
    },
    stop: () => {
      audio.pause();
      seek(0);
    },
  };
  const installed: MediaSessionAction[] = [];
  for (const [action, handler] of Object.entries(handlers)) {
    try {
      session.setActionHandler(action as MediaSessionAction, handler);
      installed.push(action as MediaSessionAction);
    } catch {
      /* Unsupported actions must not disable ordinary playback. */
    }
  }
  const events = [
    'play',
    'pause',
    'ended',
    'loadedmetadata',
    'durationchange',
    'ratechange',
    'seeked',
    'emptied',
  ];
  events.forEach((event) => audio.addEventListener(event, update));
  audio.addEventListener('timeupdate', position);
  update();
  return {
    update,
    dispose() {
      events.forEach((event) => audio.removeEventListener(event, update));
      audio.removeEventListener('timeupdate', position);
      installed.forEach((action) => {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* Backend closed. */
        }
      });
      session.metadata = null;
      session.playbackState = 'none';
      try {
        session.setPositionState?.();
      } catch {
        /* Backend closed. */
      }
    },
  };
}
