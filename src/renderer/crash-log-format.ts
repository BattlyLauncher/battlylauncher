import { Log4jLogDecoder } from '../shared/minecraft/log4j-log';
import { uiLocale } from './i18n/locale';
type JsonRecord = Record<string, unknown>;
let timeFormatter: Intl.DateTimeFormat | undefined;
let timeLocale = '';

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function timeLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const locale = uiLocale();
  if (!timeFormatter || timeLocale !== locale) {
    timeLocale = locale;
    timeFormatter = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
  return timeFormatter.format(date);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

function formatJsonLogLine(line: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const root = record(parsed);
  if (!root) {
    return null;
  }
  const event = record(root.event);
  const prefix = timeLabel(root.timestamp);
  if (!event) {
    return root.type === 'session'
      ? `${prefix}  SESIÓN  ${text(root.instanceId, 'Minecraft')}`.trim()
      : null;
  }
  if (event.type === 'log') {
    const stream = text(event.stream, 'game').toUpperCase();
    return `${prefix}  ${stream.padEnd(6)}  ${text(event.message)}`.trimEnd();
  }
  if (event.type === 'state') {
    return `${prefix}  ESTADO  ${text(event.state)}`.trimEnd();
  }
  if (event.type === 'exit') {
    return `${prefix}  SALIDA  código=${text(event.code, '—')} señal=${text(event.signal, '—')}`;
  }
  if (event.type === 'progress') {
    const current = Number(event.current);
    const total = Number(event.total);
    const percentage = total > 0 ? ` · ${Math.round((current / total) * 100)}%` : '';
    return `${prefix}  PROGRESO  ${text(event.item)} · ${current}/${total}${percentage}`;
  }
  return `${prefix}  ${text(event.type, 'EVENTO').toUpperCase()}  ${JSON.stringify(event)}`;
}

function jsonGameMessage(
  line: string,
): { readonly message: string; readonly prefix: string } | null {
  try {
    const root = record(JSON.parse(line) as unknown);
    const event = root ? record(root.event) : null;
    return event?.type === 'log' && typeof event.message === 'string'
      ? { message: event.message, prefix: timeLabel(root?.timestamp) }
      : null;
  } catch {
    return null;
  }
}

export function formatCrashLog(rawLog: string): string {
  const decoder = new Log4jLogDecoder();
  const formatted: string[] = [];
  for (const sourceLine of rawLog.replaceAll('\r', '').split('\n')) {
    const line = sourceLine.trim();
    const message = line.startsWith('{') ? jsonGameMessage(line) : null;
    const value =
      message?.message ??
      (line.startsWith('{') ? (formatJsonLogLine(line) ?? sourceLine) : sourceLine);
    for (const decoded of decoder.push(value + '\n')) {
      formatted.push(decoded);
    }
  }
  formatted.push(...decoder.flush());
  return formatted.join('\n').trim();
}
