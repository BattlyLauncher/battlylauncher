import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readBoundedResponse } from '../network/read-bounded-response';

const battlyWeb = 'https://battlylauncher.com';
const callbackPath = '/google-drive/callback';

export class DriveBrowserUnavailableError extends Error {}

export async function authorizeDriveInBrowser(
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  signal.throwIfAborted();
  const nonce = randomBytes(32).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const transfer = await new Promise<{ code: string; expiry: string; proof: string }>(
    (resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        server.close();
      };
      const fail = (error: unknown): void => {
        finish();
        reject(error instanceof Error ? error : new Error(undefined, { cause: error }));
      };
      const abort = () => fail(signal.reason);
      const server = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const address = server.address();
        const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
        const value = request.url ?? '';
        if (
          request.method !== 'GET' ||
          request.headers.host !== host ||
          !value.startsWith(`${callbackPath}?`)
        ) {
          response.writeHead(404).end();
          return;
        }
        const { searchParams } = new URL(value, battlyWeb);
        const receivedNonce = Buffer.from(searchParams.get('nonce') ?? '');
        if (
          receivedNonce.length !== nonce.length ||
          !timingSafeEqual(receivedNonce, Buffer.from(nonce))
        ) {
          response.writeHead(400).end();
          return;
        }
        if (searchParams.has('error')) {
          response.end('Autorización cancelada. Puedes volver a Battly.');
          fail(new Error('Google no ha autorizado el acceso a Drive'));
          return;
        }
        const code = searchParams.get('code');
        const expiry = searchParams.get('expiry');
        const proof = searchParams.get('proof');
        if (
          !code ||
          code.length > 2048 ||
          !expiry ||
          !/^\d{13}$/.test(expiry) ||
          !proof ||
          !/^[a-f0-9]{64}$/.test(proof)
        ) {
          response.writeHead(400).end();
          return;
        }
        response.end('Vuelve a Battly para terminar de conectar Google Drive.');
        finish();
        resolve({ code, expiry, proof });
      });
      const timeout = setTimeout(
        () => fail(new Error('La autorización de Google ha caducado')),
        300_000,
      );
      signal.addEventListener('abort', abort, { once: true });
      server.once('error', fail);
      server.listen(0, '127.0.0.1', () => {
        if (signal.aborted) {
          server.close();
          return;
        }
        const address = server.address();
        if (!address || typeof address === 'string') {
          fail(new Error('No se pudo preparar la autorización de Google'));
          return;
        }
        const login = new URL('/google-drive/auth', battlyWeb);
        login.searchParams.set('launcher_port', String(address.port));
        login.searchParams.set('launcher_nonce', nonce);
        login.searchParams.set('code_challenge', challenge);
        void fetcher(login.href, {
          redirect: 'manual',
          signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
        })
          .then(async (response) => {
            await response.body?.cancel();
            const destination = new URL(response.headers.get('location') ?? battlyWeb);
            if (
              response.status !== 302 ||
              destination.origin !== 'https://accounts.google.com' ||
              destination.searchParams.get('code_challenge') !== challenge ||
              !destination.searchParams.get('state')
            ) {
              throw new DriveBrowserUnavailableError();
            }
            signal.throwIfAborted();
            await openBrowser(login.href);
          })
          .catch(() => fail(signal.aborted ? signal.reason : new DriveBrowserUnavailableError()));
      });
    },
  );
  const response = await fetcher(`${battlyWeb}/google-drive/desktop/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...transfer, verifier }),
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('No se pudo autorizar Google Drive');
  }
  return JSON.parse(await readBoundedResponse(response, 64 * 1024)) as unknown;
}
