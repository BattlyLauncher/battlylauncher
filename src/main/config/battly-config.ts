import { RemoteJsonClient } from './remote-json-client';
import { validateLauncherConfig, type LauncherConfig } from '../../shared/config/launcher-config';

export const battlyResourceUrls = Object.freeze({
  hotVersions: 'https://api.battlylauncher.com/v3/analytics/hot-versions?limit=15&days=1',
  launcherConfig: 'https://api.battlylauncher.com/v3/launcher/config-launcher/config.json',
  launcherVersions:
    'https://api.battlylauncher.com/v3/battlylauncher/launcher/config-launcher/versions.json',
  launcherNews: 'https://api.battlylauncher.com/v3/battlylauncher/launcher/news-launcher/news.json',
});

export function createBattlyConfigClient(
  cachePath: string,
  fetchImplementation?: typeof fetch,
  url: string = battlyResourceUrls.launcherConfig,
): RemoteJsonClient<LauncherConfig> {
  return new RemoteJsonClient({
    url,
    cachePath,
    validate: validateLauncherConfig,
    fetchImplementation,
    timeoutMs: 10_000,
    maxBytes: 2 * 1024 * 1024,
    allowLoopbackHttp: true,
  });
}
