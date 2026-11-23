import { parseMinecraftServerAddress } from './server-address';
export const minecraftLaunchEngines = ['minecraft-java-core', 'minecraft-launcher-core'] as const;

export type MinecraftLaunchEngine = (typeof minecraftLaunchEngines)[number];
export type MinecraftLaunchState = 'preparing' | 'running' | 'exited' | 'failed';

export interface MinecraftLaunchWindow {
  readonly fullscreen: boolean;
  readonly height: number;
  readonly width: number;
}

export type MinecraftLaunchEvent =
  | { readonly type: 'client-ready' }
  | {
      readonly type: 'memory-warning';
      readonly severity: 'safe' | 'warning' | 'critical' | 'unknown';
    }
  | { readonly type: 'process'; readonly pid: number }
  | { readonly state: MinecraftLaunchState; readonly type: 'state' }
  | { readonly code: number | null; readonly signal: string | null; readonly type: 'exit' }
  | {
      readonly current: number;
      readonly item: string;
      readonly total: number;
      readonly type: 'progress';
      readonly unit?: 'bytes' | 'files' | 'percent';
    }
  | {
      readonly current: number;
      readonly item: string;
      readonly total: number;
      readonly type: 'check';
    }
  | { readonly bytesPerSecond: number; readonly type: 'speed' }
  | { readonly category: string; readonly item: string; readonly type: 'file-start' }
  | { readonly category: string; readonly item: string; readonly type: 'file-complete' }
  | { readonly phase: string; readonly type: 'phase' }
  | { readonly message: string; readonly stream: 'game'; readonly type: 'log' };

export type MinecraftLaunchOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'busy';
      readonly state: 'preparing' | 'running';
      readonly message: string;
    }
  | {
      readonly code: 'failed' | 'no-account' | 'unavailable' | 'cancelled';
      readonly message: string;
      readonly ok: false;
    };

export function isMinecraftClientReadyMessage(value: string): boolean {
  // Rendering readiness; Windows prefers its visible-window probe before falling back.
  return /(?:Created:\s*\d+x\d+.*atlas|(?:Render thread|Client thread).*Sound engine started)/i.test(
    value,
  );
}

export function isMinecraftGracefulShutdownMessage(value: string): boolean {
  return (
    /\[(?:Render thread|Client thread|main)\/INFO\]:\s*Stopping!/i.test(value) ||
    /(?:^|\r?\n)\s*(?:\d{2}:\d{2}:\d{2}\s+GAME\s+)?Stopping!\s*(?=$|\r?\n)/i.test(value) ||
    /"message"\s*:\s*"Stopping!"/i.test(value) ||
    /^\s*<log4j:Message><!\[CDATA\[Stopping!\]\]><\/log4j:Message>\s*$/i.test(value)
  );
}

export interface MinecraftInstanceLaunchRequest {
  readonly allowDuplicateMods?: boolean;
  readonly javaPath?: string;
  readonly directConnect: MinecraftDirectConnectServer | null;
  readonly safeMode: boolean;
}

export interface MinecraftDirectConnectServer {
  readonly host: string;
  readonly port: number;
}

export function normalizeDirectConnectServer(value: unknown): MinecraftDirectConnectServer | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid direct connect server');
  }
  const source = value as Record<string, unknown>;
  const host = source.host;
  const port = source.port;
  if (
    typeof host !== 'string' ||
    host.length < 1 ||
    host.length > 253 ||
    !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?|[0-9a-fA-F:]+)$/.test(host) ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new TypeError('Invalid direct connect server');
  }
  const parsed = parseMinecraftServerAddress(host, port);
  if (!parsed) {
    throw new TypeError('Invalid direct connect server');
  }
  return parsed;
}

export function normalizeInstanceLaunchRequest(value: unknown): MinecraftInstanceLaunchRequest {
  if (value === undefined) {
    return { directConnect: null, safeMode: false };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid instance launch request');
  }
  const source = value as Record<string, unknown>;
  if (source.allowDuplicateMods !== undefined && typeof source.allowDuplicateMods !== 'boolean') {
    throw new TypeError('Invalid duplicate mod override');
  }
  if (!Object.hasOwn(source, 'safeMode')) {
    throw new TypeError('Invalid safe mode option');
  }
  const safeMode = source.safeMode;
  if (
    source.javaPath !== undefined &&
    (typeof source.javaPath !== 'string' ||
      source.javaPath.length > 4096 ||
      source.javaPath.includes('\0'))
  ) {
    throw new TypeError('Invalid Java override');
  }
  if (typeof safeMode !== 'boolean') {
    throw new TypeError('Invalid safe mode option');
  }
  return {
    ...(source.allowDuplicateMods === true ? { allowDuplicateMods: true } : {}),
    directConnect: normalizeDirectConnectServer(source.directConnect),
    safeMode,
    ...(typeof source.javaPath === 'string' ? { javaPath: source.javaPath } : {}),
  };
}

export function isMinecraftLaunchEvent(value: unknown): value is MinecraftLaunchEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const event = value as Record<string, unknown>;
  const type = event.type;
  if (type === 'memory-warning') {
    return ['safe', 'warning', 'critical', 'unknown'].includes(String(event.severity));
  }
  if (type === 'client-ready') {
    return true;
  }
  if (type === 'process') {
    return typeof event.pid === 'number' && Number.isInteger(event.pid) && event.pid > 0;
  }
  if (type === 'state') {
    return (
      event.state === 'preparing' ||
      event.state === 'running' ||
      event.state === 'exited' ||
      event.state === 'failed'
    );
  }
  if (type === 'phase') {
    return typeof event.phase === 'string' && event.phase.length <= 64;
  }
  if (type === 'progress' || type === 'check') {
    return (
      typeof event.current === 'number' &&
      Number.isFinite(event.current) &&
      typeof event.total === 'number' &&
      Number.isFinite(event.total) &&
      typeof event.item === 'string' &&
      event.item.length <= 128 &&
      (event.unit === undefined ||
        (type === 'progress' &&
          (event.unit === 'bytes' || event.unit === 'files' || event.unit === 'percent')))
    );
  }
  if (type === 'speed') {
    return (
      typeof event.bytesPerSecond === 'number' &&
      Number.isFinite(event.bytesPerSecond) &&
      event.bytesPerSecond >= 0
    );
  }
  if (type === 'file-start' || type === 'file-complete') {
    return (
      typeof event.item === 'string' &&
      event.item.length <= 128 &&
      typeof event.category === 'string' &&
      event.category.length <= 64
    );
  }
  if (type === 'log') {
    return (
      event.stream === 'game' &&
      typeof event.message === 'string' &&
      event.message.length <= 64 * 1024
    );
  }
  return (
    type === 'exit' &&
    (event.code === null ||
      (typeof event.code === 'number' &&
        Number.isInteger(event.code) &&
        Number.isFinite(event.code))) &&
    (event.signal === null || typeof event.signal === 'string')
  );
}

export function isMinecraftLaunchEngine(value: unknown): value is MinecraftLaunchEngine {
  return typeof value === 'string' && (minecraftLaunchEngines as readonly string[]).includes(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function normalizeLaunchWindow(
  value: Partial<MinecraftLaunchWindow> | undefined,
): MinecraftLaunchWindow {
  return {
    width: boundedInteger(value?.width, 320, 7680),
    height: boundedInteger(value?.height, 240, 4320),
    fullscreen: value?.fullscreen === true,
  };
}

function safeLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return 'files';
  }
  const lastSegment = value.split(/[\\/]/).at(-1) ?? '';
  const cleaned = [...lastSegment]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 128);
  return cleaned || 'files';
}

export function normalizeLaunchItem(value: unknown): string {
  return safeLabel(value);
}

export function normalizeLaunchProgress(
  currentValue: unknown,
  totalValue: unknown,
  itemValue: unknown,
): Extract<MinecraftLaunchEvent, { type: 'progress' }> | null {
  if (
    typeof currentValue !== 'number' ||
    !Number.isFinite(currentValue) ||
    typeof totalValue !== 'number' ||
    !Number.isFinite(totalValue) ||
    totalValue <= 0
  ) {
    return null;
  }
  const total = Math.max(1, Math.round(totalValue));
  return {
    type: 'progress',
    current: Math.min(total, Math.max(0, Math.round(currentValue))),
    total,
    item: safeLabel(itemValue),
  };
}

export function normalizeLaunchPhase(
  value: unknown,
): Extract<MinecraftLaunchEvent, { type: 'phase' }> | null {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    return null;
  }
  return { type: 'phase', phase: value };
}
