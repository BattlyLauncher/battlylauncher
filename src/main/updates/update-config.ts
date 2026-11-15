import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function updateConfigPath(resources: string, userData: string): string {
  const bundled = join(resources, 'app-update.yml');
  if (existsSync(bundled)) {
    return bundled;
  }
  // Older archive distributions omit this file. The fallback contains no credentials.
  mkdirSync(userData, { recursive: true });
  const fallback = join(userData, 'app-update-fallback.yml');
  const publisher =
    'CN="TECNO BROS STUDIOS, S.L.", O="TECNO BROS STUDIOS, S.L.", L=Barcelona, S=Barcelona, C=ES';
  writeFileSync(
    fallback,
    'provider: github\nowner: BattlyLauncher\nrepo: battlylauncher\nupdaterCacheDirName: battly-remake-updater\npublisherName: ' +
      JSON.stringify([publisher]) +
      '\n',
    { mode: 0o600 },
  );
  return fallback;
}
