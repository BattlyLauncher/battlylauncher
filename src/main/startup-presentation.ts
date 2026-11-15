export function canSkipStartupSplash(enabled: boolean, premium: boolean): boolean {
  return enabled && premium;
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

export async function startupPremium(
  check: () => Promise<boolean>,
  timeoutMs = 4000,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check().catch(() => false),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Wait for the splash to paint, then keep it visible briefly even on fast machines. */
export class StartupSplashPresentation {
  #shownAt: number | undefined;
  #resolve!: () => void;
  #ready = new Promise<void>((resolve) => {
    this.#resolve = resolve;
  });
  #closed = false;
  constructor(
    private readonly now = Date.now,
    private readonly minimumVisibleMs = 4100,
  ) {}

  shown(): void {
    this.#shownAt ??= this.now();
    this.#resolve();
  }

  closed(): void {
    this.#closed = true;
    this.#resolve();
  }

  async wait(): Promise<void> {
    // A failed splash must never prevent the launcher from opening.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.#ready,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 5000);
      }),
    ]);
    clearTimeout(timeout);
    if (this.#closed || this.#shownAt === undefined) {
      return;
    }
    const remaining = this.minimumVisibleMs - (this.now() - this.#shownAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
}
