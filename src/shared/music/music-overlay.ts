import type { MusicPlaybackState } from './music-contract';

export interface MusicWidget {
  readonly id: string;
  readonly displayId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface MusicOverlayPreferences {
  readonly widgets: readonly MusicWidget[];
}
export interface MusicOverlayPlayback {
  readonly accent?: string;
  readonly volume: number;
  readonly queueIndex: number;
  readonly queue: readonly { index: number; title: string; artist: string }[];
}
export interface MusicOverlaySnapshot {
  readonly playback: MusicPlaybackState;
  readonly preferences: MusicOverlayPreferences;
  readonly displays: readonly { id: string; name: string; width: number; height: number }[];
  readonly displayId: string;
  readonly open: boolean;
  readonly maximized: boolean;
  readonly editing: boolean;
  readonly shortcutAvailable: boolean;
}
export type MusicOverlayCommand =
  | { type: 'open' | 'close' | 'maximize' | 'edit' }
  | { type: 'seek' | 'volume'; value: number }
  | { type: 'queue'; index: number };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid music overlay data');
  }
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError('Invalid music overlay number');
  }
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new TypeError('Invalid music overlay text');
  }
  return value;
}
export function normalizeMusicOverlayPreferences(value: unknown): MusicOverlayPreferences {
  const source = record(value);
  if (!Array.isArray(source.widgets) || source.widgets.length > 8) {
    throw new TypeError('Invalid music widget list');
  }
  const ids = new Set<string>();
  return {
    widgets: source.widgets.map((value) => {
      const item = record(value),
        id = text(item.id, 64);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
        throw new TypeError('Invalid music widget id');
      }
      ids.add(id);
      return {
        id,
        displayId: text(item.displayId, 64),
        x: number(item.x, 0, 1),
        y: number(item.y, 0, 1),
        width: number(item.width, 180, 720),
        height: number(item.height, 72, 240),
      };
    }),
  };
}
export function normalizeMusicOverlayPlayback(value: unknown): MusicOverlayPlayback {
  const source = record(value);
  if (!Array.isArray(source.queue) || source.queue.length > 50) {
    throw new TypeError('Invalid music overlay queue');
  }
  if (!Number.isInteger(source.queueIndex)) {
    throw new TypeError('Invalid music queue index');
  }
  return {
    ...(typeof source.accent === 'string' && /^#[0-9a-f]{6}$/i.test(source.accent)
      ? { accent: source.accent }
      : {}),
    volume: number(source.volume, 0, 100),
    queueIndex: number(source.queueIndex, -1, 100000),
    queue: source.queue.map((entry) => {
      const item = record(entry);
      const index = number(item.index, 0, 100000);
      if (!Number.isInteger(index)) {
        throw new TypeError('Invalid music queue index');
      }
      return { index, title: text(item.title, 300), artist: text(item.artist, 200) };
    }),
  };
}
export function normalizeMusicOverlayCommand(value: unknown): MusicOverlayCommand {
  const source = record(value);
  if (['open', 'close', 'maximize', 'edit'].includes(String(source.type))) {
    return { type: source.type as 'open' | 'close' | 'maximize' | 'edit' };
  }
  if (source.type === 'volume' || source.type === 'seek') {
    return {
      type: source.type,
      value: number(source.value, 0, source.type === 'volume' ? 100 : 86400),
    };
  }
  if (source.type === 'queue' && Number.isInteger(source.index)) {
    return { type: 'queue', index: number(source.index, 0, 100000) };
  }
  throw new TypeError('Invalid music overlay command');
}

export function musicWidgetBounds(widget: MusicWidget, width: number, height: number) {
  const w = Math.min(widget.width, width),
    h = Math.min(widget.height, height);
  return {
    x: Math.round(widget.x * Math.max(0, width - w)),
    y: Math.round(widget.y * Math.max(0, height - h)),
    width: w,
    height: h,
  };
}
