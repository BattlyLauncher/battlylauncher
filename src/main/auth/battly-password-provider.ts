import type { AuthRequest } from '../../shared/auth/auth-contract';
import type { AuthProvider, AuthenticatedAccount } from './auth-coordinator';
import {
  battlyDataObject,
  isBattlyPremium,
  ownValue,
  parseBattlyAccount,
  readBattlyJson,
  validatedBattlyEndpoint,
} from './battly-auth-common';

interface BattlyPendingCredentials {
  readonly password: string;
  readonly username: string;
}

export class BattlyCredentialsSession {
  #generation = 0;
  #pending: BattlyPendingCredentials | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  begin(): number {
    this.clear();
    return this.#generation;
  }

  set(credentials: BattlyPendingCredentials, generation: number): void {
    if (generation !== this.#generation) {
      return;
    }
    this.#pending = credentials;
    this.#timer = setTimeout(() => this.clear(), 5 * 60_000);
    this.#timer.unref?.();
  }

  read(): BattlyPendingCredentials {
    const pending = this.#pending;
    if (!pending) {
      throw new Error('No Battly two-factor challenge is pending');
    }
    return pending;
  }

  clear(): void {
    this.#generation += 1;
    this.#pending = undefined;
    if (this.#timer) {
      clearTimeout(this.#timer);
    }
    this.#timer = undefined;
  }
}

export interface BattlyPasswordProviderOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly loginUrl?: string;
  readonly premiumUrl?: string;
  readonly session?: BattlyCredentialsSession;
  readonly timeoutMs?: number;
}

export interface BattlyTwoFactorProviderOptions {
  readonly completeUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly premiumUrl?: string;
  readonly session: BattlyCredentialsSession;
  readonly timeoutMs?: number;
}

export class BattlyTwoFactorRequiredError extends Error {
  constructor() {
    super('Battly two-factor authentication required');
    this.name = 'BattlyTwoFactorRequiredError';
  }
}

async function successfulResult(response: Response): Promise<Record<string, unknown>> {
  const result = battlyDataObject(await readBattlyJson(response));
  const status = ownValue(result, 'status');
  if (!response.ok || status !== 'success') {
    const message = ownValue(result, 'message');
    throw new Error(
      typeof message === 'string' && message.length <= 500
        ? message
        : 'Battly authentication failed',
    );
  }
  return result;
}

abstract class BattlyCredentialProvider {
  protected readonly fetchImplementation: typeof fetch;
  protected readonly premiumUrl: string;
  protected readonly timeoutMs: number;

  constructor(options: {
    readonly fetchImplementation?: typeof fetch;
    readonly premiumUrl?: string;
    readonly timeoutMs?: number;
  }) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.premiumUrl = validatedBattlyEndpoint(
      options.premiumUrl ?? 'https://api.battlylauncher.com/api/v2/users/profile/',
    );
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  protected async accountFromResult(
    result: Record<string, unknown>,
    fallbackUsername: string,
    signal: AbortSignal,
  ): Promise<AuthenticatedAccount> {
    const data = battlyDataObject(ownValue(result, 'data'));
    const canonicalName = ownValue(data, 'username');
    if (typeof canonicalName !== 'string') {
      throw new TypeError('Battly authentication returned invalid account data');
    }
    const premium = await isBattlyPremium(
      this.fetchImplementation,
      this.premiumUrl,
      canonicalName,
      signal,
    );
    return parseBattlyAccount(result, fallbackUsername, premium);
  }
}

export class BattlyPasswordProvider extends BattlyCredentialProvider implements AuthProvider {
  readonly method = 'battly-password' as const;
  readonly #loginUrl: string;
  readonly #session: BattlyCredentialsSession;

  constructor(options: BattlyPasswordProviderOptions = {}) {
    super(options);
    this.#loginUrl = validatedBattlyEndpoint(
      options.loginUrl ?? 'https://battlylauncher.com/api/battly/launcher/login',
    );
    this.#session = options.session ?? new BattlyCredentialsSession();
  }

  clearPending(): void {
    this.#session.clear();
  }

  async authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid Battly authentication request');
    }
    const sessionGeneration = this.#session.begin();
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const response = await this.fetchImplementation(this.#loginUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username: request.username, password: request.password }),
      redirect: 'error',
      signal: combinedSignal,
    });
    const result = battlyDataObject(await readBattlyJson(response));
    if (ownValue(result, 'status') === 'requires_2fa') {
      this.#session.set(
        { username: request.username, password: request.password },
        sessionGeneration,
      );
      throw new BattlyTwoFactorRequiredError();
    }
    if (!response.ok || ownValue(result, 'status') !== 'success') {
      const message = ownValue(result, 'message');
      throw new Error(
        typeof message === 'string' ? message.slice(0, 500) : 'Battly authentication failed',
      );
    }
    return this.accountFromResult(result, request.username, combinedSignal);
  }
}

export class BattlyTwoFactorProvider extends BattlyCredentialProvider implements AuthProvider {
  readonly method = 'battly-two-factor' as const;
  readonly #completeUrl: string;
  readonly #session: BattlyCredentialsSession;

  constructor(options: BattlyTwoFactorProviderOptions) {
    super(options);
    this.#completeUrl = validatedBattlyEndpoint(
      options.completeUrl ?? 'https://battlylauncher.com/api/login/2fa/complete',
    );
    this.#session = options.session;
  }

  clearPending(): void {
    this.#session.clear();
  }

  async authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid Battly two-factor authentication request');
    }
    const credentials = this.#session.read();
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const verification =
      request.mode === 'recovery' ? { recoveryCode: request.code } : { token: request.code };
    const response = await this.fetchImplementation(this.#completeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        username: Buffer.from(credentials.username).toString('base64'),
        password: Buffer.from(credentials.password).toString('base64'),
        ...verification,
      }),
      redirect: 'error',
      signal: combinedSignal,
    });
    const result = await successfulResult(response);
    const account = await this.accountFromResult(result, credentials.username, combinedSignal);
    this.#session.clear();
    return account;
  }
}
