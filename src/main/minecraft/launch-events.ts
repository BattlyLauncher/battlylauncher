import {
  parseMinecraftServerAddress,
  minecraftServerAddress,
} from '../../shared/minecraft/server-address';
import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import { formatLog4jText } from '../../shared/minecraft/log4j-log';
import type { MinecraftAuthorization } from './launcher-adapter';

const maximumLogLength = 64 * 1024;

type GameLogEvent = Extract<MinecraftLaunchEvent, { type: 'log' }>;

/** Only server lifecycle logs count: chat can contain arbitrary player text. */
export function minecraftLanPortFromLog(value: string): number | null {
  if (/\[CHAT\]/i.test(value)) {
    return null;
  }
  // Legacy IntegratedServer (including 1.8.9) logs "Started on <port>".
  const match =
    /\b(?:Started on|Started serving on|Local game hosted on port|Published LAN server on port)\s+(\d{1,5})\b/i.exec(
      value,
    );
  const port = match ? Number(match[1]) : 0;
  return port >= 1 && port <= 65535 ? port : null;
}

export function minecraftServerFromLog(value: string): string | null {
  value = formatLog4jText(value);
  if (/\[CHAT\]/i.test(value)) {
    return null;
  }
  const match =
    /\bConnecting to\s+(\[[0-9a-f:]+\]|[^\s,]+),\s*(\d{1,5})(?=$|\s)/i.exec(value) ??
    /\bConnecting to\s+(\[[0-9a-f:]+\]|[a-z0-9._-]+):(\d{1,5})(?=$|\s)/i.exec(value);
  if (!match) {
    return null;
  }
  const host = match[1].replace(/^\[|\]$/g, '');
  const server = parseMinecraftServerAddress(host, Number(match[2]));
  return server ? minecraftServerAddress(server) : null;
}

export function minecraftDisconnectedFromLog(value: string): boolean {
  value = formatLog4jText(value);
  return (
    !/\[CHAT\]/i.test(value) &&
    /Disconnected from server|Disconnecting from|Connection lost|Failed to connect to (?:the )?server|Couldn't connect to server/i.test(
      value,
    )
  );
}

function removeUnsafeControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join('');
}

function removeAnsiSequences(value: string): string {
  // CSI colour/control sequences and OSC window-title sequences are terminal
  // presentation details, not useful launcher log content.
  const escape = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  const osc = new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'gu');
  const csi = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'gu');
  return value.replace(osc, '').replace(csi, '');
}

function toGameLogEvent(value: string, authorization: MinecraftAuthorization): GameLogEvent | null {
  let message = removeUnsafeControlCharacters(removeAnsiSequences(value));
  for (const secret of [authorization.accessToken, authorization.clientToken, authorization.uuid]) {
    if (secret) {
      message = message.replaceAll(secret, '[redacted]');
    }
  }
  if (/^(?:\[MCLC\]:\s*)?Launching with arguments\b/i.test(message)) {
    const argumentCount = message.trim().split(/\s+/).length - 3;
    message = `[inicio] Comando de Java preparado (${Math.max(0, argumentCount)} argumentos)`;
  }
  message = message.replace(/\s+\{\}\s*$/, '');
  message = message.trimEnd().slice(0, maximumLogLength);
  return message ? { type: 'log', stream: 'game', message } : null;
}

/**
 * Converts the inconsistent stream emitted by both Minecraft cores into
 * renderer-safe, line-oriented events. Buffers are treated as a byte stream;
 * strings are complete events because both cores also emit status strings
 * without a trailing newline.
 */
export class MinecraftLogParser {
  readonly #authorization: MinecraftAuthorization;
  readonly #decoder = new TextDecoder('utf-8');
  #pending = '';

  constructor(authorization: MinecraftAuthorization) {
    this.#authorization = authorization;
  }

  push(value: unknown): GameLogEvent[] {
    if (Buffer.isBuffer(value)) {
      this.#pending += this.#decoder.decode(value, { stream: true });
      return this.#drainCompleteLines();
    }
    if (typeof value !== 'string') {
      return [];
    }
    return this.#parseCompleteText(value);
  }

  pushChunk(value: unknown): GameLogEvent[] {
    if (Buffer.isBuffer(value)) {
      this.#pending += this.#decoder.decode(value, { stream: true });
    } else if (typeof value === 'string') {
      this.#pending += value;
    } else {
      return [];
    }
    return this.#drainCompleteLines();
  }

  flush(): GameLogEvent[] {
    this.#pending += this.#decoder.decode();
    const events = this.#drainCompleteLines();
    if (!this.#pending) {
      return events;
    }
    const event = toGameLogEvent(this.#pending, this.#authorization);
    this.#pending = '';
    if (event) {
      events.push(event);
    }
    return events;
  }

  #drainCompleteLines(): GameLogEvent[] {
    this.#pending = this.#pending.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const parts = this.#pending.split('\n');
    this.#pending = parts.pop() ?? '';
    return parts
      .map((line) => toGameLogEvent(line, this.#authorization))
      .filter((event): event is GameLogEvent => event !== null);
  }

  #parseCompleteText(value: string): GameLogEvent[] {
    return value
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .split('\n')
      .map((line) => toGameLogEvent(line, this.#authorization))
      .filter((event): event is GameLogEvent => event !== null);
  }
}

export function safeGameLogEvent(
  value: unknown,
  authorization: MinecraftAuthorization,
): Extract<MinecraftLaunchEvent, { type: 'log' }> | null {
  const parser = new MinecraftLogParser(authorization);
  return parser.push(value)[0] ?? parser.flush()[0] ?? null;
}
