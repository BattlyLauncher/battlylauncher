import { normalizeThemeSound } from '../shared/themes/theme-contract';
import './styles/emoji.css';
import startSoundUrl from './assets/audio/start.mp3?url';
import start1SoundUrl from './assets/audio/start1.mp3?url';
import start2SoundUrl from './assets/audio/start2.mp3?url';
import start3SoundUrl from './assets/audio/start3.mp3?url';
import start4SoundUrl from './assets/audio/start4.mp3?url';
import start5SoundUrl from './assets/audio/start5.mp3?url';
import start6SoundUrl from './assets/audio/start6.mp3?url';
import { startWindowLanguage } from './i18n/window-language';

const greetings: Readonly<Record<string, string>> = {
  es: '¡Hola!',
  en: 'Hello!',
  fr: 'Bonjour!',
  de: 'Hallo!',
  it: 'Ciao!',
  pt: 'Olá!',
  ru: 'Привет!',
  ja: 'こんにちは!',
  ar: 'مرحبا!',
  zh: '你好！',
};

const parameters = new URLSearchParams(window.location.search);
const language = parameters.get('lang') ?? 'es';
startWindowLanguage(() => Promise.resolve(language));
const greeting = document.querySelector<HTMLElement>('[data-splash-greeting]');
if (greeting) {
  greeting.textContent = greetings[language] ?? greetings.es;
}
const splash = document.querySelector<HTMLElement>('.startup-splash');

async function playOriginalStartupSequence(): Promise<void> {
  splash?.classList.add('logo-visible');
  await new Promise<void>((resolve) => window.setTimeout(resolve, 160));
  splash?.classList.add('copy-visible');
  await new Promise<void>((resolve) => window.setTimeout(resolve, 540));
  if (greeting && !splash?.classList.contains('startup-ending')) {
    greeting.setAttribute('data-string-id', 'launcher.starting_launcher');
  }
}

window.battly.onStartupProgress((change) => {
  if (change.progress !== 100) {
    return;
  }
  splash?.classList.add('startup-ending');
  greeting?.setAttribute('data-string-id', 'launcher.ending');
});

const audio = document.querySelector<HTMLAudioElement>('[data-startup-audio]');
if (audio) {
  const sounds: Readonly<Record<string, string>> = {
    start: startSoundUrl,
    start1: start1SoundUrl,
    start2: start2SoundUrl,
    start3: start3SoundUrl,
    start4: start4SoundUrl,
    start5: start5SoundUrl,
    start6: start6SoundUrl,
  };
  const requestedVolume = Number(parameters.get('volume'));
  audio.volume = Number.isFinite(requestedVolume) ? Math.max(0, Math.min(1, requestedVolume)) : 0.8;
  if (audio.volume > 0) {
    const requestedSound = normalizeThemeSound(parameters.get('sound'));
    audio.src =
      sounds[requestedSound] ??
      (/^https:\/\//.test(requestedSound) ? requestedSound : startSoundUrl);
    void audio.play().catch(() => undefined);
  }
}

void playOriginalStartupSequence();
