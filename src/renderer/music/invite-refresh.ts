import type { MusicCollaborationInvite } from '../../shared/music/music-contract';

export class MusicInviteRefresh {
  #account: string | null = null;
  #revision = 0;
  #updatedAt = -Infinity;
  #cached: readonly MusicCollaborationInvite[] = [];
  #pending: Promise<readonly MusicCollaborationInvite[] | null> | null = null;

  constructor(
    private readonly fetchInvites: () => Promise<readonly MusicCollaborationInvite[]>,
    private readonly renderCount: (count: number) => void,
  ) {}

  setAccount(account: string | null): void {
    if (account === this.#account) {
      return;
    }
    this.#account = account;
    this.invalidate();
    this.#cached = [];
    this.renderCount(0);
  }

  invalidate(): void {
    this.#revision++;
    this.#updatedAt = -Infinity;
    this.#pending = null;
  }

  refresh(force = false): Promise<readonly MusicCollaborationInvite[] | null> {
    if (!this.#account) {
      return Promise.resolve(null);
    }
    if (this.#pending) {
      return this.#pending;
    }
    if (!force && Date.now() - this.#updatedAt < 60_000) {
      return Promise.resolve(this.#cached);
    }
    const revision = this.#revision;
    this.#updatedAt = Date.now();
    const pending = this.fetchInvites()
      .then((invites) => {
        if (revision !== this.#revision) {
          return null;
        }
        this.#cached = invites;
        this.#updatedAt = Date.now();
        this.renderCount(invites.length);
        return invites;
      })
      .finally(() => {
        if (this.#pending === pending) {
          this.#pending = null;
        }
      });
    this.#pending = pending;
    return pending;
  }
}
