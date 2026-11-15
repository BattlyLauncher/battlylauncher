import { readBoundedResponse } from '../network/read-bounded-response';
import { io, type Socket } from 'socket.io-client';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { networkAvailable } from '../network/connectivity';

export interface AccessBan {
  code: 'BATTLY_BANNED';
  banned: true;
  scope: 'account' | 'ip';
  message: string;
}
export function parseAccessBan(value: unknown): AccessBan | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (
    v.code !== 'BATTLY_BANNED' ||
    v.banned !== true ||
    (v.scope !== 'account' && v.scope !== 'ip')
  ) {
    return null;
  }
  return {
    code: 'BATTLY_BANNED',
    banned: true,
    scope: v.scope,
    message: typeof v.message === 'string' ? v.message.slice(0, 1000) : '',
  };
}

/** Dedicated access connection: privacy/social preferences cannot disable moderation. */
export class AccessMonitor {
  ban: AccessBan | null = null;
  #socket?: Socket;
  #token?: string;
  #timer?: NodeJS.Timeout;
  #busy = false;
  #flight?: Promise<void>;
  #revision = 0;
  #stopped = false;
  #offline = false;
  #writes: Promise<void> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly token: () => Promise<string>,
    private readonly changed: (ban: AccessBan | null) => void,
    private readonly origin = 'https://api.battlylauncher.com',
  ) {}

  async start(): Promise<void> {
    try {
      this.ban = parseAccessBan(
        JSON.parse((await readBoundedRegularFile(this.path, 8192)).toString()),
      );
    } catch {
      /* First use has no saved restriction. */
    }
    if (this.ban) {
      this.changed(this.ban);
    }
    void this.check();
    this.#timer = setInterval(() => {
      void this.check();
    }, 15_000);
    this.#timer.unref();
  }

  async #receive(value: unknown): Promise<void> {
    const ban = parseAccessBan(value);
    if (!ban || this.#stopped) {
      return;
    }
    this.#revision++;
    const different = JSON.stringify(ban) !== JSON.stringify(this.ban);
    this.ban = ban; // Enforce before disk I/O or presenting UI.
    if (different) {
      this.changed(ban);
    }
    await this.#save(ban);
  }

  #save(ban: AccessBan | null): Promise<void> {
    this.#writes = this.#writes
      .then(() => writeFileAtomically(this.path, JSON.stringify(ban)))
      .catch(() => console.warn('[access] Could not persist restriction'));
    return this.#writes;
  }

  check(): Promise<void> {
    if (!this.#flight) {
      this.#flight = this.#check().finally(() => {
        this.#flight = undefined;
      });
    }
    return this.#flight;
  }
  async #check(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    if (!networkAvailable()) {
      this.#offline = true;
      this.#socket?.disconnect();
      return;
    }
    if (this.#offline) {
      this.#offline = false;
      this.#socket?.connect();
    }
    this.#busy = true;
    try {
      const token = await this.token().catch(() => '');
      if (this.#stopped) {
        return;
      }
      if (token !== this.#token) {
        this.#socket?.disconnect();
        this.#token = token;
        const socket = io(`${this.origin}/access`, {
          auth: token ? { token } : {},
          reconnection: true,
          timeout: 10000,
        });
        this.#socket = socket;
        socket.on('battly_banned', (value) => {
          if (this.#socket === socket) {
            void this.#receive(value);
          }
        });
        socket.on('connect_error', (error: Error & { data?: unknown }) => {
          if (this.#socket === socket) {
            void this.#receive(error.data);
          }
        });
        socket.on('connect', () => {
          if (!this.#busy) {
            void this.check();
          }
        });
      }
      const revision = this.#revision;
      const response = await fetch(`${this.origin}/api/v2/launcher/access`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      const value = JSON.parse(
        await readBoundedResponse(response, 256 * 1024, 'Access response is too large'),
      ) as Record<string, unknown>;
      if (this.#stopped || revision !== this.#revision) {
        return;
      }
      if (response.status === 403 || response.status === 200) {
        await this.#receive(value);
      }
      // Only an explicit authenticated allow clears a previously confirmed restriction.
      if (
        response.ok &&
        value.allowed === true &&
        value.banned === false &&
        this.ban &&
        (token || this.ban.scope === 'ip')
      ) {
        this.ban = null;
        await this.#save(null);
        if (!this.ban) {
          this.changed(null);
        }
        this.#socket?.connect();
      }
    } catch {
      /* Network errors and maintenance are not bans and cannot lift one. */
    } finally {
      this.#busy = false;
    }
  }
  assertAllowed(): void {
    if (this.ban) {
      throw new Error('BATTLY_BANNED');
    }
  }
  stop(): void {
    this.#stopped = true;
    clearInterval(this.#timer);
    this.#socket?.disconnect();
  }
}
