import { AsyncLocalStorage } from 'node:async_hooks';
import type { MinecraftLaunchEvent } from '../shared/minecraft/launch-contract';

/** Tracks preparation independently of the lifetime of a launched game. */
export class TaskbarProgress {
  readonly #context = new AsyncLocalStorage<symbol>();
  readonly #tasks = new Map<symbol, number | null>();
  #lastValue = -1;
  constructor(private readonly render: (value: number) => void) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const id = Symbol('taskbar');
    this.#tasks.set(id, null);
    this.refresh();
    return this.#context.run(id, async () => {
      try {
        return await operation();
      } finally {
        this.#tasks.delete(id);
        this.refresh();
      }
    });
  }
  update(current: number, total: number): void {
    const id = this.#context.getStore();
    if (!id || !this.#tasks.has(id)) {
      return;
    }
    this.#tasks.set(
      id,
      Number.isFinite(current) && Number.isFinite(total) && total > 0
        ? Math.max(0, Math.min(1, current / total))
        : null,
    );
    this.refresh();
  }
  finish(): void {
    const id = this.#context.getStore();
    if (id) {
      this.#tasks.delete(id);
    }
    this.refresh();
  }
  launch(event: MinecraftLaunchEvent): void {
    if (event.type === 'progress' || event.type === 'check') {
      this.update(event.current, event.total);
    } else if (event.type === 'phase') {
      this.update(0, 0);
    } else if (
      event.type === 'process' ||
      event.type === 'exit' ||
      (event.type === 'state' && event.state !== 'preparing')
    ) {
      this.finish();
    }
  }
  refresh(): void {
    const values = [...this.#tasks.values()];
    const value = !values.length
      ? -1
      : values.includes(null)
        ? 2
        : values.reduce<number>((sum, item) => sum + (item ?? 0), 0) / values.length;
    // Byte callbacks can fire for every chunk. Limit native updates to visible changes.
    if (
      value === this.#lastValue ||
      (value > 0 &&
        value < 1 &&
        this.#lastValue >= 0 &&
        this.#lastValue <= 1 &&
        Math.abs(value - this.#lastValue) < 0.005)
    ) {
      return;
    }
    this.#lastValue = value;
    this.render(value);
  }
}
