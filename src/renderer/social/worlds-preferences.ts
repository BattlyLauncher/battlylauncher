import {
  defaultWorldsPreferences,
  normalizeWorldsPreferences,
  type WorldsPreferences,
} from '../../shared/settings/game-preferences';
let preferences = { ...defaultWorldsPreferences };
const listeners = new Set<(value: WorldsPreferences) => void>();
export const worldsPreferences = (): WorldsPreferences => preferences;
export function applyWorldsPreferences(value: WorldsPreferences): void {
  preferences = normalizeWorldsPreferences(value);
  for (const listener of listeners) {
    listener(preferences);
  }
}
export function onWorldsPreferences(listener: (value: WorldsPreferences) => void): void {
  listeners.add(listener);
}
export async function loadWorldsPreferences(): Promise<void> {
  applyWorldsPreferences((await window.battly.getSettings()).runtime.worlds);
}
let writes: Promise<unknown> = Promise.resolve();
export function saveWorldsVoicePreferences(muted: boolean, deafened: boolean): void {
  applyWorldsPreferences({ ...preferences, voiceMuted: muted, voiceDeafened: deafened });
  writes = writes
    .catch(() => undefined)
    .then(async () => {
      const latest = await window.battly.getSettings();
      await window.battly.saveSettings({
        ...latest,
        runtime: {
          ...latest.runtime,
          worlds: { ...latest.runtime.worlds, voiceMuted: muted, voiceDeafened: deafened },
        },
      });
    })
    .catch(() => undefined);
}
