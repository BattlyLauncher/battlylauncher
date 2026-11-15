import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { AuthRequest } from '../../shared/auth/auth-contract';
import {
  AuthCancelledError,
  type AuthProvider,
  type AuthenticatedAccount,
} from './auth-coordinator';
import {
  battlyDataObject,
  isBattlyPremium,
  ownValue,
  parseBattlyAccount,
  readBattlyJson,
  validatedBattlyEndpoint,
} from './battly-auth-common';

const maxCallbackBytes = 15_000;
const allowedOrigins = new Set(['https://battlylauncher.com', 'https://www.battlylauncher.com']);

export interface BattlyGoogleProviderOptions {
  readonly exchangeUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly loginUrl?: string;
  readonly openExternal: (url: string) => Promise<unknown>;
  readonly premiumUrl?: string;
  readonly timeoutMs?: number;
  readonly onProgress?: (
    phase:
      | 'waiting-browser'
      | 'verifying-code'
      | 'exchanging-session'
      | 'loading-profile'
      | 'account-validated',
  ) => void;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function sendJson(response: ServerResponse, statusCode: number, body: object): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readCallbackBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxCallbackBytes) {
        reject(new TypeError('Google callback is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new TypeError('Google callback is not valid JSON'));
      }
    });
    request.once('error', reject);
  });
}

export class BattlyGoogleProvider implements AuthProvider {
  readonly method = 'battly-google' as const;
  readonly #exchangeUrl: string;
  readonly #fetch: typeof fetch;
  readonly #loginUrl: string;
  readonly #openExternal: (url: string) => Promise<unknown>;
  readonly #premiumUrl: string;
  readonly #timeoutMs: number;
  readonly #onProgress: NonNullable<BattlyGoogleProviderOptions['onProgress']>;

  constructor(options: BattlyGoogleProviderOptions) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#onProgress = options.onProgress ?? (() => undefined);
    this.#openExternal = options.openExternal;
    this.#loginUrl = validatedBattlyEndpoint(
      options.loginUrl ?? 'https://battlylauncher.com/api/battly/google/login',
    );
    this.#exchangeUrl = validatedBattlyEndpoint(
      options.exchangeUrl ?? 'https://battlylauncher.com/api/battly/launcher/loginWithToken',
    );
    this.#premiumUrl = validatedBattlyEndpoint(
      options.premiumUrl ?? 'https://api.battlylauncher.com/api/v2/users/profile/',
    );
    this.#timeoutMs = options.timeoutMs ?? 180_000;
  }

  async authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid Google authentication request');
    }
    if (signal.aborted) {
      throw new AuthCancelledError();
    }
    this.#onProgress(request.code ? 'verifying-code' : 'waiting-browser');
    const nonce = randomBytes(24).toString('base64url');
    const verifiedUser = request.code ? await this.#verifyCode(request.code, signal) : undefined;
    const token = verifiedUser ? undefined : await this.#receiveToken(nonce, signal);
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]);
    this.#onProgress('exchanging-session');
    const response = verifiedUser
      ? undefined
      : await this.#fetchEndpoint(this.#exchangeUrl, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${token}` },
          redirect: 'error',
          signal: combinedSignal,
        });
    if (
      response?.status === 404 &&
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      throw new Error(
        'La web de Battly no tiene disponible la validación de Google. Usa el código del navegador o actualiza la ruta loginWithToken del servidor.',
      );
    }
    const result = verifiedUser
      ? { status: 'success', data: verifiedUser }
      : battlyDataObject(await readBattlyJson(response!));
    const status = ownValue(result, 'status');
    if ((response && !response.ok) || status !== 'success') {
      const message = ownValue(result, 'message');
      throw new Error(
        typeof message === 'string' && message.length <= 500
          ? message
          : 'Google authentication failed',
      );
    }
    const data = battlyDataObject(ownValue(result, 'data'));
    const username = ownValue(data, 'username');
    if (typeof username !== 'string') {
      throw new TypeError('Google authentication returned no user');
    }
    this.#onProgress('loading-profile');
    const premium = await isBattlyPremium(this.#fetch, this.#premiumUrl, username, combinedSignal);
    const account = parseBattlyAccount(result, username, premium);
    this.#onProgress('account-validated');
    return account;
  }

  async #verifyCode(code: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      throw new TypeError('Código de Google inválido');
    }
    const response = await this.#fetchEndpoint(
      new URL('/api/battly/google/verify', this.#loginUrl).href,
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      },
    );
    if (!response.ok) {
      throw new Error('No se pudo verificar el código. Obtén uno nuevo desde Google.');
    }
    const result = battlyDataObject(await readBattlyJson(response));
    if (ownValue(result, 'status') !== 'OK') {
      throw new Error('Código de Google incorrecto o caducado');
    }
    const user = battlyDataObject(ownValue(result, 'user'));
    const token = ownValue(user, 'token');
    if (typeof token !== 'string' || !token || token.length > 8192) {
      throw new Error('Google no devolvió una sesión válida');
    }
    return { username: ownValue(user, 'username'), uuid: ownValue(user, 'uuid'), token };
  }

  async #fetchEndpoint(address: string, options: RequestInit): Promise<Response> {
    const response = await this.#fetch(address, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const source = new URL(address);
    const location = response.headers.get('location');
    await response.body?.cancel();
    const target = location ? new URL(location, source) : undefined;
    // The website adds a language prefix to API routes. Never forward credentials
    // to another origin or to a different endpoint, even within the same website.
    if (
      !target ||
      target.origin !== source.origin ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.pathname.replace(/^\/[a-z]{2}(?:-[A-Za-z]{2})?(?=\/)/, '') !== source.pathname
    ) {
      throw new Error('La web ha redirigido el inicio de sesión a una dirección no permitida.');
    }
    return this.#fetch(target.href, { ...options, redirect: 'error' });
  }

  #receiveToken(nonce: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, token?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        if (server.listening) {
          server.close();
        }
        if (error) {
          reject(error);
        } else if (token) {
          resolve(token);
        } else {
          reject(new Error('Google authentication did not return a token'));
        }
      };
      const onAbort = (): void => finish(new AuthCancelledError());
      const server = createServer((incoming, response) => {
        const origin = incoming.headers.origin;
        if (origin && allowedOrigins.has(origin)) {
          response.setHeader('access-control-allow-origin', origin);
          response.setHeader('vary', 'Origin');
        }
        response.setHeader('cache-control', 'no-store');
        if (origin && !allowedOrigins.has(origin)) {
          sendJson(response, 403, { status: 'forbidden' });
          return;
        }
        if (
          incoming.method === 'OPTIONS' &&
          origin &&
          allowedOrigins.has(origin) &&
          incoming.url === '/auth/google'
        ) {
          if (incoming.headers['access-control-request-private-network'] === 'true') {
            response.setHeader('access-control-allow-private-network', 'true');
          }
          response.setHeader('access-control-allow-methods', 'POST');
          response.setHeader('access-control-allow-headers', 'Content-Type');
          response.writeHead(204);
          response.end();
          return;
        }
        if (incoming.method !== 'POST' || incoming.url !== '/auth/google') {
          sendJson(response, 404, { status: 'not_found' });
          return;
        }
        void readCallbackBody(incoming)
          .then((rawBody) => {
            const body = battlyDataObject(rawBody);
            const callbackNonce = ownValue(body, 'nonce');
            const callbackToken = ownValue(body, 'token');
            if (
              typeof callbackNonce !== 'string' ||
              !safeEqual(callbackNonce, nonce) ||
              typeof callbackToken !== 'string' ||
              !callbackToken ||
              callbackToken.length > 8192
            ) {
              sendJson(response, 400, { status: 'error', message: 'Solicitud inválida' });
              return;
            }
            sendJson(response, 200, { status: 'ok' });
            finish(undefined, callbackToken);
          })
          .catch(() => sendJson(response, 400, { status: 'error', message: 'Body inválido' }));
      });
      const timeout = setTimeout(
        () =>
          finish(
            new Error(
              'No llegó la sesión de Google. Vuelve a pulsar Google e introduce el código que aparece en el navegador.',
            ),
          ),
        this.#timeoutMs,
      );
      signal.addEventListener('abort', onAbort, { once: true });
      server.once('error', (error) => finish(error));
      if (signal.aborted) {
        onAbort();
        return;
      }
      server.listen(0, '127.0.0.1', () => {
        if (settled) {
          server.close();
          return;
        }
        const address = server.address();
        if (!address || typeof address === 'string') {
          finish(new Error('Google callback bridge did not bind'));
          return;
        }
        const loginUrl = new URL(this.#loginUrl);
        loginUrl.searchParams.set('launcher_port', String(address.port));
        loginUrl.searchParams.set('launcher_nonce', nonce);
        void this.#openExternal(loginUrl.toString()).catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error('Could not open Google login'));
        });
      });
    });
  }
}
