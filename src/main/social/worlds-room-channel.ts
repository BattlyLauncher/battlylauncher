import { io, type Socket } from 'socket.io-client';
import type {
  WorldsEvent,
  WorldsIceServer,
  WorldsMember,
  WorldsVoiceEvent,
} from '../../shared/social/battly-worlds-contract';

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max = 128): string => (typeof v === 'string' && v.length <= max ? v : '');
function member(value: unknown): WorldsMember | null {
  const v = record(value),
    userId = text(v.userId),
    username = text(v.username, 64);
  return userId && username
    ? {
        userId,
        username,
        muted: v.muted === true,
        voiceConnected: v.voiceConnected === true,
        voiceChannel: text(v.voiceChannel) || 'room',
      }
    : null;
}
export class WorldsRoomChannel {
  #socket: Socket;
  #members = new Map<string, WorldsMember>();
  #authenticated = false;
  #attempt = 0;
  #authRetry: ReturnType<typeof setTimeout> | undefined;
  #ready: Extract<WorldsVoiceEvent, { type: 'ready' }> | undefined;
  constructor(
    identity: { token: string; username: string },
    code: string,
    private readonly publish: (event: WorldsEvent) => void,
    private readonly changed: (members: WorldsMember[]) => void,
    private readonly closed: () => void = () => {},
    private readonly restricted: (value: Record<string, unknown>) => void = () => {},
  ) {
    const socket = (this.#socket = io('https://api.battlylauncher.com/battlyworlds', {
      autoConnect: false,
      reconnectionDelayMax: 10000,
      // The public gateway currently times out WebSocket handshakes. Keep the
      // working polling connection instead of attempting an upgrade mid-call.
      transports: ['polling', 'websocket'],
      upgrade: false,
      tryAllTransports: true,
      timeout: 10000,
    }));
    socket.on('worlds_restricted', (value) => this.restricted(record(value)));
    socket.on('connect', () => {
      clearTimeout(this.#authRetry);
      const attempt = ++this.#attempt;
      this.#authenticated = false;
      socket
        .timeout(10000)
        .emit(
          'authenticate_room',
          { token: identity.token, username: identity.username, roomCode: code },
          (error: Error | null, raw: unknown) => {
            if (!socket.connected || attempt !== this.#attempt) {
              return;
            }
            const data = record(raw),
              userId = text(data.userId);
            if (error || data.ok !== true || !userId) {
              // A closed room may have expired while this socket was offline.
              if (!error && data.error === 'unauthorized') {
                this.stop();
                this.closed();
                return;
              }
              if (error || data.error === 'internal_error') {
                this.publish({ type: 'voice', event: { type: 'lost' } });
                this.#authRetry = setTimeout(() => {
                  if (attempt !== this.#attempt) {
                    return;
                  }
                  socket.disconnect();
                  socket.connect();
                }, 3000);
                return;
              }
              this.publish({
                type: 'voice',
                event: {
                  type: 'lost',
                  message:
                    'No se pudo autorizar la voz en esta sala. Pulsa Activar voz para reintentar.',
                },
              });
              return;
            }
            this.#authenticated = true;
            const iceServers: WorldsIceServer[] = [];
            if (Array.isArray(data.iceServers)) {
              for (const rawServer of data.iceServers.slice(0, 16)) {
                const server = record(rawServer);
                const urls = (
                  Array.isArray(server.urls) ? server.urls : [server.urls ?? server.url]
                )
                  .filter(
                    (u): u is string =>
                      typeof u === 'string' && /^(?:stun|stuns|turn|turns):[^\s]{1,500}$/.test(u),
                  )
                  .slice(0, 8);
                if (urls.length) {
                  iceServers.push({
                    urls,
                    username: text(server.username, 512),
                    credential: text(server.credential, 2048),
                  });
                }
              }
            }
            if (!iceServers.length) {
              iceServers.push({ urls: ['stun:stun.l.google.com:19302'] });
            }
            this.#ready = {
              type: 'ready',
              roomCode: code,
              userId,
              channel: text(data.voiceChannel) || 'room',
              iceServers,
            };
            this.publish({ type: 'voice', event: this.#ready });
            this.#update();
          },
        );
    });
    socket.on('room_closed', (raw: unknown) => {
      if (record(raw).roomCode !== code) {
        return;
      }
      this.stop();
      this.closed();
    });
    socket.on('room_members', (raw: unknown) => {
      const values = record(raw).members;
      if (!Array.isArray(values)) {
        return;
      }
      this.#members.clear();
      for (const v of values.slice(0, 128)) {
        const m = member(v);
        if (m) {
          this.#members.set(m.userId, m);
        }
      }
      this.#update();
    });
    socket.on('member_joined', (raw: unknown) => {
      const m = member(record(raw).member);
      if (!m || this.#members.size >= 128) {
        return;
      }
      const existed = this.#members.has(m.userId);
      this.#members.set(m.userId, m);
      this.#update();
      if (!existed && m.username !== identity.username) {
        this.publish({ type: 'presence', username: m.username, joined: true });
      }
    });
    socket.on('member_left', (raw: unknown) => {
      const id = text(record(raw).userId),
        m = this.#members.get(id);
      this.#members.delete(id);
      this.#update();
      if (m && m.username !== identity.username) {
        this.publish({ type: 'presence', username: m.username, joined: false });
      }
    });
    socket.on('voice_state', (raw: unknown) => {
      const v = record(raw),
        m = this.#members.get(text(v.userId));
      if (m) {
        m.muted = v.muted === true;
        m.voiceConnected = v.connected === true;
        m.voiceChannel = text(v.voiceChannel) || m.voiceChannel;
        this.#update();
      }
    });
    socket.on('voice_signal', (raw: unknown) => {
      const v = record(raw),
        from = text(v.from);
      if (!this.#members.has(from)) {
        return;
      }
      const signal = normalizeWorldsSignal(v.signal);
      if (signal) {
        this.publish({ type: 'voice', event: { type: 'signal', from, signal } });
      }
    });
    socket.on('voice_channel_changed', (raw: unknown) =>
      this.publish({
        type: 'voice',
        event: {
          type: 'channel',
          channel: this.#setChannel(text(record(raw).voiceChannel) || 'room'),
        },
      }),
    );
    socket.on('voice_party_invite', (raw: unknown) => {
      const v = record(raw),
        partyId = text(v.partyId);
      if (partyId) {
        this.publish({
          type: 'voice',
          event: { type: 'party', partyId, fromUsername: text(v.fromUsername, 64) },
        });
      }
    });
    for (const event of ['disconnect', 'connect_error']) {
      socket.on(event, () => {
        this.#authenticated = false;
        this.#attempt++;
        clearTimeout(this.#authRetry);
        // Do not publish an empty roster on transient transport loss: that
        // would tear down working peer-to-peer calls in the renderer.
        this.publish({ type: 'voice', event: { type: 'lost' } });
      });
    }
    socket.connect();
  }
  #setChannel(channel: string): string {
    if (this.#ready) {
      this.#ready = { ...this.#ready, channel };
    }
    return channel;
  }
  ensureVoice(): void {
    if (this.#authenticated && this.#ready) {
      this.publish({ type: 'voice', event: this.#ready });
      this.#update();
    } else {
      if (this.#socket.connected) {
        return;
      } // Authentication already in progress.
      this.#socket.disconnect();
      this.#socket.connect();
    }
  }
  #update(): void {
    const members = [...this.#members.values()];
    this.changed(members);
    this.publish({ type: 'voice', event: { type: 'members', members } });
  }
  send(target: unknown, raw: unknown): void {
    const signal = normalizeWorldsSignal(raw);
    if (
      !this.#authenticated ||
      typeof target !== 'string' ||
      !this.#members.has(target) ||
      !signal
    ) {
      throw new Error('No se puede enviar la señal de voz a ese participante');
    }
    this.#socket.emit('voice_signal', { to: target, signal });
  }
  state(connected: boolean, muted: boolean): void {
    if (this.#authenticated) {
      this.#socket.emit('voice_state', { connected, muted });
    }
  }
  async party(action: string, value: unknown): Promise<void> {
    if (!this.#authenticated) {
      throw new Error('La voz todavía no está conectada a Battly');
    }
    let event: string, payload: Record<string, unknown>;
    if (action === 'room') {
      if (this.#ready?.channel === 'room') {
        return;
      }
      event = 'voice_channel_room';
      payload = {};
    } else if (action === 'join' && typeof value === 'string' && /^[\w-]{1,128}$/.test(value)) {
      event = 'voice_party_join';
      payload = { partyId: value };
    } else if (
      action === 'create' &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 32 &&
      value.every((id) => typeof id === 'string' && this.#members.has(id))
    ) {
      event = 'voice_party_create';
      payload = { memberIds: value };
    } else {
      throw new Error('Grupo de voz no válido');
    }
    let raw: unknown;
    try {
      raw = await this.#socket.timeout(10000).emitWithAck(event, payload);
    } catch {
      console.warn('[Battly Worlds] Voice acknowledgement timeout', {
        event,
        connected: this.#socket.connected,
        authenticated: this.#authenticated,
      });
      throw new Error(
        'La voz de Battly no ha respondido. Reintenta cuando se recupere la conexión con la sala.',
      );
    }
    const data = record(raw);
    if (data.ok !== true) {
      throw new Error('Battly no ha podido cambiar el grupo de voz');
    }
    this.publish({
      type: 'voice',
      event: {
        type: 'channel',
        channel: this.#setChannel(text(data.voiceChannel) || text(data.partyId) || 'room'),
      },
    });
  }
  stop(): void {
    this.#attempt++;
    clearTimeout(this.#authRetry);
    this.#socket.emit('leave_room');
    this.#socket.removeAllListeners();
    this.#socket.disconnect();
    this.#authenticated = false;
    this.#ready = undefined;
    this.#members.clear();
    this.publish({ type: 'voice', event: { type: 'command', command: { type: 'disconnect' } } });
  }
}

function normalizeWorldsSignal(value: unknown): Record<string, unknown> | null {
  const v = record(value);
  if (
    (v.type === 'offer' || v.type === 'answer') &&
    typeof v.sdp === 'string' &&
    v.sdp.length > 0 &&
    v.sdp.length <= 65536
  ) {
    return { type: v.type, sdp: v.sdp };
  }
  if (v.type === 'restart') {
    return { type: 'restart' };
  }
  if (
    v.type === 'candidate' &&
    typeof v.candidate === 'string' &&
    v.candidate.length <= 4096 &&
    (v.sdpMid === null || (typeof v.sdpMid === 'string' && v.sdpMid.length <= 64)) &&
    (v.sdpMLineIndex === null ||
      (Number.isInteger(v.sdpMLineIndex) &&
        Number(v.sdpMLineIndex) >= 0 &&
        Number(v.sdpMLineIndex) < 64))
  ) {
    return {
      type: 'candidate',
      candidate: v.candidate,
      ...(typeof v.usernameFragment === 'string' && v.usernameFragment.length <= 256
        ? { usernameFragment: v.usernameFragment }
        : {}),
      sdpMid: v.sdpMid,
      sdpMLineIndex: v.sdpMLineIndex,
    };
  }
  return null;
}
