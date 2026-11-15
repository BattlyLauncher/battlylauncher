export interface WorldsInvite {
  readonly createdAt?: number;
  readonly expiresAt?: number;
  readonly inviteId: string;
  readonly code: string;
  readonly fromUsername: string;
  readonly version: string;
}

export interface WorldsSnapshot {
  readonly serviceReady?: boolean;
  readonly maxGuests?: number;
  readonly state: 'idle' | 'starting' | 'scanning' | 'connecting' | 'hosting' | 'joined' | 'error';
  readonly username: string;
  readonly code: string;
  readonly address: string;
  readonly version: string;
  readonly message: string;
  readonly members: readonly string[];
  readonly invites: readonly WorldsInvite[];
  readonly inviteError: string;
  readonly isPublic: boolean;
  readonly roomTitle: string;
  readonly participants: readonly WorldsMember[];
}

export type WorldsAction =
  | {
      readonly type: 'report';
      readonly roomCode: string;
      readonly targetUserId?: string;
      readonly category: string;
      readonly description: string;
    }
  | { readonly type: 'discord-join'; readonly secret: string }
  | { readonly type: 'host'; readonly version: string }
  | { readonly type: 'join'; readonly code: string }
  | { readonly type: 'invite'; readonly username: string }
  | { readonly type: 'dismiss'; readonly inviteId: string }
  | { readonly type: 'visibility'; readonly isPublic: boolean; readonly title: string }
  | { readonly type: 'leave' };

export function normalizeWorldsAction(input: unknown): WorldsAction {
  if (!input || typeof input !== 'object') {
    throw new Error('Acción de BattlyWorlds no válida');
  }
  const value = input as Record<string, unknown>;
  const text = (key: string, pattern: RegExp, max: number): string => {
    const raw = value[key];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > max || !pattern.test(raw.trim())) {
      throw new Error(
        key === 'code'
          ? 'Introduce el código de sala de seis caracteres'
          : 'Datos de sala no válidos',
      );
    }
    return raw.trim();
  };
  switch (value.type) {
    case 'report': {
      const category = text(
        'category',
        /^(harassment|hate|cheating|inappropriate|privacy|other)$/,
        32,
      );
      // eslint-disable-next-line no-control-regex -- El filtro debe rechazar estos caracteres de control.
      const description = text('description', /^[^\u0000]{10,2000}$/, 2000);
      const targetUserId =
        value.targetUserId === undefined
          ? undefined
          : text('targetUserId', /^usuario_[\w.-]+$/, 128);
      return {
        type: 'report',
        roomCode: text('roomCode', /^[A-Z0-9]{6}$/i, 6).toUpperCase(),
        category,
        description,
        ...(targetUserId ? { targetUserId } : {}),
      };
    }
    case 'discord-join':
      return { type: 'discord-join', secret: text('secret', /^[a-f0-9]{64}$/, 64) };
    case 'visibility':
      if (typeof value.isPublic !== 'boolean') {
        throw new Error('Visibilidad no válida');
      }
      return {
        type: 'visibility',
        isPublic: value.isPublic,
        title: text('title', /^[^\r\n<>]+$/, 80),
      };
    case 'host':
      return { type: 'host', version: text('version', /^[\w. +()[\]-]+$/, 96) };
    case 'join':
      return { type: 'join', code: text('code', /^[a-z0-9]{6}$/i, 6).toUpperCase() };
    case 'invite':
      return { type: 'invite', username: text('username', /^[\w.+-]+$/, 64) };
    case 'dismiss':
      return { type: 'dismiss', inviteId: text('inviteId', /^[\w-]+$/, 128) };
    case 'leave':
      return { type: 'leave' };
    default:
      throw new Error('Acción de BattlyWorlds no válida');
  }
}

export interface WorldsMember {
  userId: string;
  username: string;
  muted: boolean;
  voiceConnected: boolean;
  voiceChannel: string;
}
export interface WorldsPublicRoom {
  code: string;
  title: string;
  hostUsername: string;
  version: string;
  premium: boolean;
  maxGuests: number | null;
  playerCount: number;
}
export interface WorldsIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}
export interface WorldsVoiceStatus {
  devices?: readonly { deviceId: string; label: string }[];
  inputDeviceId?: string;
  connected: boolean;
  muted: boolean;
  deafened: boolean;
  error: string;
}
export type WorldsVoiceCommand =
  | { type: 'connect' | 'disconnect' }
  | { type: 'mute' | 'deafen'; value: boolean }
  | { type: 'input'; deviceId: string }
  | { type: 'volume'; userId: string; volume: number };
export type WorldsVoiceEvent =
  | { type: 'activity'; speakers: readonly { userId: string; level: number }[] }
  | {
      type: 'ready';
      roomCode: string;
      userId: string;
      channel: string;
      iceServers: WorldsIceServer[];
    }
  | { type: 'members'; members: WorldsMember[] }
  | { type: 'signal'; from: string; signal: Record<string, unknown> }
  | { type: 'channel'; channel: string }
  | { type: 'party'; partyId: string; fromUsername: string }
  | { type: 'lost'; message?: string }
  | { type: 'command'; command: WorldsVoiceCommand }
  | { type: 'status'; status: WorldsVoiceStatus };
export type WorldsEvent =
  | { type: 'notice'; message: string }
  | { type: 'closed'; code: string; message: string }
  | { type: 'snapshot'; snapshot: WorldsSnapshot }
  | { type: 'invite'; invite: WorldsInvite }
  | { type: 'presence'; username: string; joined: boolean }
  | { type: 'voice'; event: WorldsVoiceEvent }
  | { type: 'open' };
export function normalizeVoiceCommand(value: unknown): WorldsVoiceCommand {
  if (!value || typeof value !== 'object') {
    throw new Error('Control de voz no válido');
  }
  const v = value as Record<string, unknown>;
  if (v.type === 'connect' || v.type === 'disconnect') {
    return { type: v.type };
  }
  if ((v.type === 'mute' || v.type === 'deafen') && typeof v.value === 'boolean') {
    return { type: v.type, value: v.value };
  }
  if (v.type === 'input' && typeof v.deviceId === 'string' && v.deviceId.length <= 512) {
    return { type: v.type, deviceId: v.deviceId };
  }
  if (
    v.type === 'volume' &&
    typeof v.userId === 'string' &&
    /^[\w-]{1,128}$/.test(v.userId) &&
    typeof v.volume === 'number' &&
    Number.isFinite(v.volume) &&
    v.volume >= 0 &&
    v.volume <= 1
  ) {
    return { type: v.type, userId: v.userId, volume: v.volume };
  }
  throw new Error('Control de voz no válido');
}

export function worldsRoomMemberCount(snapshot: WorldsSnapshot): number {
  if (!['hosting', 'joined'].includes(snapshot.state)) {
    return 0;
  }
  const names = [
    snapshot.username,
    ...snapshot.members,
    ...snapshot.participants.map((member) => member.username),
  ];
  return new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean)).size;
}
