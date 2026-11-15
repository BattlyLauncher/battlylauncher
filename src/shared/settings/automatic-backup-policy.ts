import type { RuntimeSettings } from './settings-contract';

export function shouldBackUpAutomatically(
  scope: string,
  settings: Pick<
    RuntimeSettings,
    'backupSharedWorlds' | 'backupInstances' | 'backupIntervalMinutes'
  >,
  lastCompletedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (scope === 'general' ? !settings.backupSharedWorlds : !settings.backupInstances) {
    return false;
  }
  if (!lastCompletedAt || now < lastCompletedAt) {
    return true;
  }
  return now - lastCompletedAt >= settings.backupIntervalMinutes * 60_000;
}
