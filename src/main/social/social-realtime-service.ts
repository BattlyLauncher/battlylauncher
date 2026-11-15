import {
  parseMinecraftServerAddress,
  minecraftServerAddress,
} from '../../shared/minecraft/server-address';
import {
  normalizeServerInvitation,
  type ServerInvitation,
} from '../../shared/servers/server-contract';
import { io } from 'socket.io-client';
import { app } from 'electron';
import { formatPresenceServer } from '../../shared/social/presence-format';

import type { SocialRealtimeState } from '../../shared/social/social-contract';
import {
  defaultPrivacySettings,
  type PrivacySettings,
} from '../../shared/settings/settings-contract';

interface SocialSocket {
  readonly connected?: boolean;
  connect(): void;
  disconnect(): void;
  emit(event: string, payload: unknown): void;
  on(event: string, listener: (...arguments_: unknown[]) => void): SocialSocket;
}

type SocialSocketFactory = (url: string, token: string) => SocialSocket;
type RemoteCommand =
  | 'get_versions'
  | 'launch'
  | 'ping'
  | 'log_dump'
  | 'get_config'
  | 'set_config'
  | 'operation'
  | 'subscribe'
  | 'ls'
  | 'mkdir'
  | 'rm'
  | 'read-file'
  | 'write-file'
  | 'stop-minecraft'
  | 'kill';
type RemoteCommandExecutor = (
  command: Exclude<RemoteCommand, 'ping'>,
  arguments_: Record<string, unknown>,
) => Promise<unknown>;

const defaultFactory: SocialSocketFactory = (url, token) =>
  io(url, {
    autoConnect: false,
    auth: { token, client: 'battly-launcher', version: app.getVersion() },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
    transports: ['polling', 'websocket'],
    tryAllTransports: true,
  });

export class SocialRealtimeService {
  #lastVisibility = '';
  readonly #factory: SocialSocketFactory;
  #socket: SocialSocket | undefined;
  #privacy: PrivacySettings = defaultPrivacySettings;
  #playingServer: string | null = null;
  #remoteExecutor: RemoteCommandExecutor | undefined;
  #remoteWatchers = new Set<string>();
  #remoteToken = '';
  #remoteUrl = '';
  #supportSessions = new Map<string, number>();
  #supportApprovals = new Map<string, Promise<boolean>>();
  #supportRevision = 0;
  publishRemote(value: unknown): void {
    if (!this.#socket) {
      return;
    }
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || text.length > 65536) {
      return;
    }
    for (const replyTo of this.#remoteWatchers) {
      if ((this.#supportSessions.get(replyTo) ?? 0) <= Date.now()) {
        this.#remoteWatchers.delete(replyTo);
        continue;
      }
      this.#socket.emit('remote:event', { replyTo, data: value });
    }
  }

  constructor(
    factory: SocialSocketFactory = defaultFactory,
    private readonly notificationContext?: () => Promise<Record<string, unknown>>,
    private readonly approveSupport: () => Promise<boolean> = () => Promise.resolve(false),
  ) {
    this.#factory = factory;
  }

  refreshNotifications(context: Record<string, unknown>): void {
    this.#socket?.emit('notifications:sync', context);
  }

  start(
    url: string,
    token: string,
    changed: () => void,
    stateChanged: (state: SocialRealtimeState) => void,
    shareStatus = true,
    remoteExecutor?: RemoteCommandExecutor,
    serverInvited?: (invitation: ServerInvitation) => void,
    notified?: (payload: unknown) => void,
    friendRequested?: () => void,
    themeApplied?: (payload: unknown) => void,
  ): void {
    if (this.#socket && this.#remoteToken === token && this.#remoteUrl === url) {
      this.#remoteExecutor = remoteExecutor;
      if (this.#privacy.presenceShareStatus !== shareStatus) {
        this.updateVisibility(shareStatus);
      }
      return;
    }
    const playingServer =
      this.#remoteToken && this.#remoteToken !== token ? null : this.#playingServer;
    this.stop();
    this.#playingServer = playingServer;
    this.#remoteUrl = url;
    this.#remoteToken = token;
    this.#privacy = { ...this.#privacy, presenceShareStatus: shareStatus };
    this.#remoteExecutor = remoteExecutor;
    const socket = this.#factory(url, token);
    socket.on('applyTheme', (payload) => {
      if (this.#socket === socket) {
        themeApplied?.(payload);
      }
    });
    socket.on('notificacion', (payload) => {
      if (this.#socket === socket) {
        notified?.(payload);
      }
    });
    socket.on('notifications:sync', (payload) => {
      if (this.#socket === socket && Array.isArray(payload) && payload.length <= 100) {
        payload.forEach((item) => notified?.(item));
      }
    });
    socket.on('solicitudAmistad', () => {
      if (this.#socket === socket) {
        friendRequested?.();
      }
    });
    for (const event of ['solicitudAmistad', 'notificacion', 'presence:update']) {
      socket.on(event, () => {
        if (this.#socket === socket) {
          changed();
        }
      });
    }
    socket.on('server-invite-v3', (value) => {
      if (this.#socket !== socket) {
        return;
      }
      try {
        serverInvited?.(normalizeServerInvitation(value));
      } catch {
        /* Ignore malformed remote payloads. */
      }
    });
    socket.on('connect', () => {
      if (this.#socket === socket) {
        this.#lastVisibility = '';
        socket.emit('session-handshake-v3', {});
        if (this.notificationContext) {
          void this.notificationContext()
            .then((context) => {
              if (this.#socket === socket) {
                socket.emit('notifications:sync', context);
              }
            })
            .catch(() => {
              if (this.#socket === socket) {
                socket.emit('notifications:sync', {});
              }
            });
        } else {
          socket.emit('notifications:sync', {});
        }
        stateChanged('connected');
        this.#emitVisibility(socket);
      }
    });
    socket.on('disconnect', () => {
      if (this.#socket === socket) {
        this.#lastVisibility = '';
        this.#supportSessions.clear();
        this.#supportRevision += 1;
        this.#supportApprovals.clear();
        this.#remoteWatchers.clear();
        stateChanged('reconnecting');
      }
    });
    socket.on('connect_error', () => {
      if (this.#socket === socket) {
        stateChanged('error');
      }
    });
    socket.on('remote:command', (payload) => {
      if (this.#socket === socket) {
        void this.#handleRemoteCommand(socket, payload);
      }
    });
    this.#socket = socket;
    stateChanged('connecting');
    socket.connect();
  }

  updateVisibility(shareStatus: boolean): void {
    this.#privacy = { ...this.#privacy, presenceShareStatus: shareStatus };
    if (this.#socket) {
      this.#emitVisibility(this.#socket);
    }
  }

  updatePrivacy(privacy: PrivacySettings): void {
    this.#privacy = privacy;
    if (this.#socket) {
      this.#emitVisibility(this.#socket);
    }
  }

  updatePlayingServer(server: string | null): void {
    const parsed = typeof server === 'string' ? parseMinecraftServerAddress(server) : null;
    this.#playingServer = parsed ? minecraftServerAddress(parsed) : null;
    if (this.#socket) {
      this.#emitVisibility(this.#socket);
    }
  }

  stop(stateChanged?: (state: SocialRealtimeState) => void): void {
    this.#remoteToken = '';
    this.#remoteUrl = '';
    this.#playingServer = null;
    this.#remoteWatchers.clear();
    this.#supportSessions.clear();
    this.#supportRevision += 1;
    this.#supportApprovals.clear();
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.disconnect();
    stateChanged?.('disconnected');
  }

  #emitVisibility(socket: SocialSocket): void {
    if (this.#socket !== socket || socket.connected === false) {
      return;
    }
    const payload = {
      status: this.#privacy.presenceShareStatus ? 'online' : 'offline',
      privacy: {
        sharePresence: this.#privacy.presenceShareStatus,
        shareServer: this.#privacy.presenceShareStatus && this.#privacy.presenceShareServer,
      },
      server:
        this.#privacy.presenceShareStatus && this.#privacy.presenceShareServer
          ? this.#playingServer === null
            ? null
            : formatPresenceServer(this.#playingServer)
          : null,
    };
    const signature = JSON.stringify(payload);
    if (signature === this.#lastVisibility) {
      return;
    }
    this.#lastVisibility = signature;
    socket.emit('updateStatus-v3', payload);
  }

  async #handleRemoteCommand(socket: SocialSocket, value: unknown): Promise<void> {
    const source =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const own = (key: string): unknown =>
      Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
    const commandValue = own('command');
    const command: RemoteCommand | null = [
      'ping',
      'get_versions',
      'launch',
      'log_dump',
      'get_config',
      'set_config',
      'operation',
      'subscribe',
      'ls',
      'mkdir',
      'rm',
      'read-file',
      'write-file',
      'stop-minecraft',
      'kill',
    ].includes(String(commandValue))
      ? (commandValue as RemoteCommand)
      : null;
    const requestId =
      typeof own('requestId') === 'string' && String(own('requestId')).length <= 128
        ? (own('requestId') as string)
        : null;
    const replyTo =
      typeof own('replyTo') === 'string' && String(own('replyTo')).length <= 128
        ? (own('replyTo') as string)
        : null;
    const argumentsValue = own('args');
    const arguments_: Record<string, unknown> =
      Array.isArray(argumentsValue) && command === 'launch'
        ? { instanceId: argumentsValue[0] }
        : argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)
          ? (argumentsValue as Record<string, unknown>)
          : {};
    const respond = (data: unknown, error: string | null): void => {
      if (this.#socket !== socket) {
        return;
      }
      const response = { requestId, replyTo, data, error };
      try {
        if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 250_000) {
          socket.emit('remote:response', {
            requestId,
            replyTo,
            data: null,
            error: 'response_too_large',
          });
          return;
        }
        socket.emit('remote:response', response);
      } catch {
        socket.emit('remote:response', {
          requestId,
          replyTo,
          data: null,
          error: 'invalid_remote_response',
        });
      }
    };
    if (!command || !requestId) {
      respond(null, 'invalid_remote_command');
      return;
    }
    if (!replyTo) {
      respond(null, 'invalid_controller');
      return;
    }
    if ((this.#supportSessions.get(replyTo) ?? 0) <= Date.now()) {
      const revision = this.#supportRevision;
      let approval = this.#supportApprovals.get(replyTo);
      if (!approval) {
        approval = Promise.resolve()
          .then(() => this.approveSupport())
          .catch(() => false);
        this.#supportApprovals.set(replyTo, approval);
      }
      const approved = await approval;
      // Disconnecting or changing account invalidates a pending approval too.
      if (this.#socket !== socket || this.#supportRevision !== revision) {
        return;
      }
      if (this.#supportApprovals.get(replyTo) === approval) {
        this.#supportApprovals.delete(replyTo);
      }
      if (!approved) {
        respond(null, 'support_not_authorized');
        return;
      }
      this.#supportSessions.set(replyTo, Date.now() + 10 * 60_000);
    }
    if (command === 'ping') {
      respond({ message: 'Pong' }, null);
      return;
    }
    if (command === 'subscribe') {
      if (!replyTo) {
        respond(null, 'invalid_controller');
        return;
      }
      if (arguments_.enabled === false) {
        this.#remoteWatchers.delete(replyTo);
      } else if (this.#remoteWatchers.has(replyTo) || this.#remoteWatchers.size < 8) {
        this.#remoteWatchers.add(replyTo);
      } else {
        respond(null, 'too_many_remote_watchers');
        return;
      }
      respond({ subscribed: arguments_.enabled !== false }, null);
      return;
    }
    if (!this.#remoteExecutor) {
      respond(null, 'remote_command_unavailable');
      return;
    }
    try {
      respond(await this.#remoteExecutor(command, arguments_), null);
    } catch (error) {
      let message = error instanceof Error ? error.message.slice(0, 1000) : 'remote_command_failed';
      if (this.#remoteToken) {
        message = message.replaceAll(this.#remoteToken, '[redacted]');
      }
      message = message
        .replace(
          /\b(access[_-]?token|client[_-]?token|password|authorization)\s*[=:]\s*[^\s,;]+/gi,
          '$1=[redacted]',
        )
        .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
      respond(null, message);
    }
  }
}
