/** The initial HTML blocks UI paint before preferences or the renderer bundle have loaded. */
export function releaseStartupUi(): void {
  document.body.removeAttribute('data-startup-pending');
  document.body.inert = false;
}

/** Startup-only animation. Construct before showing the main window; start after it is shown. */
export class OgIntro {
  private readonly layer = document.createElement('div');
  private readonly intro = document.createElement('video');
  private readonly loop = document.createElement('video');
  private readonly hiddenElements = new Map<HTMLElement, boolean>();
  private readonly events = new AbortController();
  private observer?: MutationObserver;
  private watchdog?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private revealed = false;
  private loopStarted = false;

  constructor(
    introUrl: string,
    loopUrl: string,
    private readonly onReveal?: () => void,
  ) {
    this.layer.id = 'og-background';
    this.layer.setAttribute('aria-hidden', 'true');
    for (const video of [this.intro, this.loop]) {
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.addEventListener('error', () => this.stop(), { signal: this.events.signal });
    }
    this.intro.src = introUrl;
    this.loop.src = loopUrl;
    this.loop.loop = true;
    this.loop.hidden = true;
    this.layer.append(this.intro, this.loop);
    document.body.prepend(this.layer);
    document.body.classList.add('og-intro-pending');
    releaseStartupUi();
    const hideUi = () => {
      for (const element of document.body.children) {
        if (
          !(element instanceof HTMLElement) ||
          element === this.layer ||
          this.hiddenElements.has(element)
        ) {
          continue;
        }
        this.hiddenElements.set(element, element.inert);
        element.inert = true;
      }
    };
    hideUi();
    this.observer = new MutationObserver(hideUi);
    this.observer.observe(document.body, { childList: true });
    const options = { signal: this.events.signal };
    this.intro.addEventListener(
      'timeupdate',
      () => {
        if (!this.intro.ended && !this.loopStarted && !this.revealed) {
          this.armWatchdog(15_000);
        }
      },
      options,
    );
    this.intro.addEventListener(
      'ended',
      () => {
        this.armWatchdog(15_000);
        void this.loop.play().catch(() => this.stop());
      },
      options,
    );
    this.loop.addEventListener(
      'playing',
      () => {
        this.loopStarted = true;
        this.loop.hidden = false;
        this.intro.hidden = true;
      },
      options,
    );
    // Count actual playback, not buffering time or time spent minimized.
    this.loop.addEventListener(
      'timeupdate',
      () => {
        if (this.loopStarted && this.loop.currentTime >= 1) {
          this.reveal();
        }
      },
      options,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !this.revealed) {
          this.stop();
        }
      },
      options,
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!this.revealed) {
          return;
        }
        if (document.hidden) {
          this.loop.pause();
        } else {
          void this.loop.play().catch(() => this.stop());
        }
      },
      options,
    );
    this.armWatchdog(15_000);
  }

  start(): void {
    if (this.stopped) {
      return;
    }
    this.armWatchdog(15_000);
    void this.intro.play().catch(() => this.stop());
  }

  private armWatchdog(delay: number): void {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.stop(), delay);
  }

  private reveal(): void {
    if (this.revealed) {
      return;
    }
    this.revealed = true;
    clearTimeout(this.watchdog);
    this.observer?.disconnect();
    for (const [element, inert] of this.hiddenElements) {
      element.inert = inert;
    }
    this.hiddenElements.clear();
    document.body.classList.remove('og-intro-pending');
    this.intro.pause();
    this.intro.removeAttribute('src');
    this.intro.load();
    if (document.hidden) {
      this.loop.pause();
    }
    this.onReveal?.();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.events.abort();
    this.reveal();
    clearTimeout(this.watchdog);
    for (const video of [this.intro, this.loop]) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.layer.remove();
  }
}

export function mountOgSetting(parent: Element): void {
  const section = document.createElement('section');
  section.className = 'og-setting';
  section.innerHTML = /* HTML */ `<div class="og-setting-top">
      <span class="og-setting-identity"
        ><strong translate="no">OG</strong> <span class="og-setting-badge">CLÁSICO</span></span
      >
      <label
        class="og-setting-heading"
        for="og-intro-enabled"
      >
        <span>Animación de inicio original</span>
        <input
          type="checkbox"
          id="og-intro-enabled"
          data-setting="ogIntroEnabled"
          aria-describedby="og-setting-description"
        />
      </label>
    </div>
    <p id="og-setting-description">
      Recupera la intro y el fondo animado del Battly original. Se reproduce al abrir Battly. Puedes
      saltarla con Esc.
    </p>
    <div class="og-setting-actions">
      <p class="og-setting-note">Se aplicará la próxima vez que abras Battly.</p>
    </div>`;
  parent.prepend(section);
}
