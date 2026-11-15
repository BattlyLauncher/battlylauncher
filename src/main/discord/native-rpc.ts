import { createConnection, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { discordApplicationId } from '../../shared/discord-contract';

export function discordIpcPaths(platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const roots = new Set(
    [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'].filter((v): v is string => !!v),
  );
  if (platform === 'linux' && env.XDG_RUNTIME_DIR) {
    roots.add(join(env.XDG_RUNTIME_DIR, 'app/com.discordapp.Discord'));
    roots.add(join(env.XDG_RUNTIME_DIR, 'snap.discord'));
  }
  return [...roots].flatMap((root) =>
    Array.from({ length: 10 }, (_, i) => join(root, `discord-ipc-${i}`)),
  );
}

export function rpcFrame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Native Discord IPC. No HTTP, browser RPC, auth token or binary addon. */
export class NativeDiscordRpc {
  #listeners = new Set<(event: string, data: Record<string, unknown>) => void>();
  subscribe(listener: (event: string, data: Record<string, unknown>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  command(cmd: 'SEND_ACTIVITY_JOIN_INVITE' | 'CLOSE_ACTIVITY_REQUEST', userId: string): void {
    if (this.#enabled && this.#ready && /^\d{17,20}$/.test(userId)) {
      this.#socket?.write(rpcFrame(1, { cmd, args: { user_id: userId }, nonce: randomUUID() }));
    }
  }
  #socket: Socket | null = null;
  #enabled = false;
  #ready = false;
  #connecting = false;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #latest: unknown = null;
  #sent = '';
  #lastSent = 0;
  #pending: string | null = null;
  #ackTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly paths = discordIpcPaths(),
    private readonly intervalMs = 1_000,
    private readonly retryMs = 5_000,
    private readonly diagnostic: (status: string) => void = () => {},
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) {
      return;
    }
    this.#enabled = enabled;
    if (enabled) {
      void this.#connect();
    } else {
      this.#disconnect(true);
    }
  }
  update(activity: unknown): void {
    this.#latest = activity;
    this.#flush();
  }
  dispose(): void {
    this.#enabled = false;
    this.#disconnect(true);
  }
  #disconnect(clear: boolean): void {
    if (clear && this.#ready && this.#socket && !this.#socket.destroyed) {
      const socket = this.#socket;
      socket.end(
        rpcFrame(1, {
          cmd: 'SET_ACTIVITY',
          args: { pid: process.pid, activity: null },
          nonce: randomUUID(),
        }),
      );
      setTimeout(() => socket.destroy(), 500).unref();
    } else {
      this.#socket?.destroy();
    }
    this.#socket = null;
    this.#ready = false;
    this.#sent = '';
    this.#pending = null;
    if (this.#retry) {
      clearTimeout(this.#retry);
    }
    this.#retry = null;
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
    }
    this.#flushTimer = null;
    if (this.#ackTimer) {
      clearTimeout(this.#ackTimer);
    }
    this.#ackTimer = null;
  }
  #schedule(): void {
    if (!this.#enabled || this.#retry) {
      return;
    }
    this.#retry = setTimeout(() => {
      this.#retry = null;
      void this.#connect();
    }, this.retryMs);
    this.#retry.unref();
  }
  async #connect(): Promise<void> {
    if (!this.#enabled || this.#connecting || this.#socket) {
      return;
    }
    this.#connecting = true;
    try {
      for (const path of this.paths) {
        if (!this.#enabled) {
          break;
        }
        if (await this.#open(path)) {
          return;
        }
      }
      this.#schedule();
    } finally {
      this.#connecting = false;
    }
  }
  #open(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection(path);
      socket.unref();
      this.#socket = socket;
      let buffer = Buffer.alloc(0),
        settled = false;
      const finish = (ok: boolean) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(ok);
        }
      };
      const timeout = setTimeout(() => socket.destroy(), 2_000);
      timeout.unref();
      socket.on('connect', () =>
        socket.write(rpcFrame(0, { v: 1, client_id: discordApplicationId })),
      );
      socket.on('error', () => socket.destroy());
      socket.on('close', () => {
        const wasReady = this.#socket === socket && this.#ready;
        if (this.#socket === socket) {
          this.#socket = null;
          this.#ready = false;
          this.#sent = '';
          this.#pending = null;
        }
        if (wasReady && this.#ackTimer) {
          clearTimeout(this.#ackTimer);
          this.#ackTimer = null;
        }
        finish(false);
        if (wasReady) {
          this.diagnostic('disconnected');
          this.#schedule();
        }
      });
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > 1_048_584) {
          socket.destroy();
          return;
        }
        while (buffer.length >= 8) {
          const opcode = buffer.readUInt32LE(),
            length = buffer.readUInt32LE(4);
          if (length > 1_048_576) {
            socket.destroy();
            return;
          }
          if (buffer.length < length + 8) {
            break;
          }
          const body = buffer.subarray(8, length + 8);
          buffer = buffer.subarray(length + 8);
          if (opcode === 3) {
            const head = Buffer.alloc(8);
            head.writeUInt32LE(4);
            head.writeUInt32LE(body.length, 4);
            socket.write(Buffer.concat([head, body]));
            continue;
          }
          if (opcode === 2) {
            socket.destroy();
            return;
          }
          if (opcode !== 1 || this.#socket !== socket || !this.#enabled) {
            continue;
          }
          try {
            const message = JSON.parse(body.toString()) as {
              cmd?: string;
              evt?: string;
              nonce?: string;
              data?: Record<string, unknown>;
            };
            if (message.evt === 'READY') {
              this.#ready = true;
              this.#lastSent = 0;
              finish(true);
              this.diagnostic('connected');
              if (this.#listeners.size) {
                for (const evt of ['ACTIVITY_JOIN', 'ACTIVITY_JOIN_REQUEST']) {
                  socket.write(
                    rpcFrame(1, { cmd: 'SUBSCRIBE', evt, args: {}, nonce: randomUUID() }),
                  );
                }
              }
              this.#flush();
            } else if (
              message.cmd === 'DISPATCH' &&
              ['ACTIVITY_JOIN', 'ACTIVITY_JOIN_REQUEST'].includes(message.evt ?? '') &&
              message.data &&
              typeof message.data === 'object' &&
              !Array.isArray(message.data)
            ) {
              for (const listener of this.#listeners) {
                try {
                  listener(message.evt!, message.data);
                } catch {
                  this.diagnostic('event-error');
                }
              }
            } else if (message.nonce === this.#pending) {
              this.#pending = null;
              if (this.#ackTimer) {
                clearTimeout(this.#ackTimer);
              }
              this.#ackTimer = null;
              if (message.evt === 'ERROR') {
                this.diagnostic('rejected');
                this.#sent = '';
                this.#lastSent = Date.now() + 4_000;
              } else {
                this.diagnostic('updated');
              }
              this.#flush();
            } else if (message.evt === 'ERROR') {
              this.diagnostic('command-rejected');
            }
          } catch {
            socket.destroy();
            return;
          }
        }
      });
    });
  }
  #flush(): void {
    if (!this.#enabled || !this.#ready || !this.#socket || this.#pending) {
      return;
    }
    const value = JSON.stringify(this.#latest);
    if (value === this.#sent) {
      return;
    }
    const delay = this.intervalMs - (Date.now() - this.#lastSent);
    if (delay > 0) {
      if (!this.#flushTimer) {
        this.#flushTimer = setTimeout(() => {
          this.#flushTimer = null;
          this.#flush();
        }, delay);
        this.#flushTimer.unref();
      }
      return;
    }
    this.#sent = value;
    this.#lastSent = Date.now();
    this.#pending = randomUUID();
    this.#socket.write(
      rpcFrame(1, {
        cmd: 'SET_ACTIVITY',
        args: { pid: process.pid, activity: this.#latest },
        nonce: this.#pending,
      }),
    );
    this.#ackTimer = setTimeout(() => this.#socket?.destroy(), 5_000);
    this.#ackTimer.unref();
  }
}
