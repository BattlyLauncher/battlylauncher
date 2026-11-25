import { clearTimeout, setTimeout } from 'node:timers';
import type { RuntimeSettings } from '../shared/settings/settings-contract';

export function canSkipStartupSplash(enabled: boolean, premium: boolean): boolean {
  return enabled && premium;
}

export function startupIntroVolume(
  runtime: Pick<RuntimeSettings, 'launchBoostEnabled' | 'startupSoundEnabled'>,
  volume: number,
): number {
  return runtime.startupSoundEnabled && !runtime.launchBoostEnabled ? volume : 0;
}

export interface StartupMainWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  hide(): void;
  focus(): void;
}

/** Some Windows launches ignore the first native show. Confirm it before closing the splash. */
export async function revealStartupMainWindow(
  window: StartupMainWindow,
  allowed = () => true,
): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (window.isDestroyed() || !allowed()) {
      return false;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    if (attempt > 0 && !window.isVisible()) {
      window.hide();
    }
    window.show();
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (window.isDestroyed() || !allowed()) {
      return false;
    }
    if (window.isVisible() && !window.isMinimized()) {
      window.focus();
      return true;
    }
  }
  return false;
}

export async function startupResultWithin<T>(
  result: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

/** Avoid flashing a splash that has already appeared. */
export class StartupSplashPresentation {
  #shownAt: number | undefined;
  constructor(
    private readonly now = Date.now,
    private readonly minimumVisibleMs = 300,
  ) {}

  shown(): void {
    this.#shownAt ??= this.now();
  }

  closed(): void {
    this.#shownAt = undefined;
  }

  async wait(): Promise<void> {
    if (this.#shownAt === undefined) {
      return;
    }
    const remaining = this.minimumVisibleMs - (this.now() - this.#shownAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
}
