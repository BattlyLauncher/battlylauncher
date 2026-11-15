import { createServer, type Server, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { MinecraftLaunchOptions } from '../minecraft/launcher-adapter';

export type ClientOwner = Pick<MinecraftLaunchOptions['authorization'], 'uuid' | 'name' | 'type'>;
export interface ClientBackend {
  session(owner: ClientOwner): Promise<{ username: string; premium: boolean } | null>;
  dispatch(owner: ClientOwner, operation: string, body: Record<string, unknown>): Promise<unknown>;
  native(pid: number, enabled: boolean): void;
}
interface Lease {
  owner: ClientOwner;
  pid: number;
  claimed: boolean;
  busy: number;
  requests: number;
  window: number;
  revoked: boolean;
}
const routes = new Set([
  'social',
  'search',
  'friend',
  'profile',
  'worlds',
  'rooms',
  'worlds-action',
  'voice',
  'voice-state',
]);
export class ClientBridge {
  #server?: Server;
  #starting?: Promise<number>;
  #leases = new Map<string, Lease>();
  constructor(private readonly backend: ClientBackend) {}
  async #listen(): Promise<number> {
    return (this.#starting ??= new Promise((resolve, reject) => {
      const server = (this.#server = createServer((req, res) => {
        void this.#request(req).then(
          ({ status, data }) => {
            if (res.destroyed) {
              return;
            }
            res.writeHead(status, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
              'x-content-type-options': 'nosniff',
            });
            res.end(JSON.stringify(data));
          },
          () => {
            if (!res.destroyed) {
              res.writeHead(500, {
                'content-type': 'application/json',
                'cache-control': 'no-store',
              });
              res.end(JSON.stringify({ error: 'No se pudo completar la operación' }));
            }
          },
        );
      }));
      server.requestTimeout = 10000;
      server.headersTimeout = 10000;
      server.keepAliveTimeout = 2000;
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.unref();
        const address = server.address();
        if (!address || typeof address === 'string') {
          return reject(new Error('Invalid bridge listener'));
        }
        resolve(address.port);
      });
    }));
  }
  async lease(owner: ClientOwner) {
    const port = await this.#listen(),
      secret = randomBytes(32).toString('hex');
    const state: Lease = {
      owner: { uuid: owner.uuid, name: owner.name, type: owner.type },
      pid: 0,
      claimed: false,
      busy: 0,
      requests: 0,
      window: Date.now(),
      revoked: false,
    };
    this.#leases.set(secret, state);
    return {
      environment: {
        BATTLY_CLIENT_ENDPOINT: `http://127.0.0.1:${port}/v1/`,
        BATTLY_CLIENT_SECRET: secret,
        BATTLY_LAUNCHER_PID: String(process.pid),
      },
      claim: () => {
        state.claimed = true;
        if (state.pid) {
          this.backend.native(state.pid, true);
        }
      },
      process: (pid: number) => {
        if (Number.isSafeInteger(pid) && pid > 0) {
          if (state.claimed && state.pid) {
            this.backend.native(state.pid, false);
          }
          state.pid = pid;
          if (state.claimed) {
            this.backend.native(pid, true);
          }
        }
      },
      close: () => {
        state.revoked = true;
        this.#leases.delete(secret);
        if (state.claimed && state.pid) {
          this.backend.native(state.pid, false);
        }
      },
    };
  }
  async #request(req: IncomingMessage): Promise<{ status: number; data: unknown }> {
    const fail = (status: number, error: string) => ({ status, data: { error } });
    if (
      req.socket.remoteAddress !== '127.0.0.1' ||
      req.headers.origin ||
      req.headers['sec-fetch-site'] ||
      req.method !== 'POST' ||
      !req.headers.host?.match(/^127\.0\.0\.1:\d+$/) ||
      req.headers['content-type'] !== 'application/json'
    ) {
      return fail(403, 'Acceso local no válido');
    }
    const auth = req.headers.authorization || '',
      secret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!/^[a-f0-9]{64}$/.test(secret)) {
      return fail(401, 'Sesión del launcher no válida');
    }
    const lease = [...this.#leases].find(([key]) =>
      timingSafeEqual(Buffer.from(key), Buffer.from(secret)),
    )?.[1];
    if (!lease || lease.revoked) {
      return fail(401, 'Sesión del launcher caducada');
    }
    if (Date.now() - lease.window > 60000) {
      lease.window = Date.now();
      lease.requests = 0;
    }
    if (++lease.requests > 180 || lease.busy >= 3) {
      return fail(429, 'Espera antes de volver a intentarlo');
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      const value: unknown = chunk;
      if (!Buffer.isBuffer(value)) {
        return fail(400, 'Solicitud no válida');
      }
      const data = Buffer.from(value);
      bytes += data.length;
      if (bytes > 16384) {
        return fail(413, 'Solicitud demasiado grande');
      }
      chunks.push(data);
    }
    let body: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fail(400, 'Solicitud no válida');
      }
      body = value as Record<string, unknown>;
    } catch {
      return fail(400, 'Solicitud no válida');
    }
    const operation = req.url?.replace(/^\/v1\//, '');
    if (!operation || (!routes.has(operation) && operation !== 'session')) {
      return fail(404, 'Operación no disponible');
    }
    lease.busy++;
    try {
      const account =
        lease.owner.type === 'battly' ? await this.backend.session(lease.owner) : null;
      if (operation === 'session') {
        if (!lease.claimed) {
          lease.claimed = true;
          if (lease.pid) {
            this.backend.native(lease.pid, true);
          }
        }
        return {
          status: 200,
          data: {
            protocol: 1,
            rpcOwner: 'launcher',
            account: account ? { username: account.username, premium: account.premium } : null,
          },
        };
      }
      if (!lease.claimed || !account) {
        return fail(403, 'Inicia Minecraft con tu cuenta de Battly para usar estos servicios');
      }
      const data = await this.backend.dispatch(lease.owner, operation, body);
      if (lease.revoked) {
        return fail(401, 'Sesión del launcher caducada');
      }
      if (!(await this.backend.session(lease.owner))) {
        return fail(403, 'La cuenta de lanzamiento ha cambiado');
      }
      // The backend only returns public DTOs, never account/token records.
      return { status: 200, data };
    } catch {
      return fail(
        400,
        'No se pudo completar la operación. Comprueba tu cuenta y conexión en Battly Launcher.',
      );
    } finally {
      lease.busy--;
    }
  }
  close(): void {
    for (const lease of this.#leases.values()) {
      lease.revoked = true;
      if (lease.claimed && lease.pid) {
        this.backend.native(lease.pid, false);
      }
    }
    this.#leases.clear();
    this.#server?.closeAllConnections();
    this.#server?.close();
    this.#server = undefined;
    this.#starting = undefined;
  }
}
