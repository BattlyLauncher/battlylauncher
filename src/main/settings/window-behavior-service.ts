import { type MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import type { SettingsSnapshot } from '../../shared/settings/settings-contract';

export interface WindowBehaviorTarget {
  focus(): void;
  minimize?(): void;
  hide(): void;
  isDestroyed(): boolean;
  show(): void;
}

export interface PreventableCloseEvent {
  preventDefault(): void;
}

export class WindowBehaviorService {
  readonly #launchWindowManagementEnabled: boolean;
  readonly #closeMusicWindow: () => void;
  readonly #showMusicWindow: () => void;
  readonly #quit: () => void;
  readonly #settings: () => Promise<SettingsSnapshot>;
  #allowClose = false;
  #closeGeneration = 0;
  #launchGeneration = 0;
  #launchRunning = false;
  #launchReady = false;

  constructor(
    settings: () => Promise<SettingsSnapshot>,
    quit: () => void,
    launchWindowManagementEnabled = true,
    showMusicWindow: () => void = () => undefined,
    closeMusicWindow: () => void = () => undefined,
  ) {
    this.#settings = settings;
    this.#quit = quit;
    this.#launchWindowManagementEnabled = launchWindowManagementEnabled;
    this.#showMusicWindow = showMusicWindow;
    this.#closeMusicWindow = closeMusicWindow;
  }

  beforeQuit(): void {
    this.#allowClose = true;
  }

  showRequested(): void {
    this.#closeGeneration++;
  }

  closeRequested(window: WindowBehaviorTarget, event: PreventableCloseEvent): void {
    if (this.#allowClose) {
      return;
    }
    event.preventDefault();
    const generation = ++this.#closeGeneration;
    void this.#settings()
      .then((snapshot) => {
        if (window.isDestroyed() || generation !== this.#closeGeneration) {
          return;
        }
        if (snapshot.runtime.closeToBackground) {
          window.hide();
          return;
        }
        this.#allowClose = true;
        this.#quit();
      })
      .catch(() => {
        // Background mode is the default; a settings read failure must not
        // terminate downloads, voice or Minecraft management unexpectedly.
        if (!window.isDestroyed() && generation === this.#closeGeneration) {
          window.hide();
        }
      });
  }

  launchEvent(window: WindowBehaviorTarget, event: MinecraftLaunchEvent): void {
    if (!this.#launchWindowManagementEnabled || window.isDestroyed()) {
      return;
    }
    if (event.type === 'state' && event.state === 'preparing') {
      const generation = ++this.#launchGeneration;
      void this.#settings()
        .then((snapshot) => {
          if (
            generation === this.#launchGeneration &&
            !window.isDestroyed() &&
            snapshot.runtime.minimizeWhilePreparing
          ) {
            window.minimize?.();
          }
        })
        .catch(() => undefined);
    }
    if (event.type === 'state' && event.state === 'running') {
      this.#launchGeneration += 1;
      this.#launchRunning = true;
      this.#launchReady = false;
      return;
    }
    const readyLog = event.type === 'client-ready';
    if (readyLog && this.#launchRunning && !this.#launchReady) {
      this.#launchReady = true;
      const generation = this.#launchGeneration;
      void this.#settings()
        .then((snapshot) => {
          if (window.isDestroyed() || generation !== this.#launchGeneration) {
            return;
          }
          if (snapshot.runtime.hideLauncherOnGameStart) {
            window.hide();
            if (snapshot.runtime.showMusicOnGameStart) {
              this.#showMusicWindow();
            }
          }
        })
        .catch(() => undefined);
      return;
    }
    const terminalState =
      event.type === 'exit' ||
      (event.type === 'state' && (event.state === 'exited' || event.state === 'failed'));
    if (terminalState && !window.isDestroyed()) {
      this.#launchGeneration += 1;
      this.#launchRunning = false;
      this.#launchReady = false;
      this.#closeMusicWindow();
      window.show();
      window.focus();
    }
  }
}
