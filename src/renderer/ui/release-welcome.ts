import { privateStorage } from '../private-storage';
import { setUiText } from '../i18n/dialog-text';
import { releaseStartupUi } from './og-intro';

export const releaseWelcomeKey = 'battly.release-welcome.3.1.trailer-v1';
export const releaseTrailerUrl =
  'https://s3.eu-central-2.wasabisys.com/cdn.battlylauncher.com/public/desktop/onboarding/Battly_3.1_Trailer_web.mp4';
export function needsReleaseWelcome(language = document.documentElement.lang): boolean {
  const isSpanish = language.trim().toLowerCase().split(/[-_]/)[0] === 'es';
  return isSpanish && privateStorage.getItem(releaseWelcomeKey) !== 'seen';
}

/** Mount before exposing the window; completion follows playback ending or an explicit skip. */
export class ReleaseWelcome {
  private readonly dialog = document.createElement('dialog');
  private readonly video = document.createElement('video');
  private readonly retry = document.createElement('button');
  private readonly continueOffline = document.createElement('button');
  private readonly events = new AbortController();
  private started = false;
  private finished = false;
  private hideTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly onComplete: () => void,
    offline = !navigator.onLine,
  ) {
    this.dialog.className = 'release-welcome';
    this.dialog.setAttribute('aria-label', 'Battly 3.1');
    this.video.src = releaseTrailerUrl;
    this.video.preload = 'auto';
    this.video.playsInline = true;
    this.video.controls = false;
    this.video.loop = false;
    this.video.muted = false;
    this.video.volume = 1;
    this.video.disablePictureInPicture = true;
    this.video.setAttribute('disableRemotePlayback', '');
    this.video.setAttribute('controlsList', 'nodownload noremoteplayback');
    this.video.setAttribute('aria-label', 'Battly 3.1');
    this.retry.type = 'button';
    this.retry.className = 'button is-info';
    setUiText(this.retry, 'Reintentar');
    this.retry.hidden = true;
    this.continueOffline.type = 'button';
    this.continueOffline.className = 'button is-info release-video-continue';
    setUiText(this.continueOffline, 'Continuar');
    this.continueOffline.hidden = true;
    this.continueOffline.addEventListener('click', () => this.defer());
    const options = { signal: this.events.signal };
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'button release-video-skip';
    setUiText(skip, 'Saltar introducción');
    skip.addEventListener('click', () => this.complete(), options);
    const controls = document.createElement('div');
    controls.className = 'release-video-controls';
    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = 0;
    progress.setAttribute('aria-label', 'Progreso');
    const row = document.createElement('div');
    row.className = 'release-video-controls__row';
    const pause = document.createElement('button');
    pause.type = 'button';
    const mute = document.createElement('button');
    mute.type = 'button';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.01';
    volume.value = '1';
    volume.setAttribute('aria-label', 'Volumen');
    const time = document.createElement('span');
    time.className = 'release-video-controls__time';
    const icon = (paths: string) =>
      /* HTML */ `<svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        ${paths}
      </svg>`;
    const playIcon = icon('<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>');
    const pauseIcon = icon('<path d="M8 5v14M16 5v14" stroke-width="4"/>');
    const speaker = '<path d="M11 5 6 9H3v6h3l5 4Z"/>';
    const soundIcon = icon(`${speaker}<path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>`);
    const mutedIcon = icon(`${speaker}<path d="m16 9 5 6m0-6-5 6"/>`);
    const format = (seconds: number) => {
      const value = Number.isFinite(seconds) ? Math.floor(seconds) : 0;
      return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
    };
    const update = () => {
      pause.innerHTML = this.video.paused ? playIcon : pauseIcon;
      pause.setAttribute(
        'aria-label',
        this.video.paused ? 'Reanudar animación' : 'Pausar animación',
      );
      mute.innerHTML = this.video.muted || this.video.volume === 0 ? mutedIcon : soundIcon;
      mute.setAttribute('aria-label', 'Sonido');
      mute.setAttribute('aria-pressed', String(this.video.muted || this.video.volume === 0));
      volume.value = String(this.video.muted ? 0 : this.video.volume);
      volume.style.setProperty('--volume-level', `${Number(volume.value) * 100}%`);
      progress.value = this.video.duration > 0 ? this.video.currentTime / this.video.duration : 0;
      time.textContent = `${format(this.video.currentTime)} / ${format(this.video.duration)}`;
    };
    const reveal = () => {
      controls.classList.add('is-visible');
      this.dialog.classList.remove('is-idle');
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        if (controls.contains(document.activeElement)) {
          return;
        }
        controls.classList.remove('is-visible');
        this.dialog.classList.add('is-idle');
      }, 2500);
    };
    pause.addEventListener(
      'click',
      () => {
        if (this.video.paused) {
          void this.play();
        } else {
          this.video.pause();
        }
        reveal();
        update();
      },
      options,
    );
    mute.addEventListener(
      'click',
      () => {
        this.video.muted = !this.video.muted;
        update();
        reveal();
      },
      options,
    );
    volume.addEventListener(
      'input',
      () => {
        this.video.volume = Number(volume.value);
        this.video.muted = false;
        update();
        reveal();
      },
      options,
    );
    for (const event of ['timeupdate', 'durationchange', 'play', 'pause', 'volumechange']) {
      this.video.addEventListener(event, update, options);
    }
    this.dialog.addEventListener('pointermove', reveal, options);
    this.dialog.addEventListener(
      'pointerleave',
      () => {
        clearTimeout(this.hideTimer);
        if (!controls.contains(document.activeElement)) {
          controls.classList.remove('is-visible');
        }
      },
      options,
    );
    controls.addEventListener('focusin', reveal, options);
    controls.addEventListener('focusout', reveal, options);
    row.append(pause, mute, volume, time);
    controls.append(progress, row);
    update();
    this.retry.addEventListener(
      'click',
      () => {
        this.video.load();
        void this.play();
      },
      options,
    );
    this.video.addEventListener(
      'ended',
      () => {
        if (!this.video.ended || this.finished) {
          return;
        }
        this.complete();
      },
      options,
    );
    this.video.addEventListener(
      'error',
      () => {
        this.retry.hidden = false;
        this.continueOffline.hidden = false;
        if (!navigator.onLine) {
          this.defer();
        }
      },
      options,
    );
    window.addEventListener('offline', () => this.defer(), options);
    // Escape is equivalent to the visible skip action.
    this.dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        this.complete();
      },
      options,
    );
    this.video.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    this.dialog.append(this.video, controls, this.retry, this.continueOffline, skip);
    document.body.append(this.dialog);
    document.body.classList.add('release-welcome-pending');
    releaseStartupUi();
    this.dialog.showModal();
    if (offline) {
      queueMicrotask(() => this.defer());
    }
  }

  private complete(): void {
    if (this.finished) {
      return;
    }
    privateStorage.setItem(releaseWelcomeKey, 'seen');
    this.defer();
  }

  private defer(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    clearTimeout(this.hideTimer);
    this.events.abort();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.dialog.close();
    this.dialog.remove();
    document.body.classList.remove('release-welcome-pending');
    releaseStartupUi();
    // Offline deferral remains pending; complete() records explicit skips and ended playback.
    this.onComplete();
  }

  start(): void {
    if (this.started || this.finished) {
      return;
    }
    this.started = true;
    void this.play();
  }

  private async play(): Promise<void> {
    this.retry.hidden = true;
    try {
      await this.video.play();
    } catch {
      if (!this.finished) {
        this.retry.hidden = false;
      }
    }
  }
}

export function mountHistoryReplay(parent: Element): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button og-history-button';
  setUiText(button, 'La historia de Battly');
  button.addEventListener('click', () => {
    if (document.querySelector('.release-welcome')) {
      return;
    }
    new ReleaseWelcome(() => undefined).start();
  });
  parent.querySelector('.og-setting-actions')?.append(button);
}
