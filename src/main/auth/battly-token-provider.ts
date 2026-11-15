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

export interface BattlyTokenProviderOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly loginUrl?: string;
  readonly premiumUrl?: string;
  readonly timeoutMs?: number;
}

export class BattlyTokenProvider implements AuthProvider {
  readonly method = 'battly-token' as const;
  readonly #fetch: typeof fetch;
  readonly #loginUrl: string;
  readonly #premiumUrl: string;
  readonly #timeoutMs: number;

  constructor(options: BattlyTokenProviderOptions = {}) {
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#loginUrl = validatedBattlyEndpoint(
      options.loginUrl ?? 'https://battlylauncher.com/api/battly/launcher/loginWithToken',
    );
    this.#premiumUrl = validatedBattlyEndpoint(
      options.premiumUrl ?? 'https://api.battlylauncher.com/api/v2/users/profile/',
    );
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid Battly token request');
    }
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.#timeoutMs)]);
    const response = await this.#fetch(this.#loginUrl, {
      headers: { accept: 'application/json', authorization: `Bearer ${request.token}` },
      redirect: 'error',
      signal: combinedSignal,
    });
    const result = battlyDataObject(await readBattlyJson(response));
    if (!response.ok || ownValue(result, 'status') !== 'success') {
      const message = ownValue(result, 'message');
      throw new Error(typeof message === 'string' ? message.slice(0, 500) : 'Battly login failed');
    }
    const data = battlyDataObject(ownValue(result, 'data'));
    const username = ownValue(data, 'username');
    if (typeof username !== 'string' || !username) {
      throw new TypeError('Battly token response has no username');
    }
    const premium = await isBattlyPremium(this.#fetch, this.#premiumUrl, username, combinedSignal);
    return parseBattlyAccount(result, username, premium);
  }
}
