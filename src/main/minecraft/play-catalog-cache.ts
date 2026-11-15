import type { RemoteJsonClient } from '../config/remote-json-client';
import type { LauncherVersionEntry } from '../../shared/minecraft/play-version-contract';

const refreshTimes = new WeakMap<object, number>();

/** Installed games must remain accessible without waiting for the API. */
export async function cachedPlayCatalog(
  client: Pick<RemoteJsonClient<readonly LauncherVersionEntry[]>, 'load'>,
): Promise<readonly LauncherVersionEntry[]> {
  const now = Date.now();
  if (now - (refreshTimes.get(client) ?? -Infinity) >= 60_000) {
    refreshTimes.set(client, now);
    // load() validates and atomically persists the catalogue; it also coalesces
    // a concurrent download-panel request. The next opening sees that update.
    void client.load().catch(() => undefined);
  }
  return client
    .load({ offline: true })
    .then((result) => result.data)
    .catch(() => []);
}
