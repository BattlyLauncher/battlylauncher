import { readBoundedResponse, readBoundedResponseBytes } from '../network/read-bounded-response';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  normalizeServerId,
  normalizeServerInviteDraft,
  type ServerInviteDraft,
  type ServerPermissionGrant,
  type ServerSharingSnapshot,
  type ServerShareFriend,
  type ServerSummary,
  type ServerTunnelSnapshot,
} from '../../shared/servers/server-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const maximumJsonBytes = 1024 * 1024;
const maximumFrpcBytes = 128 * 1024 * 1024;

interface TunnelConfiguration {
  readonly frpsDomain: string;
  readonly frpsPort: number;
  readonly publicAddress: string;
  readonly remotePort: number;
  readonly subdomain: string;
  readonly tokenEndpoint: string;
}

interface TunnelState {
  process: ChildProcess | null;
  snapshot: ServerTunnelSnapshot;
  temporaryConfig: string | null;
}

type SpawnTunnel = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly shell: false;
    readonly stdio: 'pipe';
    readonly windowsHide: true;
  },
) => ChildProcess;

function waitForProcessClose(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolvePromise) => {
    let settled = false;
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (closed: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      resolvePromise(closed);
    };
    timer.unref();
    child.once('close', onClose);
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true);
    }
  });
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  if (await waitForProcessClose(child, 1_500)) {
    return;
  }
  child.kill('SIGKILL');
  await waitForProcessClose(child, 1_500);
}

export interface ServerSharingOptions {
  readonly battlyTransport?: {
    readonly serverAddr: string;
    readonly serverPort: number;
    readonly caFile?: string;
  };
  readonly fetchImplementation?: typeof fetch;
  readonly frpcPath: string;
  readonly frpcSha256: string;
  readonly frpcUrl: string;
  readonly oidcAudience?: string;
  readonly oidcClientSecret: string;
  readonly prepareFrpc?: () => Promise<void>;
  readonly spawnTunnel?: SpawnTunnel;
  readonly sharingApiUrl?: string;
  readonly temporaryRoot: string;
  readonly tunnelApiUrl?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function requiredString(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > maximum ||
    /[\r\n\0]/.test(value)
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value.trim();
}

function integer(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65_535) {
    throw new TypeError(`Invalid ${label}`);
  }
  return number;
}

function httpsUrl(value: unknown, label: string): string {
  const parsed = new URL(requiredString(value, label, 2_048));
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== '127.0.0.1' &&
    parsed.hostname !== 'localhost'
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
  return parsed.href.replace(/\/$/, '');
}

function parseTunnelConfiguration(value: unknown, apiUrl: string): TunnelConfiguration {
  const source = record(value, 'tunnel response');
  const status = own(source, 'status');
  if (status !== 'success' && status !== 'exists') {
    throw new Error('Tunnel provider rejected the request');
  }
  const publicAddress = requiredString(
    own(source, 'publicAddress') ?? own(source, 'hostname') ?? own(source, 'serverName'),
    'public tunnel address',
    255,
  );
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(publicAddress)) {
    throw new TypeError('Invalid public tunnel address');
  }
  const transportHost = requiredString(own(source, 'frps_domain'), 'FRP server domain', 255);
  return {
    frpsDomain:
      transportHost.toLowerCase().replace(/\.$/, '') === 'root.battly.org'
        ? 'frp.battly.org'
        : transportHost,
    frpsPort: integer(own(source, 'frps_port'), 'FRP server port'),
    publicAddress,
    remotePort: integer(own(source, 'remote_port'), 'FRP remote port'),
    subdomain: requiredString(own(source, 'subdomain'), 'FRP subdomain', 128),
    tokenEndpoint: httpsUrl(
      own(source, 'tokenEndpoint') ?? `${apiUrl}/token`,
      'OIDC token endpoint',
    ),
  };
}

async function boundedJson(response: Response, label: string): Promise<unknown> {
  const text = await readBoundedResponse(
    response,
    maximumJsonBytes,
    `${label} response is too large`,
  );
  if (!response.ok) {
    let serverDetail = '';
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const source = parsed as Record<string, unknown>;
        const detail = own(source, 'error') ?? own(source, 'message');
        if (typeof detail === 'string' && detail.length <= 512 && !/[\r\n\0]/.test(detail)) {
          serverDetail = `: ${detail}`;
        }
      }
    } catch {
      // The status code remains useful when the server returned HTML or an empty response.
    }
    throw new Error(`${label} failed (${response.status})${serverDetail}`);
  }
  return JSON.parse(text) as unknown;
}

function tunnelSnapshot(
  status: ServerTunnelSnapshot['status'],
  values: Partial<Omit<ServerTunnelSnapshot, 'status'>> = {},
): ServerTunnelSnapshot {
  return {
    message: values.message ?? null,
    publicAddress: values.publicAddress ?? null,
    startedAt: values.startedAt ?? null,
    ...(values.publicHost !== undefined ? { publicHost: values.publicHost } : {}),
    ...(values.remotePort !== undefined ? { remotePort: values.remotePort } : {}),
    status,
  };
}

export class ServerSharingService {
  readonly #battlyTransport: ServerSharingOptions['battlyTransport'];
  readonly #configurationQueue = new Map<string, Promise<void>>();
  readonly #fetch: typeof fetch;
  readonly #frpcPath: string;
  readonly #frpcSha256: string;
  readonly #frpcUrl: string;
  readonly #oidcAudience: string;
  readonly #oidcClientSecret: string;
  readonly #prepareFrpc: () => Promise<void>;
  readonly #spawn: SpawnTunnel;
  readonly #store: ServerStore;
  readonly #sharingApiUrl: string;
  readonly #temporaryRoot: string;
  readonly #tunnelApiUrl: string;
  readonly #usesConfiguredTunnelApi: boolean;
  readonly #tunnels = new Map<string, TunnelState>();
  readonly #writes = new Map<string, Promise<void>>();

  constructor(store: ServerStore, options: ServerSharingOptions) {
    this.#battlyTransport = options.battlyTransport;
    if (this.#battlyTransport) {
      requiredString(this.#battlyTransport.serverAddr, 'Battly Tunnel host', 255);
      if (/[\s/\\]/.test(this.#battlyTransport.serverAddr)) {
        throw new TypeError('Invalid Battly Tunnel host');
      }
      integer(this.#battlyTransport.serverPort, 'Battly Tunnel port');
      if (this.#battlyTransport.caFile && !isAbsolute(this.#battlyTransport.caFile)) {
        throw new TypeError('CA path must be absolute');
      }
    }
    if (!isAbsolute(options.frpcPath) || !isAbsolute(options.temporaryRoot)) {
      throw new TypeError('Server sharing paths must be absolute');
    }
    if (!/^[a-f0-9]{64}$/i.test(options.frpcSha256)) {
      throw new TypeError('Invalid frpc SHA-256');
    }
    this.#store = store;
    this.#sharingApiUrl = httpsUrl(
      options.sharingApiUrl ?? 'https://api.battlylauncher.com',
      'sharing API URL',
    );
    this.#usesConfiguredTunnelApi = Boolean(options.tunnelApiUrl);
    this.#tunnelApiUrl = httpsUrl(
      options.tunnelApiUrl ?? 'https://root.battly.org',
      'tunnel API URL',
    );
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#frpcPath = resolve(options.frpcPath);
    this.#frpcUrl = httpsUrl(options.frpcUrl, 'frpc download URL');
    this.#frpcSha256 = options.frpcSha256.toLowerCase();
    this.#oidcClientSecret = requiredString(options.oidcClientSecret, 'OIDC client secret', 1024);
    this.#prepareFrpc = options.prepareFrpc ?? (() => this.#ensureFrpc());
    this.#oidcAudience = requiredString(options.oidcAudience ?? 'frp-client', 'OIDC audience', 128);
    this.#spawn = options.spawnTunnel ?? spawn;
    this.#temporaryRoot = resolve(options.temporaryRoot);
  }

  async snapshot(idValue: unknown, token: string): Promise<ServerSharingSnapshot> {
    const id = normalizeServerId(idValue);
    const [permissions, friends] = await Promise.all([
      this.#permissions(id),
      this.#friends(token).catch(() => []),
    ]);
    return {
      friends,
      permissions,
      tunnel: this.#tunnels.get(id)?.snapshot ?? tunnelSnapshot('inactive'),
    };
  }

  async invite(
    idValue: unknown,
    draftValue: unknown,
    token: string,
  ): Promise<ServerSharingSnapshot> {
    const id = normalizeServerId(idValue);
    const draft = normalizeServerInviteDraft(draftValue);
    const server = await this.#server(id);
    const tunnel = this.#tunnels.get(id)?.snapshot;
    if (tunnel?.status !== 'active' || !tunnel.publicAddress) {
      throw new Error('Activa el túnel antes de invitar a un amigo');
    }
    const response = await this.#fetch(`${this.#sharingApiUrl}/api/v2/servers/invitar-amigo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        friendUsername: draft.username,
        region: 'latam',
        role: draft.role,
        serverName: tunnel.publicAddress,
        serverVersion: server.version,
        subdomain: server.domain,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    const result = record(await boundedJson(response, 'Server invitation'), 'invitation response');
    if (typeof own(result, 'error') === 'string') {
      throw new Error(String(own(result, 'error')));
    }
    await this.#grant(id, draft);
    return this.snapshot(id, token);
  }

  async revoke(
    idValue: unknown,
    usernameValue: unknown,
    token: string,
  ): Promise<ServerSharingSnapshot> {
    const id = normalizeServerId(idValue);
    const draft = normalizeServerInviteDraft({ username: usernameValue, role: 'viewer' });
    await this.#writePermissions(
      id,
      (await this.#permissions(id)).filter(
        (entry) => entry.username.toLowerCase() !== draft.username.toLowerCase(),
      ),
    );
    return this.snapshot(id, token);
  }

  async assertProviderDomain(idValue: unknown): Promise<void> {
    // Injected providers are used by isolated integrations with their own contract.
    if (this.#usesConfiguredTunnelApi) {
      return;
    }
    await this.#server(normalizeServerId(idValue));
    const api = this.#serverTunnelApi();
    const regions = await boundedJson(
      await this.#fetch(`${api}/regions`, { signal: AbortSignal.timeout(20_000) }),
      'Battly Servers regions',
    );
    if (!Array.isArray(regions)) {
      throw new Error('Invalid Battly Servers region catalog');
    }
    const region = regions.find(
      (value: unknown) =>
        value &&
        typeof value === 'object' &&
        own(value as Record<string, unknown>, 'id') === 'latam',
    ) as Record<string, unknown> | undefined;
    const domain = region && own(region, 'public_dns_domain');
    if (domain !== 'battlyservers.net') {
      throw new Error(
        'La API de Battly Servers no está configurada para battlyservers.net. Actualiza el servicio de esta región antes de iniciar el servidor.',
      );
    }
  }

  async startTunnel(idValue: unknown, token: string): Promise<ServerSharingSnapshot> {
    const id = normalizeServerId(idValue);
    const existing = this.#tunnels.get(id);
    if (
      existing &&
      (existing.process ||
        (existing.snapshot.status !== 'inactive' && existing.snapshot.status !== 'error'))
    ) {
      throw new Error('Tunnel is already active');
    }
    const state: TunnelState = {
      process: null,
      snapshot: tunnelSnapshot('starting'),
      temporaryConfig: null,
    };
    this.#tunnels.set(id, state);
    try {
      await this.assertProviderDomain(id);
      const server = await this.#server(id);
      const tunnelApiUrl = this.#serverTunnelApi();
      // Always resolve this server, never resume another server returned by /welcome.
      const configuration = parseTunnelConfiguration(
        await this.#postTunnel(tunnelApiUrl, '/create-tunnel', {
          serverId: this.#usesConfiguredTunnelApi
            ? id
            : await this.#ensureRemoteServer(server, token, tunnelApiUrl),
          token,
        }),
        tunnelApiUrl,
      );
      const expectedAddress = `${server.domain}.battlyservers.net`;
      if (configuration.publicAddress.split(':')[0].toLowerCase() !== expectedAddress) {
        throw new Error('El proveedor todavía no ha asignado el dominio ' + expectedAddress);
      }
      if (this.#battlyTransport && configuration.subdomain !== server.domain) {
        throw new Error('El proveedor ha devuelto un nombre de túnel distinto al servidor');
      }
      await this.#prepareFrpc();
      if (this.#tunnels.get(id) !== state) {
        throw new Error('Inicio del túnel cancelado');
      }
      await mkdir(this.#temporaryRoot, { recursive: true });
      const temporaryConfig = join(this.#temporaryRoot, `frpc-${id}-${randomUUID()}.json`);
      await writeFileAtomically(
        temporaryConfig,
        this.#frpcConfiguration(configuration, token, server.port),
      );
      if (process.platform !== 'win32') {
        await chmod(temporaryConfig, 0o600);
      }
      state.temporaryConfig = temporaryConfig;
      if (this.#tunnels.get(id) !== state) {
        throw new Error('Inicio del túnel cancelado');
      }
      const child = this.#spawn(this.#frpcPath, ['-c', temporaryConfig], {
        cwd: this.#temporaryRoot,
        windowsHide: true,
        shell: false,
        stdio: 'pipe',
      });
      state.process = child;
      const componentName = this.#battlyTransport ? 'Battly Tunnel' : 'frpc';
      let confirmedPublicHost: string | undefined;
      await new Promise<void>((resolvePromise, reject) => {
        let output = '';
        let settled = false;
        const details = (): string =>
          output
            .replaceAll(String.fromCharCode(27), '')
            .replace(/\[[0-9;]*m/g, '')
            .replaceAll(token, '[cuenta]')
            .replaceAll(this.#oidcClientSecret, '[secreto]')
            .replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]')
            .slice(-1800)
            .trim();
        const failure = (reason: string): Error => {
          if (
            /cannot fetch token|couldn.t generate OIDC token/i.test(output) &&
            /client_secret|invalid_client/i.test(output)
          ) {
            return new Error(
              'La API de Battly Servers ha rechazado la clave de autenticación del túnel. Revisa CLIENT_SECRET en el servidor: debe coincidir con Battly y estar entre comillas en el .env si contiene #. Reinicia la API después de corregirlo.',
            );
          }
          return new Error(`${reason}. ${details()}`);
        };
        const finish = (error?: Error): void => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timeout);
          child.stdout?.off('data', onData);
          child.stderr?.off('data', onData);
          child.off('error', onError);
          child.off('close', onClose);
          if (error) {
            reject(error);
          } else {
            resolvePromise();
          }
        };
        const onError = (error: Error): void =>
          finish(failure(`No se pudo iniciar ${componentName}: ${error.message}`));
        const onClose = (code: number | null): void =>
          finish(
            failure(
              `${componentName} se cerró antes de conectar el servidor (código ${code ?? 'desconocido'})`,
            ),
          );
        const onData = (chunk: Buffer): void => {
          output = (output + chunk.toString('utf8')).slice(-8192);
          if (this.#battlyTransport) {
            for (const line of output.split(/\r?\n/).slice(0, -1)) {
              try {
                const event: unknown = JSON.parse(line);
                const entry = record(event, 'tunnel event');
                if (own(entry, 'event') === 'ready') {
                  if (
                    own(entry, 'remotePort') !== configuration.remotePort ||
                    own(entry, 'tunnelName') !== configuration.subdomain
                  ) {
                    finish(
                      new Error('Battly Tunnel confirmó un puerto o túnel distinto al autorizado'),
                    );
                  } else {
                    confirmedPublicHost = requiredString(
                      own(entry, 'publicHost'),
                      'public TCP host',
                      253,
                    );
                    finish();
                  }
                }
              } catch {
                /* Partial or unrelated diagnostic line. */
              }
            }
          } else if (/start proxy success/i.test(output)) {
            finish();
          } else if (
            /login to (?:the )?server failed|start error|start proxy error/i.test(output)
          ) {
            finish(
              failure(
                `No se pudo conectar a ${configuration.frpsDomain}:${configuration.frpsPort}. Comprueba que frps esté accesible y que su DNS no use el proxy de Cloudflare`,
              ),
            );
          }
        };
        const timeout = setTimeout(
          () => finish(failure(`${componentName} no confirmó la conexión en 20 segundos`)),
          20000,
        );
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.once('error', onError);
        child.once('close', onClose);
      });
      if (this.#tunnels.get(id) !== state) {
        throw new Error('Inicio del túnel cancelado');
      }
      state.snapshot = tunnelSnapshot('active', {
        publicAddress: configuration.publicAddress,
        startedAt: new Date().toISOString(),
        ...(this.#battlyTransport
          ? { publicHost: confirmedPublicHost, remotePort: configuration.remotePort }
          : {}),
      });
      // Continue draining both pipes after the handshake; otherwise a busy frpc can block.
      let recentOutput = '';
      const monitor = (chunk: Buffer): void => {
        if (state.process !== child) {
          return;
        }
        recentOutput = (recentOutput + chunk.toString('utf8')).slice(-4096);
        const lines = recentOutput.split(/\r?\n/);
        recentOutput = lines.pop() ?? '';
        for (const line of lines) {
          if (this.#battlyTransport) {
            try {
              const event = record(JSON.parse(line) as unknown, 'tunnel event');
              if (
                own(event, 'event') === 'ready' &&
                own(event, 'remotePort') === configuration.remotePort &&
                own(event, 'tunnelName') === configuration.subdomain
              ) {
                state.snapshot = tunnelSnapshot('active', {
                  publicAddress: configuration.publicAddress,
                  startedAt: new Date().toISOString(),
                  publicHost: requiredString(own(event, 'publicHost'), 'public TCP host', 253),
                  remotePort: configuration.remotePort,
                });
              } else if (own(event, 'event') === 'reconnecting') {
                state.snapshot = tunnelSnapshot('error', {
                  message: 'Se perdió la conexión pública. Battly Tunnel intentará recuperarla.',
                });
              }
            } catch {
              /* Ignore non-event diagnostics. */
            }
            continue;
          }
          if (/start proxy success/i.test(line)) {
            state.snapshot = tunnelSnapshot('active', {
              publicAddress: configuration.publicAddress,
              startedAt: new Date().toISOString(),
            });
          } else if (
            /login to (?:the )?server failed|connection closed|reconnect to server|start proxy error/i.test(
              line,
            )
          ) {
            state.snapshot = tunnelSnapshot('error', {
              message: 'Se perdió la conexión pública. frpc intentará recuperarla.',
            });
          }
        }
      };
      child.stdout?.on('data', monitor);
      child.stderr?.on('data', monitor);
      child.on('error', () => {
        if (state.process === child) {
          state.snapshot = tunnelSnapshot('error', {
            message: `Error del proceso ${componentName}`,
          });
        }
      });
      child.once('close', (code) => {
        if (state.process !== child) {
          return;
        }
        state.process = null;
        state.snapshot = tunnelSnapshot(code === 0 ? 'inactive' : 'error', {
          message: code === 0 ? null : `El túnel terminó con código ${code ?? 'desconocido'}`,
        });
        void this.#removeTemporaryConfig(state);
      });
      return this.snapshot(id, token);
    } catch (error) {
      if (state.process) {
        await terminateProcess(state.process);
      }
      state.process = null;
      state.snapshot = tunnelSnapshot('error', {
        message: error instanceof Error ? error.message : 'No se pudo iniciar el túnel',
      });
      await this.#removeTemporaryConfig(state);
      throw error;
    }
  }

  #serverTunnelApi(): string {
    if (this.#usesConfiguredTunnelApi) {
      return this.#tunnelApiUrl;
    }
    // Europe is disabled, including for servers saved with an old EU region.
    return this.#tunnelApiUrl;
  }

  async #postTunnel(apiUrl: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.#fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(path === '/create-server' ? 60_000 : 20_000),
      });
      return boundedJson(response, `Battly Servers ${path}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error desconocido';
      throw new Error(`Battly Servers ${path}: ${detail}`, { cause: error });
    }
  }

  async #ensureRemoteServer(server: ServerSummary, token: string, apiUrl: string): Promise<string> {
    const remoteSubdomain = `${server.domain}.battlyservers.net`;
    const remoteServers = await this.#postTunnel(apiUrl, '/servers', { token });
    const candidates: readonly unknown[] = Array.isArray(remoteServers)
      ? (remoteServers as readonly unknown[])
      : [];
    const existing = candidates.find((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
      }
      const entry = value as Record<string, unknown>;
      const subdomain = own(entry, 'subdomain');
      return (
        own(entry, 'hostname') === remoteSubdomain ||
        own(entry, 'publicAddress') === remoteSubdomain ||
        subdomain === remoteSubdomain
      );
    });
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      return requiredString(
        own(existing as Record<string, unknown>, '_id'),
        'remote server id',
        128,
      );
    }

    const availability = record(
      await this.#postTunnel(apiUrl, '/check-if-available', {
        subdomain: remoteSubdomain,
        token,
      }),
      'domain availability response',
    );
    if (own(availability, 'available') !== true) {
      const message = own(availability, 'error');
      throw new Error(typeof message === 'string' ? message : 'El subdominio no está disponible');
    }
    const created = record(
      await this.#postTunnel(apiUrl, '/create-server', {
        subdomain: remoteSubdomain,
        token,
        version: server.version,
      }),
      'remote server response',
    );
    if (own(created, 'status') !== 'success') {
      const message = own(created, 'error');
      throw new Error(typeof message === 'string' ? message : 'No se pudo registrar el servidor');
    }
    return requiredString(own(created, '_id'), 'remote server id', 128);
  }

  uploadConfigurations(idValue: unknown, token: string, onlyFile?: string): Promise<void> {
    const id = normalizeServerId(idValue);
    const previous = this.#configurationQueue.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.#uploadConfigurations(id, token, onlyFile));
    this.#configurationQueue.set(id, next);
    const cleanup = (): void => {
      if (this.#configurationQueue.get(id) === next) {
        this.#configurationQueue.delete(id);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }

  async #uploadConfigurations(id: string, token: string, onlyFile?: string): Promise<void> {
    const server = await this.#server(id);
    const api = this.#serverTunnelApi();
    const remote = await this.#postTunnel(api, '/servers', { token });
    const address = `${server.domain}.battlyservers.net`;
    const entry = Array.isArray(remote)
      ? (remote.find((item: unknown) => {
          if (!item || typeof item !== 'object') {
            return false;
          }
          const value = item as Record<string, unknown>;
          return (
            own(value, 'hostname') === address ||
            own(value, 'publicAddress') === address ||
            own(value, 'subdomain') === address
          );
        }) as Record<string, unknown> | undefined)
      : undefined;
    // A server has no remote configuration until its domain is registered at first start.
    if (!entry) {
      return;
    }
    const serverId = requiredString(own(entry, '_id'), 'remote server id', 128);
    const auth = record(
      await this.#postTunnel(api, '/get-server-authtoken', { token, serverId }),
      'configuration authorization',
    );
    const authToken = requiredString(own(auth, 'authToken'), 'configuration token', 256);
    const directory = await this.#store.directoryPathInternal(id);
    const files = [
      'server.properties',
      'ops.json',
      'whitelist.json',
      'banned-players.json',
      'banned-ips.json',
      'usercache.json',
    ];
    for (const filename of files) {
      if (onlyFile && filename !== onlyFile) {
        continue;
      }
      const path = join(directory, filename);
      if (!(await pathExists(path))) {
        continue;
      }
      const content = await readBoundedRegularFile(
        path,
        filename === 'server.properties' ? 100 * 1024 : 512 * 1024,
      );
      await this.#postTunnel(api, '/upload-config', {
        authToken,
        serverId,
        filename,
        contentBase64: content.toString('base64'),
      });
    }
  }

  async deleteRemoteServer(idValue: unknown, token: string): Promise<void> {
    const id = normalizeServerId(idValue);
    // Finish pending uploads before deleting their remote objects.
    await this.#configurationQueue.get(id)?.catch(() => undefined);
    const server = await this.#server(id);
    const api = this.#serverTunnelApi();
    const entries = await this.#postTunnel(api, '/servers', { token });
    if (!Array.isArray(entries)) {
      throw new Error('No se pudo comprobar el servidor remoto. No se ha borrado la copia local.');
    }
    const address = `${server.domain}.battlyservers.net`;
    const entry: unknown = entries.find((value: unknown) => {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const item = value as Record<string, unknown>;
      return [own(item, 'subdomain'), own(item, 'hostname'), own(item, 'publicAddress')].includes(
        address,
      );
    });
    if (!entry) {
      return;
    }
    const serverId = requiredString(
      own(record(entry, 'remote server'), '_id'),
      'remote server id',
      128,
    );
    const result = record(
      await this.#postTunnel(api, '/delete-server', { token, serverId }),
      'delete response',
    );
    if (own(result, 'status') !== 'success') {
      throw new Error('No se pudo eliminar el servidor remoto. Reintenta el borrado.');
    }
  }

  async stopTunnel(idValue: unknown, token?: string): Promise<ServerSharingSnapshot> {
    const id = normalizeServerId(idValue);
    const state = this.#tunnels.get(id);
    this.#tunnels.delete(id);
    const temporaryConfig = state?.temporaryConfig ?? null;
    if (state?.process) {
      await terminateProcess(state.process);
    }
    if (state) {
      state.process = null;
      state.snapshot = tunnelSnapshot('inactive');
      await this.#removeTemporaryConfig(state);
      if (temporaryConfig) {
        await rm(temporaryConfig, { force: true });
      }
    }
    return {
      friends: token ? await this.#friends(token).catch(() => []) : [],
      permissions: await this.#permissions(id),
      tunnel: tunnelSnapshot('inactive'),
    };
  }

  dispose(): void {
    for (const state of this.#tunnels.values()) {
      if (state.process && !state.process.killed) {
        state.process.kill('SIGTERM');
      }
      void this.#removeTemporaryConfig(state);
    }
    this.#tunnels.clear();
  }

  async #friends(token: string): Promise<readonly ServerShareFriend[]> {
    const response = await this.#fetch(`${this.#sharingApiUrl}/api/v2/users/obtenerAmigos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    const body = record(await boundedJson(response, 'Friends'), 'friends response');
    if (typeof own(body, 'error') === 'string') {
      throw new Error(String(own(body, 'error')));
    }
    const friends = own(body, 'amigos');
    if (!Array.isArray(friends)) {
      return [];
    }
    return friends.slice(0, 500).flatMap((value): ServerShareFriend[] => {
      try {
        const friend = record(value, 'friend');
        const username = requiredString(own(friend, 'username'), 'friend username', 16);
        if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
          return [];
        }
        const rawStatus = own(friend, 'estado');
        const status = rawStatus === 'ingame' || rawStatus === 'online' ? rawStatus : 'offline';
        if (status === 'offline') {
          return [];
        }
        return [{ status, username }];
      } catch {
        return [];
      }
    });
  }

  async #grant(id: string, draft: ServerInviteDraft): Promise<void> {
    const current = await this.#permissions(id);
    const next = current.filter(
      (entry) => entry.username.toLowerCase() !== draft.username.toLowerCase(),
    );
    next.push({ role: draft.role, updatedAt: new Date().toISOString(), username: draft.username });
    await this.#writePermissions(id, next);
  }

  async #permissions(id: string): Promise<ServerPermissionGrant[]> {
    await this.#writes.get(id);
    const path = join(await this.#store.directoryPathInternal(id), 'sharing.json');
    if (!(await pathExists(path))) {
      return [];
    }
    const parsed = JSON.parse(
      (await readBoundedRegularFile(path, maximumJsonBytes)).toString('utf8'),
    ) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.slice(0, 500).flatMap((value): ServerPermissionGrant[] => {
      try {
        const source = record(value, 'permission');
        const draft = normalizeServerInviteDraft(source);
        const updatedAt = requiredString(own(source, 'updatedAt'), 'permission date', 64);
        if (Number.isNaN(Date.parse(updatedAt))) {
          return [];
        }
        return [{ ...draft, updatedAt }];
      } catch {
        return [];
      }
    });
  }

  #writePermissions(id: string, permissions: readonly ServerPermissionGrant[]): Promise<void> {
    const previous = this.#writes.get(id) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const path = join(await this.#store.directoryPathInternal(id), 'sharing.json');
      await writeFileAtomically(path, `${JSON.stringify(permissions, null, 2)}\n`);
    });
    this.#writes.set(
      id,
      operation.catch(() => undefined),
    );
    return operation;
  }

  async #server(id: string): Promise<ServerSummary> {
    const server = (await this.#store.list()).find((entry) => entry.id === id);
    if (!server) {
      throw new Error('Server metadata is unavailable');
    }
    return server;
  }

  async #ensureFrpc(): Promise<void> {
    if (await pathExists(this.#frpcPath)) {
      const info = await lstat(this.#frpcPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TypeError('Invalid frpc executable');
      }
      const existing = await readBoundedRegularFile(this.#frpcPath, maximumFrpcBytes);
      if (createHash('sha256').update(existing).digest('hex') === this.#frpcSha256) {
        return;
      }
      throw new Error('Installed frpc checksum does not match');
    }
    const response = await this.#fetch(this.#frpcUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`frpc download failed (${response.status})`);
    }
    const bytes = await readBoundedResponseBytes(
      response,
      maximumFrpcBytes,
      'FRP download is too large',
    );
    if (!bytes.byteLength || bytes.byteLength > maximumFrpcBytes) {
      throw new Error('Invalid frpc size');
    }
    if (createHash('sha256').update(bytes).digest('hex') !== this.#frpcSha256) {
      throw new Error('Downloaded frpc checksum does not match');
    }
    await mkdir(dirname(this.#frpcPath), { recursive: true });
    const file = await open(this.#frpcPath, 'wx', 0o700);
    try {
      await file.writeFile(bytes);
    } finally {
      await file.close();
    }
    if (process.platform !== 'win32') {
      await chmod(this.#frpcPath, 0o700);
    }
  }

  #frpcConfiguration(configuration: TunnelConfiguration, token: string, localPort: number): string {
    if (this.#battlyTransport) {
      return JSON.stringify(
        {
          serverAddr: this.#battlyTransport.serverAddr,
          serverPort: this.#battlyTransport.serverPort,
          caFile: this.#battlyTransport.caFile,
          token,
          proxies: [
            {
              name: configuration.subdomain,
              type: 'tcp',
              localIP: '127.0.0.1',
              localPort,
              remotePort: configuration.remotePort,
            },
          ],
        },
        null,
        2,
      );
    }
    const values = [
      configuration.frpsDomain,
      configuration.subdomain,
      token,
      this.#oidcClientSecret,
      this.#oidcAudience,
    ];
    if (values.some((value) => /[\r\n\0]/.test(value))) {
      throw new TypeError('Unsafe tunnel configuration');
    }
    return JSON.stringify(
      {
        serverAddr: configuration.frpsDomain,
        serverPort: configuration.frpsPort,
        loginFailExit: true,
        log: { to: 'console', level: 'info', disablePrintColor: true },
        transport: { tls: { enable: true } },
        auth: {
          method: 'oidc',
          oidc: {
            clientID: token,
            clientSecret: this.#oidcClientSecret,
            audience: this.#oidcAudience,
            tokenEndpointURL: configuration.tokenEndpoint,
          },
        },
        proxies: [
          {
            name: configuration.subdomain,
            type: 'tcp',
            localIP: '127.0.0.1',
            localPort,
            remotePort: configuration.remotePort,
            transport: { useEncryption: false, useCompression: false },
          },
        ],
      },
      null,
      2,
    );
  }

  async #removeTemporaryConfig(state: TunnelState): Promise<void> {
    const path = state.temporaryConfig;
    state.temporaryConfig = null;
    if (path) {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }
}
