import type { MusicPlaybackState } from '../../shared/music/music-contract';
import legacyMusicSmallMarkup from '../legacy/panels/music-small.html?raw';
import battlyIconUrl from '../assets/icon.png?url';
import { startWindowLanguage } from '../i18n/window-language';

function renderPlayback(state: MusicPlaybackState): void {
  const title = document.querySelector<HTMLElement>('[data-music-mini-title]');
  const artist = document.querySelector<HTMLElement>('[data-music-mini-artist]');
  const button = document.querySelector<HTMLButtonElement>('[data-music-play-pause]');
  const cover = document.querySelector<HTMLImageElement>('[data-music-mini-cover]');
  const track = document.querySelector<HTMLElement>('.track');
  const hasSong = Boolean(state.title.trim());
  if (title) {
    title.toggleAttribute('data-i18n-dynamic', hasSong);
    title.textContent = hasSong ? state.title : 'Nada reproduciéndose';
  }
  if (artist) {
    artist.toggleAttribute('data-i18n-dynamic', hasSong);
    artist.textContent = hasSong ? state.artist || 'Battly Music' : 'Battly Music';
  }
  if (cover) {
    cover.src = hasSong ? state.thumbnailUrl || battlyIconUrl : battlyIconUrl;
    cover.alt = hasSong ? state.title : 'Battly Music';
  }
  const progress =
    (state.duration ?? 0) > 0
      ? Math.min(100, ((state.currentTime ?? 0) / (state.duration ?? 1)) * 100)
      : 0;
  track?.style.setProperty('--progress', `${progress}%`);
  if (button) {
    button.setAttribute('aria-label', state.playing ? 'Pausar' : 'Reproducir');
    const icon = button.querySelector('i');
    if (icon) {
      icon.className = `fa-solid ${state.playing ? 'fa-pause' : 'fa-play'}`;
    }
  }
}

function mountLegacyMiniPlayer(): void {
  const parsed = new DOMParser().parseFromString(legacyMusicSmallMarkup, 'text/html');
  parsed.querySelectorAll('script, link').forEach((element) => element.remove());
  parsed.querySelectorAll('style').forEach((style) => document.head.append(style.cloneNode(true)));
  document.body.replaceChildren(...[...parsed.body.childNodes].map((node) => node.cloneNode(true)));
  document.documentElement.style.minWidth = '0';
  document.documentElement.style.minHeight = '0';
  document.body.style.minWidth = '0';
  document.body.style.minHeight = '0';
  document.body.style.alignItems = 'center';
  const border = document.querySelector<HTMLElement>('.gradient-border');
  if (border) {
    border.style.alignSelf = 'center';
  }
  const player = document.querySelector<HTMLElement>('#player');
  if (player) {
    player.dataset.musicMini = '';
  }
  const cover = document.querySelector<HTMLImageElement>('#cover');
  if (cover) {
    cover.dataset.musicMiniCover = '';
    cover.src = battlyIconUrl;
  }
  const title = document.querySelector<HTMLElement>('#title');
  if (title) {
    title.dataset.musicMiniTitle = '';
  }
  const artist = document.querySelector<HTMLElement>('#artist');
  if (artist) {
    artist.dataset.musicMiniArtist = '';
  }
  const previous = document.querySelector<HTMLElement>('#prev');
  if (previous) {
    previous.dataset.musicPrevious = '';
  }
  const play = document.querySelector<HTMLElement>('#play');
  if (play) {
    play.dataset.musicPlayPause = '';
  }
  const next = document.querySelector<HTMLElement>('#next');
  if (next) {
    next.dataset.musicNext = '';
  }
}

export function bindDetachedMusicWindow(): void {
  document.body.dataset.window = 'music-legacy';
  mountLegacyMiniPlayer();
  startWindowLanguage(async () => (await window.battly.getSettings()).visual.language);
  const controls = [
    ['[data-music-previous]', 'previous'],
    ['[data-music-play-pause]', 'play-pause'],
    ['[data-music-next]', 'next'],
  ] as const;
  for (const [selector, action] of controls) {
    document
      .querySelector<HTMLButtonElement>(selector)
      ?.addEventListener('click', () => void window.battly.sendMusicControl(action));
  }
  document
    .querySelector<HTMLButtonElement>('#closeBtn')
    ?.addEventListener('click', () => void window.battly.closeWindow());
  window.battly.onMusicPlaybackChanged(renderPlayback);
  void window.battly.getMusicPlaybackState().then(renderPlayback);
}
