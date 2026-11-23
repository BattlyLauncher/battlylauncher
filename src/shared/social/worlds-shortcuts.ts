export const defaultWorldsShortcuts = {
  menu: 'CommandOrControl+B',
  visibility: 'CommandOrControl+H',
  acceptLan: 'Y',
  dismissLan: 'N',
};

export type WorldsShortcuts = typeof defaultWorldsShortcuts;
export type WorldsShortcutAction = keyof WorldsShortcuts;
export const worldsShortcutConflict = 'Algún atajo de Battly Worlds ya está en uso.';

export function normalizeWorldsShortcut(
  value: unknown,
  action: WorldsShortcutAction,
): string | undefined {
  if (typeof value !== 'string' || value.length > 64) {
    return undefined;
  }
  const parts = value.split('+');
  const key = parts.pop()?.toUpperCase() ?? '';
  const modifiers = ['CommandOrControl', 'Alt', 'Shift'].filter((modifier) =>
    parts.includes(modifier),
  );
  const lan = action === 'acceptLan' || action === 'dismissLan';
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2]))$/.test(key) ||
    modifiers.length !== parts.length ||
    (!lan && !modifiers.some((modifier) => modifier !== 'Shift'))
  ) {
    return undefined;
  }
  return [...modifiers, key].join('+');
}

export function normalizeWorldsShortcuts(value: unknown): WorldsShortcuts {
  const source = value && typeof value === 'object' ? value : {};
  const result = { ...defaultWorldsShortcuts };
  for (const action of Object.keys(result) as WorldsShortcutAction[]) {
    result[action] =
      normalizeWorldsShortcut(Object.getOwnPropertyDescriptor(source, action)?.value, action) ??
      result[action];
  }
  return new Set(Object.values(result)).size === 4 ? result : { ...defaultWorldsShortcuts };
}

export function formatWorldsShortcut(shortcut: string, mac: boolean): string {
  return shortcut
    .replace('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replace('Alt', mac ? '⌥' : 'Alt')
    .split('+')
    .join(' + ');
}
