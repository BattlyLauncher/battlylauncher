import { readBoundedResponse } from '../network/read-bounded-response';
import { worldsVersionId } from '../../shared/social/worlds-version';
import { connect as connectTcp } from 'node:net';
import {
  defaultWorldsPreferences,
  type WorldsPreferences,
} from '../../shared/settings/game-preferences';
import { lstat, mkdir } from 'node:fs/promises';
import { invitationDates } from '../../shared/social/invitation-retention';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { WorldsRoomChannel } from './worlds-room-channel';
import type { WorldsEvent, WorldsPublicRoom } from '../../shared/social/battly-worlds-contract';
import { io, type Socket } from 'socket.io-client';
import type {
  WorldsAction,
  WorldsInvite,
  WorldsSnapshot,
} from '../../shared/social/battly-worlds-contract';
import type { TerracottaRuntime } from './terracotta-runtime';

interface Identity {
  readonly token: string;
  readonly username: string;
}
const API = 'https://api.battlylauncher.com';
const inviteHistoryLimit = 1000;
const initial = (): WorldsSnapshot => ({
  state: 'idle',
  serviceReady: false,
  username: '',
  code: '',
  address: '',
  version: '',
  message: '',
  members: [],
  invites: [],
  inviteError: '',
  isPublic: false,
  roomTitle: '',
  participants: [],
});
const string = (value: unknown, max = 128): string =>
  typeof value === 'string' ? value.slice(0, max) : '';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const errors = [
  'No se pudo contactar con el anfitrión. Comprueba que sigue en la sala y prueba de nuevo.',
  'El anfitrión ha cerrado la conexión.',
  'El componente de red se ha detenido. Vuelve a unirte a la sala.',
  'El componente de red se ha detenido. Crea la sala de nuevo.',
  'Minecraft ha cerrado el mundo compartido. Vuelve a abrirlo en LAN.',
  'La sala no responde con el protocolo esperado. Actualiza Battly en ambos dispositivos.',
];

export class BattlyWorldsService {
  #snapshot = initial();
  #identity: Identity | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #timer: NodeJS.Timeout | undefined;
  #room: WorldsRoomChannel | undefined;
  #inviteSocket: Socket | undefined;
  #inviteTimer: NodeJS.Timeout | undefined;
  #seenInvites = new Set<string>();
  #inviteHistory = new Map<string, number>();
  #invitesInitialized = false;
  #receipts = new Set<string>();
  #listeners = new Set<(event: WorldsEvent) => void>();
  #publicHeartbeat = 0;
  #moderationCheckedAt = 0;
  #voiceRestriction = '';
  #host = false;
  #lastInvites = 0;
  #lastHeartbeat = 0;
  #started = 0;
  #nodes: { expires: number; values: string[] } | undefined;
  #durationHours = 6;
  #preferences = { ...defaultWorldsPreferences };

  configure(preferences: WorldsPreferences): void {
    this.#preferences = preferences;
  }
  async diagnostics(test = false): Promise<string> {
    const nodes = await this.#getNodes();
    const node = nodes.find((value) => /^(tcp|ws|wss):/.test(value));
    const lines = [
      `Estado de sala: ${this.#snapshot.state}`,
      `Nodo disponible: ${node ?? 'No disponible'}`,
    ];
    if (test && node) {
      const url = new URL(node),
        started = Date.now();
      try {
        await new Promise<void>((resolve, reject) => {
          const socket = connectTcp({
            host: url.hostname,
            port: Number(url.port) || (url.protocol === 'wss:' ? 443 : 80),
          });
          socket.setTimeout(5000);
          socket.once('connect', () => {
            socket.destroy();
            resolve();
          });
          socket.once('error', () => {
            socket.destroy();
            reject(new Error('El nodo no responde por TCP. Comprueba la conexión o el firewall.'));
          });
          socket.once('timeout', () => {
            socket.destroy();
            reject(new Error('Tiempo de conexión agotado.'));
          });
        });
        lines.push(
          `Conexión TCP: ${Date.now() - started} ms. Esta prueba no verifica una partida entre jugadores.`,
        );
      } catch (error) {
        lines.push(`Conexión TCP: ${error instanceof Error ? error.message : 'Error'}`);
      }
    }
    lines.push(await this.runtime.diagnostics());
    return lines.join('\n');
  }

  constructor(
    private readonly runtime: TerracottaRuntime,
    private readonly inviteDirectory?: string,
  ) {}

  subscribe(listener: (event: WorldsEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  publish(event: WorldsEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
  current(): WorldsSnapshot {
    return this.#snapshot;
  }
  prepareVoice(): void {
    if (!this.#room) {
      throw new Error('Espera a que la sala termine de conectarse');
    }
    if (this.#voiceRestriction) {
      throw new Error(this.#voiceRestriction);
    }
    this.#room.ensureVoice();
  }
  voiceSignal(to: unknown, signal: unknown): void {
    if (!this.#room) {
      throw new Error('No hay una sala activa');
    }
    this.#room.send(to, signal);
  }
  voiceState(connected: boolean, muted: boolean): void {
    this.#room?.state(connected, muted);
  }
  async voiceParty(action: string, value: unknown): Promise<void> {
    if (!this.#room) {
      throw new Error('No hay una sala activa');
    }
    await this.#room.party(action, value);
  }
  publicRooms(identity: Identity, page: number): Promise<WorldsPublicRoom[]> {
    return this.#serial(async () => {
      await this.#bind(identity);
      const data = await this.#api(`/rooms/public?page=${page}&pageSize=24`);
      if (!Array.isArray(data.rooms)) {
        throw new Error('No se pudieron leer las salas públicas');
      }
      return data.rooms
        .slice(0, 24)
        .map((raw) => {
          const r = object(raw);
          return {
            code: string(r.code).toUpperCase(),
            title: string(r.title, 80),
            hostUsername: string(r.hostUsername || r.hostPlayer, 64),
            version: string(r.version, 96),
            premium: r.premium === true,
            maxGuests:
              Number.isSafeInteger(r.maxGuests) && Number(r.maxGuests) > 0
                ? Number(r.maxGuests)
                : null,
            playerCount: Math.max(0, Number(r.playerCount ?? r.playersCount) || 1),
          };
        })
        .filter((room) => /^[A-Z0-9]{6}$/.test(room.code));
    });
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    this.#queue = next.catch(() => undefined);
    void next.then(
      () => this.publish({ type: 'snapshot', snapshot: this.#snapshot }),
      () => this.publish({ type: 'snapshot', snapshot: this.#snapshot }),
    );
    return next;
  }

  snapshot(identity: Identity): Promise<WorldsSnapshot> {
    return this.#serial(async () => {
      await this.#bind(identity);
      await this.#refreshInvites();
      return this.#snapshot;
    });
  }

  discordSecret(identity: Identity, code: string): Promise<string> {
    return this.#serial(async () => {
      await this.#bind(identity);
      if (!['hosting', 'joined'].includes(this.#snapshot.state) || this.#snapshot.code !== code) {
        return '';
      }
      const result = await this.#api(`/discord/rooms/${code}/presence`, {});
      return typeof result.secret === 'string' && /^[a-f0-9]{64}$/.test(result.secret)
        ? result.secret
        : '';
    });
  }
  discordRequest(identity: Identity, userId: string): Promise<boolean> {
    return this.#serial(async () => {
      await this.#bind(identity);
      if (!['hosting', 'joined'].includes(this.#snapshot.state) || !/^\d{17,20}$/.test(userId)) {
        return false;
      }
      const result = await this.#api(`/discord/rooms/${this.#snapshot.code}/request`, {
        discordID: userId,
      });
      return result.allowed === true;
    });
  }

  act(identity: Identity, action: WorldsAction): Promise<WorldsSnapshot> {
    return this.#serial(async () => {
      await this.#bind(identity);
      if (action.type === 'report') {
        const result = await this.#api('/reports', {
          roomCode: action.roomCode,
          targetUserId: action.targetUserId,
          category: action.category,
          description: action.description,
          platform: 'desktop',
        });
        this.#snapshot = {
          ...this.#snapshot,
          message: 'Reporte enviado. Referencia: ' + string(result.id, 128),
        };
        return this.#snapshot;
      }
      if (action.type === 'discord-join') {
        const resolved = await this.#api(`/discord/join/${action.secret}`);
        const code = string(resolved.code);
        if (!/^[A-Z0-9]{6}$/.test(code)) {
          throw new Error('La sala ya no existe o su código ha caducado');
        }
        action = { type: 'join', code };
      }
      if (action.type === 'visibility') {
        if (action.isPublic && !this.#preferences.allowPublicListing) {
          throw new Error('Activa Permitir lista pública en Ajustes > Launcher > Battly Worlds.');
        }
        if (!this.#host || this.#snapshot.state !== 'hosting') {
          throw new Error('Crea una sala y abre el mundo en LAN antes de publicarlo');
        }
        await this.#api(
          `/rooms/${this.#snapshot.code}/visibility`,
          { isPublic: action.isPublic, title: action.title },
          'PATCH',
        );
        this.#snapshot = { ...this.#snapshot, isPublic: action.isPublic, roomTitle: action.title };
        this.#publicHeartbeat = 0;
        return this.#snapshot;
      }
      if (action.type === 'leave') {
        await this.#leave();
        return this.#snapshot;
      }
      if (action.type === 'dismiss') {
        const inviteId = action.inviteId;
        const invite = this.#snapshot.invites.find((item) => item.inviteId === inviteId);
        if (!invite) {
          throw new Error('La invitación ya no está disponible');
        }
        await this.#api(`/invites/${encodeURIComponent(invite.inviteId)}/received`, {});
        this.#snapshot = {
          ...this.#snapshot,
          invites: this.#snapshot.invites.filter((item) => item !== invite),
        };
        await this.#persistInvites();
        return this.#snapshot;
      }
      if (action.type === 'invite') {
        if (!['hosting', 'joined'].includes(this.#snapshot.state) || !this.#snapshot.code) {
          throw new Error(
            'Espera a que la sala esté conectada. Si eres anfitrión, abre primero el mundo en LAN',
          );
        }
        await this.#api('/invite', {
          friendUsername: action.username,
          code: this.#snapshot.code,
          version: worldsVersionId(this.#snapshot.version),
          hostPlayer: identity.username,
        });
        return this.#snapshot;
      }
      if (!['idle', 'error'].includes(this.#snapshot.state)) {
        throw new Error('Sal de la sala actual antes de abrir otra');
      }
      await this.#leave();
      this.#snapshot = {
        ...this.#snapshot,
        state: 'starting',
        version: action.type === 'host' ? worldsVersionId(action.version) : '',
      };
      this.#started = Date.now();
      try {
        const nodes = await this.#getNodes();
        if (action.type === 'host') {
          const response = await this.#api('/entitlements');
          const entitlements = object(response.entitlements);
          const hours = Number(entitlements.roomDurationHours);
          this.#durationHours = Math.min(
            this.#preferences.durationHours,
            Number.isFinite(hours) && hours > 0 ? Math.min(hours, 720) : 6,
          );
          this.#host = true;
          this.#snapshot = { ...this.#snapshot, serviceReady: true };
          this.publish({ type: 'snapshot', snapshot: this.#snapshot });
          await this.runtime.connect('host', identity.username, nodes);
          this.#snapshot = { ...this.#snapshot, state: 'scanning' };
        } else {
          const room = await this.#api(`/rooms/${action.code}`, undefined, undefined, 5);
          const fullCode = string(room.fullCode, 4096);
          if (!fullCode || fullCode.length < 8) {
            throw new Error('La sala ha caducado o su código no es válido');
          }
          this.#snapshot = { ...this.#snapshot, serviceReady: true };
          this.publish({ type: 'snapshot', snapshot: this.#snapshot });
          await this.runtime.connect('guest', identity.username, nodes, fullCode);
          this.#snapshot = {
            ...this.#snapshot,
            state: 'connecting',
            code: action.code,
            version: string(room.version, 96),
          };
        }
        this.#schedule();
        return this.#snapshot;
      } catch (error) {
        await this.runtime.stop();
        this.#snapshot = { ...this.#snapshot, state: 'error', message: this.#message(error) };
        return this.#snapshot;
      }
    });
  }

  leaveRoom(): Promise<void> {
    return this.#serial(() => this.#leave());
  }

  stop(): Promise<void> {
    return this.#serial(async () => {
      await this.#leave();
      this.#inviteSocket?.disconnect();
      this.#inviteSocket = undefined;
      if (this.#inviteTimer) {
        clearInterval(this.#inviteTimer);
      }
      this.#inviteTimer = undefined;
      this.#seenInvites.clear();
      this.#inviteHistory.clear();
      this.#invitesInitialized = false;
      this.#identity = undefined;
      this.#snapshot = initial();
      this.#lastInvites = 0;
      this.#lastHeartbeat = 0;
    });
  }

  async #bind(identity: Identity): Promise<void> {
    if (
      this.#identity?.token !== identity.token ||
      this.#identity?.username !== identity.username
    ) {
      await this.#leave();
      this.#inviteSocket?.disconnect();
      if (this.#inviteTimer) {
        clearInterval(this.#inviteTimer);
      }
      this.#seenInvites.clear();
      this.#inviteHistory.clear();
      this.#invitesInitialized = false;
      this.#snapshot = { ...initial(), username: identity.username };
      this.#identity = identity;
      this.#receipts.clear();
      await this.#restoreInvites();
      const socket = (this.#inviteSocket = io(API, {
        auth: { token: identity.token, client: 'battly-desktop', version: '3.1.0' },
        reconnectionDelayMax: 10000,
        timeout: 12000,
      }));
      socket.on('battlyworlds_invite', (raw: unknown) => {
        if (socket === this.#inviteSocket) {
          this.#receiveInvite(raw);
        }
      });
      this.#inviteTimer = setInterval(() => {
        void this.#serial(async () => {
          if (this.#identity?.token === identity.token) {
            await this.#refreshInvites();
          }
        }).catch(() => {
          /* Retry background refresh on the next tick if local storage is unavailable. */
        });
      }, 15000);
      this.#inviteTimer.unref();
      this.#lastInvites = 0;
      this.#lastHeartbeat = 0;
    }
    this.#identity = identity;
  }

  async #leave(): Promise<void> {
    this.#voiceRestriction = '';
    this.#moderationCheckedAt = 0;
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = undefined;
    this.#room?.stop();
    this.#room = undefined;
    const code = this.#host ? this.#snapshot.code : '';
    this.#host = false;
    await this.runtime.stop();
    let message = '';
    if (code && this.#identity) {
      try {
        await this.#api(`/rooms/${code}/close`, {});
      } catch {
        message =
          'La conexión local está cerrada, pero no se pudo cerrar el registro de la sala en Battly. Caducará automáticamente.';
      }
    }
    this.#snapshot = {
      ...this.#snapshot,
      state: 'idle',
      serviceReady: false,
      code: '',
      address: '',
      version: '',
      message,
      members: [],
      participants: [],
      isPublic: false,
      roomTitle: '',
    };
    if (code) {
      this.publish({ type: 'closed', code, message: 'La sala se ha cerrado.' });
    }
  }

  #schedule(): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#serial(() => this.#poll());
    }, 1200);
    this.#timer.unref();
  }

  async #poll(): Promise<void> {
    if (['idle', 'error'].includes(this.#snapshot.state)) {
      return;
    }
    let closedCode = '';
    try {
      if (Date.now() - this.#moderationCheckedAt > 15000) {
        this.#moderationCheckedAt = Date.now();
        const result = await this.#api('/moderation/me').catch(() => null);
        if (result) {
          const restrictions = Array.isArray(result.restrictions) ? result.restrictions : [];
          this.#voiceRestriction = '';
          for (const restriction of restrictions) {
            await this.#applyRestriction(object(restriction));
          }
          if (['idle', 'error'].includes(this.#snapshot.state)) {
            return;
          }
        }
      }
      const status = await this.runtime.request('/state/');
      if (status.state === 'exception') {
        const type = Number(status.type);
        if (type === 1 && !this.#host) {
          closedCode = this.#snapshot.code;
        }
        const fallback = errors[type] || 'Se ha perdido la conexión con la sala';
        throw new Error(await this.runtime.connectionFailure(type, fallback).catch(() => fallback));
      }
      if (status.state === 'waiting') {
        if (!this.#host) {
          closedCode = this.#snapshot.code;
        }
        throw new Error('La conexión de BattlyWorlds se ha cerrado');
      }
      if (this.#host && this.#snapshot.code && status.state !== 'host-ok') {
        throw new Error('La conexión de BattlyWorlds se ha cerrado');
      }
      if (status.state === 'host-ok' && !this.#snapshot.code) {
        const fullCode = string(status.room, 4096);
        if (!fullCode) {
          throw new Error('Terracotta no ha generado un código de sala');
        }
        const result = await this.#api('/rooms', {
          fullCode,
          version: worldsVersionId(this.#snapshot.version),
          hostPlayer: this.#identity?.username,
          persistent: true,
          durationHours: this.#durationHours,
        });
        const code = string(result.shortCode).toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) {
          throw new Error('Battly no ha devuelto un código de sala válido');
        }
        this.#snapshot = {
          ...this.#snapshot,
          state: 'hosting',
          code,
          maxGuests: Number(result.maxGuests) || 3,
        };
        if (this.#preferences.defaultPublic && this.#preferences.allowPublicListing) {
          const title = `Mundo de ${this.#identity?.username ?? 'Battly'}`;
          await this.#api(`/rooms/${code}/visibility`, { isPublic: true, title }, 'PATCH');
          this.#snapshot = { ...this.#snapshot, isPublic: true, roomTitle: title };
        }
        this.#connectRoom();
      } else if (status.state === 'guest-ok') {
        const rawAddress = string(status.url, 32);
        const address = rawAddress === '127.0.0.1' ? '127.0.0.1:25565' : rawAddress;
        if (!/^127\.0\.0\.1(?::\d{1,5})?$/.test(address)) {
          throw new Error('Dirección de conexión local no válida');
        }
        this.#snapshot = { ...this.#snapshot, state: 'joined', address };
        if (!this.#room) {
          this.#snapshot = {
            ...this.#snapshot,
            invites: this.#snapshot.invites.filter((invite) => invite.code !== this.#snapshot.code),
          };
          await this.#persistInvites().catch(() => undefined);
          this.#connectRoom();
        }
      } else if (status.state === 'host-starting') {
        if (this.#snapshot.state === 'scanning') {
          this.#started = Date.now();
        }
        this.#snapshot = { ...this.#snapshot, state: 'connecting' };
      }
      if (
        ['connecting', 'starting'].includes(this.#snapshot.state) &&
        Date.now() - this.#started > 120000
      ) {
        throw new Error(
          'No se pudo conectar en dos minutos. Comprueba la conexión y que el anfitrión mantiene el mundo abierto en LAN.',
        );
      }
      if (
        this.#host &&
        status.state === 'host-ok' &&
        this.#snapshot.code &&
        Date.now() - this.#publicHeartbeat > 15000
      ) {
        this.#publicHeartbeat = Date.now();
        await this.#api(`/rooms/${this.#snapshot.code}/heartbeat`, {}).catch(() => {
          this.#snapshot = {
            ...this.#snapshot,
            message: 'No se pudo mantener la sala en el listado público. Reintentando…',
          };
        });
      }
      this.#schedule();
    } catch (error) {
      const message = this.#message(error);
      const { version } = this.#snapshot;
      await this.#leave();
      if (closedCode) {
        this.publish({
          type: 'closed',
          code: closedCode,
          message: 'El anfitrión ha cerrado la sala. Te has desconectado del mundo.',
        });
      }
      this.#snapshot = { ...this.#snapshot, state: 'error', version, message };
      this.publish({ type: 'snapshot', snapshot: this.#snapshot });
    }
  }

  async #applyRestriction(value: Record<string, unknown>): Promise<void> {
    const scopes = Array.isArray(value.scopes) ? value.scopes : [];
    const reason = string(value.reason, 1000);
    if (!reason) {
      return;
    }
    const message =
      'Restricción de Battly Worlds: ' +
      reason +
      (typeof value.expiresAt === 'string' ? ' · ' + value.expiresAt : '');
    if (scopes.includes('voice')) {
      this.#voiceRestriction = message;
      this.#room?.state(false, true);
      this.publish({ type: 'voice', event: { type: 'lost', message } });
    }
    if (scopes.includes('worlds') || scopes.includes(this.#host ? 'host' : 'join')) {
      await this.#leave();
      this.#snapshot = { ...this.#snapshot, state: 'error', message };
      this.publish({ type: 'snapshot', snapshot: this.#snapshot });
    } else {
      this.#snapshot = { ...this.#snapshot, message };
      this.publish({ type: 'snapshot', snapshot: this.#snapshot });
    }
  }

  #connectRoom(): void {
    if (!this.#identity) {
      return;
    }
    const code = this.#snapshot.code;
    this.#room = new WorldsRoomChannel(
      this.#identity,
      this.#snapshot.code,
      (event) => this.publish(event),
      (participants) => {
        this.#snapshot = {
          ...this.#snapshot,
          participants,
          members: participants.map((m) => m.username),
        };
        this.publish({ type: 'snapshot', snapshot: this.#snapshot });
      },
      () => {
        void this.#serial(async () => {
          if (this.#snapshot.code !== code) {
            return;
          }
          const wasHost = this.#host;
          await this.#leave();
          if (!wasHost) {
            this.publish({
              type: 'closed',
              code,
              message: 'El anfitrión ha cerrado la sala. Te has desconectado del mundo.',
            });
          }
        });
      },
      (value) => {
        void this.#serial(() => this.#applyRestriction(value));
      },
    );
  }

  #receiveInvite(raw: unknown): void {
    const item = object(raw),
      code = string(item.code).toUpperCase(),
      inviteId = string(item.inviteId);
    if (!/^[A-Z0-9]{6}$/.test(code) || !/^[\w-]{1,128}$/.test(inviteId)) {
      return;
    }
    const invite: WorldsInvite = {
      code,
      inviteId,
      fromUsername: string(item.fromUsername || item.from, 64),
      version: string(item.version, 96),
      ...invitationDates(item, this.#inviteHistory.get(inviteId) ?? Date.now()),
    };
    this.#inviteHistory.set(inviteId, invite.createdAt!);
    if (this.#inviteHistory.size > inviteHistoryLimit) {
      const oldest = this.#inviteHistory.keys().next().value!;
      this.#inviteHistory.delete(oldest);
      this.#seenInvites.delete(oldest);
      this.#receipts.delete(oldest);
    }
    if (invite.expiresAt! <= Date.now()) {
      this.#confirmReceipt(inviteId);
      return;
    }
    if (!this.#snapshot.invites.some((i) => i.inviteId === inviteId)) {
      this.#snapshot = {
        ...this.#snapshot,
        invites: [invite, ...this.#snapshot.invites].slice(0, 100),
      };
    }
    this.#confirmReceipt(inviteId);
    if (this.#seenInvites.has(inviteId)) {
      return;
    }
    this.#seenInvites.add(inviteId);
    if (this.#invitesInitialized && this.#preferences.invitations) {
      this.publish({ type: 'invite', invite });
    }
    this.publish({ type: 'snapshot', snapshot: this.#snapshot });
  }

  #invitePath(): string | undefined {
    if (!this.inviteDirectory || !this.#identity) {
      return;
    }
    return join(
      this.inviteDirectory,
      createHash('sha256').update(this.#identity.username.toLowerCase()).digest('hex') + '.json',
    );
  }
  async #restoreInvites(): Promise<void> {
    const path = this.#invitePath();
    if (!path) {
      return;
    }
    try {
      const raw = (await readBoundedRegularFile(path, 262144)).toString('utf8');
      if (raw.length > 262144) {
        return;
      }
      const data = object(JSON.parse(raw));
      if (!Array.isArray(data.invites)) {
        return;
      }
      const invites: WorldsInvite[] = [];
      const legacyCreatedAt = Math.min((await lstat(path)).mtimeMs, Date.now());
      if (Array.isArray(data.history)) {
        for (const pair of data.history.slice(-inviteHistoryLimit)) {
          if (
            Array.isArray(pair) &&
            typeof pair[0] === 'string' &&
            /^[\w-]{1,128}$/.test(pair[0]) &&
            typeof pair[1] === 'number' &&
            Number.isFinite(pair[1]) &&
            pair[1] > Date.now() - 30 * 86400000 &&
            pair[1] <= Date.now()
          ) {
            this.#inviteHistory.set(pair[0], pair[1]);
          }
        }
      }
      for (const raw of data.invites.slice(0, 100)) {
        const value = object(raw),
          code = string(value.code),
          inviteId = string(value.inviteId);
        if (/^[A-Z0-9]{6}$/.test(code) && /^[\w-]{1,128}$/.test(inviteId)) {
          const dates = invitationDates(
            value,
            this.#inviteHistory.get(inviteId) ?? legacyCreatedAt,
          );
          this.#inviteHistory.set(inviteId, dates.createdAt);
          if (dates.expiresAt <= Date.now()) {
            continue;
          }
          invites.push({
            code,
            inviteId,
            fromUsername: string(value.fromUsername, 64),
            version: string(value.version, 96),
            ...dates,
          });
        }
      }
      this.#snapshot = { ...this.#snapshot, invites };
      this.#seenInvites = new Set(invites.map((invite) => invite.inviteId));
      await this.#persistInvites();
    } catch {
      /* First launch, or a damaged cache: pending invitations remain on the server. */
    }
  }
  async #persistInvites(): Promise<void> {
    const path = this.#invitePath();
    if (!path) {
      return;
    }
    await mkdir(this.inviteDirectory!, { recursive: true });
    this.#inviteHistory = new Map(
      [...this.#inviteHistory]
        .filter(([, createdAt]) => createdAt > Date.now() - 30 * 86400000)
        .slice(-inviteHistoryLimit),
    );
    this.#seenInvites = new Set([...this.#seenInvites].filter((id) => this.#inviteHistory.has(id)));
    this.#receipts = new Set([...this.#receipts].filter((id) => this.#inviteHistory.has(id)));
    await writeFileAtomically(
      path,
      JSON.stringify({ invites: this.#snapshot.invites, history: [...this.#inviteHistory] }),
    );
  }
  #confirmReceipt(inviteId: string): void {
    if (!this.inviteDirectory || this.#receipts.has(inviteId)) {
      return;
    }
    this.#receipts.add(inviteId);
    const identity = this.#identity;
    void this.#serial(async () => {
      if (
        this.#identity?.token !== identity?.token ||
        this.#identity?.username !== identity?.username
      ) {
        this.#receipts.delete(inviteId);
        return;
      }
      try {
        // Save before acknowledging so a launcher restart cannot lose the invitation.
        await this.#persistInvites();
        await this.#api(`/invites/${encodeURIComponent(inviteId)}/received`, {});
      } catch {
        this.#receipts.delete(inviteId);
      }
    });
  }

  async #refreshInvites(): Promise<void> {
    const active = this.#snapshot.invites.filter((invite) => (invite.expiresAt ?? 0) > Date.now());
    if (active.length !== this.#snapshot.invites.length) {
      this.#snapshot = { ...this.#snapshot, invites: active };
      await this.#persistInvites();
    }
    if (Date.now() - this.#lastInvites < 15000) {
      return;
    }
    this.#lastInvites = Date.now();
    try {
      const data = await this.#api('/invites/pending');
      if (!Array.isArray(data.invites)) {
        throw new Error('No se pudieron leer las invitaciones');
      }
      for (const value of data.invites.slice(0, 100)) {
        this.#receiveInvite(value);
      }
      this.#invitesInitialized = true;
      this.#snapshot = { ...this.#snapshot, inviteError: '' };
    } catch (error) {
      this.#snapshot = { ...this.#snapshot, inviteError: this.#message(error) };
    }
    if (Date.now() - this.#lastHeartbeat > 60000) {
      this.#lastHeartbeat = Date.now();
      await this.#api('/heartbeat', { platform: 'windows', clientVersion: 'desktop' }).catch(
        () => undefined,
      );
    }
  }

  async #api(
    path: string,
    body?: Record<string, unknown>,
    method?: 'PATCH',
    registrationRetries = 0,
  ): Promise<Record<string, unknown>> {
    if (!this.#identity) {
      throw new Error('Selecciona una cuenta de Battly para jugar con amigos');
    }
    let response: Response;
    try {
      response = await fetch(`${API}/api/v2/battlyworlds${path}`, {
        method: method || (body ? 'POST' : 'GET'),
        headers: {
          Authorization: `Bearer ${this.#identity.token}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new Error(
        'No se pudo contactar con BattlyWorlds. Comprueba tu conexión y vuelve a intentarlo',
      );
    }
    const text = await readBoundedResponse(
      response,
      1048576,
      'La respuesta de BattlyWorlds es demasiado grande',
    );
    let data: Record<string, unknown>;
    try {
      data = object(JSON.parse(text));
    } catch {
      throw new Error('BattlyWorlds no ha devuelto una respuesta válida');
    }
    const status = Number(data.status || response.status);
    if (!response.ok || status >= 400) {
      if (response.status === 401 || status === 401) {
        throw new Error('Tu sesión de Battly ha caducado. Inicia sesión de nuevo');
      }
      if (data.code === 'BATTLYWORLDS_INVITE_LIMIT') {
        throw new Error('Has alcanzado el límite de invitaciones de tu cuenta para esta sala');
      }
      if (response.status === 404 || status === 404) {
        // The host's socket registration can arrive after the room-creation response.
        if (registrationRetries > 0 && !body && !method) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return this.#api(path, body, method, registrationRetries - 1);
        }
        throw new Error('La sala ya no existe o su código ha caducado');
      }
      throw new Error(
        string(data.message, 240) || 'Battly no ha podido completar la operación de sala',
      );
    }
    return data;
  }

  async #getNodes(): Promise<string[]> {
    if (this.#nodes && this.#nodes.expires > Date.now()) {
      return this.#nodes.values;
    }
    try {
      const response = await fetch(
        `${API}/battlylauncher/battlyworlds/nodes?platform=${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform}`,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) {
        throw new Error('Nodes unavailable');
      }
      const data: unknown = JSON.parse(
        await readBoundedResponse(response, 64 * 1024, 'BattlyWorlds nodes response is too large'),
      );
      if (!Array.isArray(data)) {
        throw new Error('Invalid nodes');
      }
      const values = data
        .slice(0, 32)
        .map((item) => string(object(item).url, 255))
        .filter((value) => {
          try {
            const url = new URL(value);
            return (
              ['tcp:', 'udp:', 'ws:', 'wss:', 'quic:'].includes(url.protocol) &&
              url.hostname.endsWith('.battlylauncher.com') &&
              !url.username &&
              !url.password
            );
          } catch {
            return false;
          }
        });
      if (!values.length) {
        throw new Error('Empty nodes');
      }
      this.#nodes = { expires: Date.now() + 3600000, values };
      return values;
    } catch {
      return [
        'tcp://node-us-1.battlylauncher.com:11010',
        'udp://node-us-1.battlylauncher.com:11010',
        'ws://node-us-1.battlylauncher.com:11011',
      ];
    }
  }

  #message(error: unknown): string {
    if (
      error instanceof Error &&
      /fetch failed|ECONN|ENOTFOUND|abort|timeout/i.test(error.message)
    ) {
      return 'Se ha interrumpido la conexión de BattlyWorlds. Comprueba tu red y vuelve a intentarlo.';
    }
    return error instanceof Error
      ? error.message.slice(0, 300)
      : 'No se pudo completar la conexión';
  }
}
