import { checkLaunchModDuplicates } from './launch-mod-preflight';
import { prepareLegacyGameOptions } from './legacy-game-options';
import { LaunchMemoryCancelledError } from './launch-memory-preflight';
import type {
  MinecraftLaunchEventSink,
  MinecraftLaunchHandle,
  MinecraftLaunchOptions,
  MinecraftLauncherAdapter,
} from './launcher-adapter';

interface ActiveLaunch {
  cancelRequested: boolean;
  handle?: MinecraftLaunchHandle;
  state: 'preparing' | 'running' | 'finishing';
}

export class LauncherService {
  readonly #adapters: ReadonlyMap<string, MinecraftLauncherAdapter>;
  readonly #active = new Map<symbol, ActiveLaunch>();
  #latest: symbol | undefined;

  constructor(
    adapters: readonly MinecraftLauncherAdapter[],
    private readonly prepare?: (
      options: MinecraftLaunchOptions,
      emit: MinecraftLaunchEventSink,
    ) => Promise<MinecraftLaunchOptions>,
  ) {
    const byEngine = new Map<string, MinecraftLauncherAdapter>();
    for (const adapter of adapters) {
      if (byEngine.has(adapter.engine)) {
        throw new TypeError(`Duplicate launcher adapter: ${adapter.engine}`);
      }
      byEngine.set(adapter.engine, adapter);
    }
    this.#adapters = byEngine;
  }

  get active(): boolean {
    return this.#active.size > 0;
  }

  get preparing(): boolean {
    return [...this.#active.values()].some((launch) => launch.state === 'preparing');
  }

  async start(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
    settled?: (
      exit: Awaited<MinecraftLaunchHandle['completion']> | null,
      error?: unknown,
    ) => void | Promise<void>,
    launchId = Symbol('minecraft-launch'),
  ): Promise<void> {
    if (this.#active.has(launchId)) {
      throw new Error('Identificador de lanzamiento duplicado');
    }
    const adapter = this.#adapters.get(options.engine);
    if (!adapter) {
      throw new TypeError(`Minecraft launcher unavailable: ${options.engine}`);
    }

    const active: ActiveLaunch = { cancelRequested: false, state: 'preparing' };
    this.#active.set(launchId, active);
    this.#latest = launchId;
    let terminalState: 'exited' | 'failed' | undefined;
    const forward: MinecraftLaunchEventSink = (event) => {
      if (event.type === 'state') {
        if (event.state === 'exited' || event.state === 'failed') {
          terminalState = event.state;
          active.state = 'finishing';
          return;
        }
        active.state = event.state;
      }
      emit(event);
    };
    const finish = async (
      exit: Awaited<MinecraftLaunchHandle['completion']> | null,
      error?: unknown,
    ): Promise<void> => {
      active.state = 'finishing';
      try {
        // Each process owns its cleanup; another running game is independent.
        await settled?.(exit, error);
      } finally {
        this.#active.delete(launchId);
        emit({
          type: 'state',
          state:
            terminalState ??
            (error && !(error instanceof LaunchMemoryCancelledError) ? 'failed' : 'exited'),
        });
      }
    };
    try {
      await checkLaunchModDuplicates(options);
      if (active.cancelRequested) {
        throw new LaunchMemoryCancelledError();
      }
      if (this.prepare) {
        options = await this.prepare(options, forward);
      }
      await prepareLegacyGameOptions(options, forward);
      const handle = await adapter.launch(options, forward);
      active.handle = handle;
      if (active.cancelRequested) {
        handle.cancel();
      }
      void handle.completion
        .then(
          (exit) => finish(exit),
          (error: unknown) => finish(null, error),
        )
        .catch(() => undefined);
    } catch (error) {
      await finish(null, error);
      throw error;
    }
  }

  cancel(launchId = this.#latest): boolean {
    const active = launchId && this.#active.get(launchId);
    if (!active) {
      return false;
    }
    active.cancelRequested = true;
    return active.handle ? active.handle.cancel() : true;
  }
}
