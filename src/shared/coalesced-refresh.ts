/** Groups bursts without overlapping work or postponing updates indefinitely. */
export class CoalescedRefresh {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #pending = false;
  #lastStarted = -Infinity;

  constructor(
    private readonly work: () => Promise<void>,
    private readonly delayMs = 200,
    private readonly minimumIntervalMs = 2000,
  ) {}

  request(): void {
    this.#pending = true;
    if (this.#running || this.#timer !== undefined) {
      return;
    }
    const delay = Math.max(this.delayMs, this.minimumIntervalMs - (Date.now() - this.#lastStarted));
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, delay);
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#pending = false;
    this.#lastStarted = -Infinity;
  }

  async #run(): Promise<void> {
    this.#pending = false;
    this.#running = true;
    this.#lastStarted = Date.now();
    try {
      await this.work();
    } catch {
      // Failed refreshes wait for another event instead of retrying in a tight loop.
    } finally {
      this.#running = false;
      if (this.#pending) {
        this.request();
      }
    }
  }
}
