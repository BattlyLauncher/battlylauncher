/** Network adapter for the immutable patch verifier shipped with Battly 3.1. */
const API = 'https://api.github.com';
const REPOSITORY = '/repos/BattlyLauncher/battlylauncher/';
const CDN = 'https://cdn.battlylauncher.com/public/updates/patches/';
interface AssetLocation {
  resource: string;
  publicUrl?: string;
  size: number;
}
interface TransportOptions {
  fetcher?: typeof globalThis.fetch;
  now?: () => number;
}
export function createCdnPatchFetch({
  fetcher = globalThis.fetch,
  now = Date.now,
}: TransportOptions = {}): typeof globalThis.fetch {
  const assets = new Map<number, AssetLocation>();
  let githubBlockedUntil = 0;
  function remember(rows: unknown, depth = 0): void {
    if (!Array.isArray(rows) || depth > 1) {
      return;
    }
    for (const value of rows as unknown[]) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const row = value as Record<string, unknown>;
      if (Array.isArray(row.assets)) {
        remember(row.assets, depth + 1);
      }
      if (
        typeof row.id !== 'number' ||
        !Number.isSafeInteger(row.id) ||
        row.id <= 0 ||
        typeof row.name !== 'string' ||
        typeof row.size !== 'number' ||
        !Number.isSafeInteger(row.size) ||
        row.size < 0 ||
        row.size > 64 * 1024 * 1024
      ) {
        continue;
      }
      const blob = /^([a-f0-9]{64})\.blob$/.exec(row.name);
      if (
        !blob &&
        !/^patch-(?:[a-f0-9]{64}-(?:stable|beta)|base)-(?:win32|linux|darwin)-(?:x64|ia32|arm64)\.json$/.test(
          row.name,
        )
      ) {
        continue;
      }
      let publicUrl: string | undefined;
      try {
        const url = new URL(
          typeof row.browser_download_url === 'string' ? row.browser_download_url : '',
        );
        if (
          url.origin === 'https://github.com' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname.startsWith(
            '/BattlyLauncher/battlylauncher/releases/download/battly-patch-',
          ) &&
          url.pathname.endsWith('/' + row.name)
        ) {
          publicUrl = url.href;
        }
      } catch {
        /* Public download URL is optional. The CDN still uses a fixed path. */
      }
      if (!assets.has(row.id) && assets.size >= 10_000) {
        assets.delete(assets.keys().next().value!);
      }
      assets.set(row.id, {
        size: row.size,
        resource: blob ? `blobs/${blob[1]}` : `manifests/${row.id}.json`,
        publicUrl,
      });
    }
  }
  async function boundedResponse(
    response: Response,
    limit: number,
    json: boolean,
  ): Promise<Response> {
    if (!response.body) {
      throw Error('El índice de parches está vacío');
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get('content-length')) > limit) {
        throw Error('Descarga demasiado grande');
      }
      for (;;) {
        const part = await reader.read();
        if (part.done) {
          break;
        }
        size += part.value.length;
        if (size > limit) {
          throw Error('Descarga demasiado grande');
        }
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (json) {
      remember(JSON.parse(bytes.toString('utf8')));
    }
    return new Response(bytes, {
      headers: { 'content-type': json ? 'application/json' : 'application/octet-stream' },
    });
  }
  function recordLimit(response: Response): void {
    if (![403, 429].includes(response.status)) {
      return;
    }
    const after = response.headers.get('retry-after');
    const seconds =
      after && /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after || '') - now();
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - now();
    const delay = Math.max(
      Number.isFinite(seconds) ? seconds : 0,
      Number.isFinite(reset) ? reset : 0,
      300_000,
    );
    githubBlockedUntil = now() + Math.min(delay, 3600_000);
  }
  return async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      url.origin !== API ||
      !url.pathname.startsWith(REPOSITORY) ||
      url.username ||
      url.password ||
      (init.method && init.method !== 'GET')
    ) {
      return fetcher(input, init);
    }
    const relative = url.pathname.slice(REPOSITORY.length);
    const page = Number(url.searchParams.get('page'));
    let resource: string | undefined;
    let limit = 0;
    let assetLimit = 2_100_000;
    let publicUrl: string | undefined;
    if (
      relative === 'releases' &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= 10 &&
      url.searchParams.get('per_page') === '10'
    ) {
      resource = `releases-${page}.json`;
      limit = 8_000_000;
    }
    const listing = /^releases\/(\d+)\/assets$/.exec(relative);
    if (
      listing &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= 10 &&
      url.searchParams.get('per_page') === '100'
    ) {
      resource = `releases/${listing[1]}/assets-${page}.json`;
      limit = 2_100_000;
    }
    const asset = /^releases\/assets\/(\d+)$/.exec(relative);
    if (asset) {
      const location = assets.get(Number(asset[1]));
      resource = location?.resource || `manifests/${asset[1]}.json`;
      publicUrl = location?.publicUrl;
      assetLimit = location?.size ?? assetLimit;
    }
    if (!resource) {
      return fetcher(input, init);
    }
    init.signal?.throwIfAborted();
    const signal = AbortSignal.any([
      ...(init.signal ? [init.signal] : []),
      AbortSignal.timeout(limit ? 6000 : 120_000),
    ]);
    let response: Response | undefined;
    try {
      response = await fetcher(new URL(resource, CDN).href, {
        redirect: 'error',
        signal,
        headers: { Accept: limit ? 'application/json' : 'application/octet-stream' },
      });
    } catch {
      init.signal?.throwIfAborted();
    }
    if (response?.ok) {
      try {
        return await boundedResponse(response, limit || assetLimit, Boolean(limit));
      } catch (error) {
        init.signal?.throwIfAborted();
        if (
          !(error instanceof TypeError) &&
          !(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
        ) {
          throw error;
        }
      }
    }
    await response?.body?.cancel().catch(() => {});
    init.signal?.throwIfAborted();
    if (!publicUrl && now() < githubBlockedUntil) {
      throw Error(
        'GitHub ha limitado las peticiones y la CDN no está disponible. Se volverá a intentar más tarde.',
      );
    }
    // Public asset URLs avoid the REST quota even while GitHub serves as backup.
    const fallback = await fetcher(
      publicUrl || input,
      publicUrl
        ? {
            redirect: 'manual',
            signal: AbortSignal.any([
              ...(init.signal ? [init.signal] : []),
              AbortSignal.timeout(120_000),
            ]),
            headers: { Accept: 'application/octet-stream' },
          }
        : {
            ...init,
            redirect: 'manual',
            signal: AbortSignal.any([
              ...(init.signal ? [init.signal] : []),
              AbortSignal.timeout(limit ? 6000 : 120_000),
            ]),
          },
    );
    if (!publicUrl) {
      recordLimit(fallback);
    }
    return fallback.ok ? boundedResponse(fallback, limit || assetLimit, Boolean(limit)) : fallback;
  };
}
