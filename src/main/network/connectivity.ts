/** The desktop installs the OS connectivity probe; services remain testable without Electron. */
let probe: () => boolean = () => true;

export function configureConnectivity(value: () => boolean): void {
  probe = value;
}
export function networkAvailable(): boolean {
  return probe();
}

export class OfflineError extends Error {
  readonly code = 'ENETUNREACH';
  constructor() {
    super('BATTLY_OFFLINE');
    this.name = 'OfflineError';
  }
}
export function isNetworkFailure(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 4) {
    return false;
  }
  const code = Reflect.get(error, 'code') as unknown;
  return (
    error instanceof OfflineError ||
    [
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
    ].includes(String(code)) ||
    ['AbortError', 'TimeoutError'].includes(error.name) ||
    /fetch failed|network error/i.test(error.message) ||
    isNetworkFailure(error.cause, depth + 1)
  );
}

/** Local services still work without an external network. Do not probe or send credentials. */
export function connectivityFetch(original: typeof fetch): typeof fetch {
  const unavailable = new Map<string, number>();
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!local && (!networkAvailable() || (unavailable.get(url.origin) ?? 0) > Date.now())) {
      throw new OfflineError();
    }
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const json = headers.get('accept')?.includes('application/json');
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const read = method === 'GET' || method === 'HEAD' || /\/(?:my|public)$/.test(url.pathname);
    const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal =
      json && read
        ? AbortSignal.any([...(originalSignal ? [originalSignal] : []), AbortSignal.timeout(3000)])
        : originalSignal;
    try {
      const response = await original(input, { ...init, ...(signal ? { signal } : {}) });
      unavailable.delete(url.origin);
      return response;
    } catch (error) {
      if (!local && isNetworkFailure(error) && !originalSignal?.aborted) {
        unavailable.set(url.origin, Date.now() + 5000);
        if (unavailable.size > 100) {
          unavailable.delete(unavailable.keys().next().value!);
        }
      }
      throw error;
    }
  };
}
