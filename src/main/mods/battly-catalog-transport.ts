const publicBase = 'https://api.battlylauncher.com/mods/catalog/';

export function battlyCatalogBase(): URL {
  const url = new URL(process.env.BATTLY_CATALOG_API_URL ?? publicBase);
  if (
    url.href !== publicBase &&
    !(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/mods/catalog/')
  ) {
    throw new TypeError('Invalid Battly catalog API');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Invalid Battly catalog API');
  }
  return url;
}

export function authenticatedCatalogFetch(
  getToken: () => Promise<string>,
  image = false,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const base = battlyCatalogBase();
    const destination =
      url.origin === base.origin && url.pathname.startsWith(base.pathname)
        ? url
        : new URL('file', base);
    if (destination !== url) {
      if (url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new TypeError('Invalid catalog download URL');
      }
      destination.searchParams.set('url', url.href);
      if (image) {
        destination.searchParams.set('kind', 'image');
      }
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${await getToken()}`);
    const options = { ...init, headers, redirect: 'error' as const };
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(destination, options);
      if (attempt >= 2 || (response.status !== 429 && response.status !== 503)) {
        return response;
      }
      const waitSeconds = Number(response.headers.get('Retry-After'));
      const waitMs = waitSeconds > 0 ? Math.min(60, waitSeconds) * 1000 : 500 * 2 ** attempt;
      await response.body?.cancel();
      await delay(waitMs, undefined, { signal: init?.signal ?? undefined });
    }
  };
}
import { setTimeout as delay } from 'node:timers/promises';
