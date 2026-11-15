export type StartupStep = 'profile' | 'settings' | 'services' | 'window' | 'renderer';

export interface StartupProgressChange {
  readonly progress: number;
  readonly status: string;
}

const stepProgress: Readonly<Record<StartupStep, number>> = Object.freeze({
  profile: 20,
  settings: 45,
  services: 65,
  window: 82,
  renderer: 100,
});

export class StartupProgress {
  readonly #completed = new Set<StartupStep>();
  readonly #onChange: (change: StartupProgressChange) => void;
  #snapshot: StartupProgressChange = { progress: 0, status: 'Preparando Battly…' };

  constructor(onChange: (change: StartupProgressChange) => void) {
    this.#onChange = onChange;
  }

  snapshot(): StartupProgressChange {
    return this.#snapshot;
  }

  complete(step: StartupStep, status: string): void {
    if (this.#completed.has(step)) {
      return;
    }
    this.#completed.add(step);
    this.#snapshot = { progress: stepProgress[step], status };
    this.#onChange(this.#snapshot);
  }
}
