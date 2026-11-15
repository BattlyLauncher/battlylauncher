import { randomUUID } from 'node:crypto';

export class SupportConsentRequests {
  #pending:
    { id: string; owner: number; expiresAt: number; finish: (value: boolean) => void } | undefined;

  request(
    owner: number,
    send: (request: { id: string; expiresAt: number }) => void,
  ): Promise<boolean> {
    if (this.#pending) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const id = randomUUID(),
        expiresAt = Date.now() + 90_000;
      const finish = (value: boolean): void => {
        clearTimeout(timer);
        this.#pending = undefined;
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), 90_000);
      this.#pending = { id, owner, expiresAt, finish };
      try {
        send({ id, expiresAt });
      } catch {
        finish(false);
      }
    });
  }

  respond(owner: number, id: unknown, accepted: unknown): void {
    const pending = this.#pending;
    if (!pending || pending.owner !== owner || pending.id !== id) {
      return;
    }
    pending.finish(accepted === true && pending.expiresAt > Date.now());
  }

  cancel(): void {
    this.#pending?.finish(false);
  }
}
