export interface NoticeLink {
  label: string;
  url: string;
}
export interface NoticeSelect {
  label: string;
  options: NoticeLink[];
}
export interface BattlyNotice {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  expiresAt: number;
  category: 'announcement' | 'action' | 'social';
  actions: NoticeLink[];
  dropdowns: NoticeSelect[];
  read: boolean;
}
export interface NoticeSettings {
  native: boolean;
  actions: boolean;
  announcements: boolean;
  social: boolean;
}
export interface NoticeSnapshot {
  items: BattlyNotice[];
  settings: NoticeSettings;
}
export const notificationRetentionMs = 7 * 86400000;
const text = (value: unknown, max: number): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    // eslint-disable-next-line no-control-regex -- Este patrón filtra caracteres de control deliberadamente.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  ) {
    throw new Error('Invalid notification text');
  }
  return value.trim();
};
export function noticeUrl(value: unknown): string {
  const url = new URL(text(value, 2048));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Notification links must use HTTPS');
  }
  return url.href;
}
function link(value: unknown): NoticeLink {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid notification link');
  }
  const item = value as Record<string, unknown>;
  return { label: text(item.label, 80), url: noticeUrl(item.url) };
}
function list<T>(value: unknown, max: number, parse: (v: unknown) => T): T[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > max) {
    throw new Error('Invalid notification controls');
  }
  return value.map(parse);
}
export function normalizeNotice(value: unknown, now = Date.now()): BattlyNotice {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid notification');
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16384) {
    throw new Error('Invalid notification size');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(v.id)) {
    throw new Error('Invalid notification ID');
  }
  const createdAt =
    typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) ? v.createdAt : now;
  const expiresAt =
    typeof v.expiresAt === 'number' && Number.isFinite(v.expiresAt)
      ? v.expiresAt
      : createdAt + notificationRetentionMs;
  if (expiresAt <= createdAt || expiresAt > now + 30 * 86400000 || createdAt > now + 60000) {
    throw new Error('Invalid notification dates');
  }
  const actions = list(v.actions, 4, link);
  if (v.url && !actions.length) {
    actions.push({ label: 'Abrir enlace', url: noticeUrl(v.url) });
  }
  return {
    id: text(v.id, 128),
    title: text(v.title ?? v.titulo, 160),
    body: text(v.body ?? v.descripcion ?? v.mensaje, 4000),
    createdAt,
    expiresAt: Math.min(expiresAt, createdAt + notificationRetentionMs),
    category: v.category === 'action' || v.category === 'social' ? v.category : 'announcement',
    actions,
    dropdowns: list(v.dropdowns, 2, (value) => {
      if (!value || typeof value !== 'object') {
        throw new Error('Invalid dropdown');
      }
      const d = value as Record<string, unknown>;
      const options = list(d.options, 12, link);
      if (!options.length) {
        throw new Error('Invalid empty dropdown');
      }
      return { label: text(d.label, 80), options };
    }),
    read: v.read === true,
  };
}
