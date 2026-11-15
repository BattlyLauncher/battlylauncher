export interface DisplayPreferences {
  width: number;
  height: number;
  fullscreen: boolean;
}
export type DisplayOverrides = Record<string, DisplayPreferences>;
export function normalizeDisplay(value: unknown): DisplayPreferences {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const size = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(v[key]);
    return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
  };
  return {
    width: size('width', 1280, 320, 7680),
    height: size('height', 720, 240, 4320),
    fullscreen: v.fullscreen === true,
  };
}
export function normalizeDisplayOverrides(value: unknown): DisplayOverrides {
  const result: DisplayOverrides = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }
  for (const [key, entry] of Object.entries(value).slice(0, 500)) {
    if (/^(instance|version):[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(key)) {
      result[key] = normalizeDisplay(entry);
    }
  }
  return result;
}
export function resolveDisplay(
  global: unknown,
  overrides: unknown,
  version: string,
  instanceId?: string,
): DisplayPreferences {
  const saved = normalizeDisplayOverrides(overrides);
  return (
    (instanceId ? saved[`instance:${instanceId}`] : undefined) ??
    saved[`version:${version}`] ??
    normalizeDisplay(global)
  );
}

export interface WorldsPreferences {
  defaultPublic: boolean;
  allowPublicListing: boolean;
  durationHours: number;
  autoLanDetection: boolean;
  closeOnGameExit: boolean;
  invitations: boolean;
  connectionAlerts: boolean;
  voiceAutoJoin: boolean;
  voiceMuted: boolean;
  voiceDeafened: boolean;
  voiceSounds: boolean;
  overlayEnabled: boolean;
  overlayOpacity: number;
}
export const defaultWorldsPreferences: WorldsPreferences = {
  defaultPublic: false,
  allowPublicListing: true,
  durationHours: 6,
  autoLanDetection: true,
  closeOnGameExit: true,
  invitations: true,
  connectionAlerts: true,
  voiceAutoJoin: true,
  voiceMuted: false,
  voiceDeafened: false,
  voiceSounds: true,
  overlayEnabled: true,
  overlayOpacity: 92,
};
export function normalizeWorldsPreferences(value: unknown): WorldsPreferences {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const result = { ...defaultWorldsPreferences };
  for (const key of Object.keys(result) as (keyof WorldsPreferences)[]) {
    if (key === 'durationHours' || key === 'overlayOpacity') {
      const n = Number(v[key]);
      if (Number.isFinite(n)) {
        result[key] = Math.round(
          Math.max(
            key === 'durationHours' ? 1 : 25,
            Math.min(key === 'durationHours' ? 720 : 100, n),
          ),
        );
      }
    } else if (typeof v[key] === 'boolean') {
      result[key] = v[key];
    }
  }
  return result;
}
