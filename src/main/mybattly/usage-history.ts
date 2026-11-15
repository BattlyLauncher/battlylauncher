import { randomUUID } from 'node:crypto';
export interface UsageHeartbeat {
  sessionId: string;
  sequence: number;
  game: boolean;
  launcher: boolean;
  ended: boolean;
  offsetMinutes: number;
}
/** The API calculates elapsed time. This client stores only transient session state. */
export class DesktopUsageClient {
  #session: { token: string; id: string; sequence: number } | undefined;
  #queue: Promise<void> = Promise.resolve();
  #queued = 0;
  #tail: { token: string; game: boolean; launcher: boolean } | undefined;
  #last: { token: string; game: boolean; launcher: boolean; at: number } | undefined;
  constructor(private readonly send: (token: string, body: UsageHeartbeat) => Promise<void>) {}
  sample(token: string, game: boolean, launcher: boolean): Promise<void> {
    const desired = { token, game, launcher };
    if (this.#queued >= 2 && this.#tail) {
      Object.assign(this.#tail, desired);
      return this.#queue;
    }
    this.#queued++;
    this.#tail = desired;
    this.#queue = this.#queue
      .catch(() => undefined)
      .then(async () => {
        const { token, game, launcher } = desired;
        const previous = this.#last;
        const elapsed = Date.now() - (previous?.at ?? 0);
        if (
          previous &&
          previous.token === token &&
          previous.game === game &&
          previous.launcher === launcher &&
          elapsed >= 0 &&
          elapsed < 15000
        ) {
          return;
        }
        if (this.#session && (this.#session.token !== token || (!game && !launcher))) {
          const old = this.#session;
          this.#session = undefined;
          this.#last = undefined;
          await this.send(old.token, {
            sessionId: old.id,
            sequence: ++old.sequence,
            game: false,
            launcher: false,
            ended: true,
            offsetMinutes: -new Date().getTimezoneOffset(),
          }).catch(() => undefined);
        }
        if (!token || (!game && !launcher)) {
          return;
        }
        const session = (this.#session ??= { token, id: randomUUID(), sequence: 0 });
        await this.send(token, {
          sessionId: session.id,
          sequence: ++session.sequence,
          game,
          launcher,
          ended: false,
          offsetMinutes: -new Date().getTimezoneOffset(),
        });
        this.#last = { token, game, launcher, at: Date.now() };
      })
      .finally(() => {
        this.#queued--;
        if (this.#tail === desired) {
          this.#tail = undefined;
        }
      });
    return this.#queue;
  }
  finish(): Promise<void> {
    return this.sample('', false, false);
  }
}
