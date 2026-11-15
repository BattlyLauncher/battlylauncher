import type { BattlyClientService } from './battly-client-service';
import type { BattlyClientBuild } from '../../shared/minecraft/battly-client-contract';

type Update = NonNullable<Awaited<ReturnType<BattlyClientService['updateAvailable']>>>;
type Install = (root: string, build: BattlyClientBuild) => Promise<void>;

/** The queue is session-local, like LabyMod. Never writes a running game's files. */
export class BattlyClientUpdates {
  readonly #pending = new Map<string, { root: string; customVersion: string }>();
  #checking = false;
  #draining = false;
  constructor(private readonly service: Pick<BattlyClientService, 'updateAvailable'>) {}
  get pending(): number {
    return this.#pending.size;
  }
  get active(): boolean {
    return this.#checking || this.#draining;
  }

  async beforeLaunch(
    root: string,
    customVersion: string,
    choose: (update: Update) => Promise<number>,
    canInstall: () => boolean,
    install: Install,
  ): Promise<string | undefined> {
    if (this.active) {
      throw new Error('Battly Client installation is already running');
    }
    this.#checking = true;
    try {
      // An unavailable catalog must not prevent playing the installed client.
      const update = await this.service.updateAvailable(root, customVersion).catch(() => null);
      if (!update) {
        return;
      }
      const choice = await choose(update);
      if (choice === 2) {
        this.#pending.set(JSON.stringify([root, customVersion]), { root, customVersion });
      }
      if (choice !== 0) {
        return;
      }
      if (!canInstall()) {
        throw new Error('Close Minecraft before updating Battly Client');
      }
      this.#pending.delete(JSON.stringify([root, customVersion]));
      await install(root, update.latest);
      return String(update.latest.javaVersion);
    } finally {
      this.#checking = false;
    }
  }

  async drain(
    isBusy: () => boolean,
    install: Install,
    failed: (error: unknown) => void,
  ): Promise<void> {
    if (this.active || isBusy()) {
      return;
    }
    this.#draining = true;
    try {
      for (const [key, item] of this.#pending) {
        if (isBusy()) {
          return;
        }
        try {
          const update = await this.service.updateAvailable(item.root, item.customVersion);
          if (isBusy()) {
            return;
          }
          if (update) {
            await install(item.root, update.latest);
          }
        } catch (error) {
          failed(error);
        }
        // Failed updates are offered again on the next launch, without loops.
        this.#pending.delete(key);
      }
    } finally {
      this.#draining = false;
    }
  }
}
