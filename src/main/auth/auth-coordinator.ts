import type { AccountCollection } from '../../shared/accounts/account';
import type { AuthMethod, AuthRequest } from '../../shared/auth/auth-contract';
import type { JsonValue } from '../../shared/storage/legacy-storage';
import type { AccountStore } from '../accounts/account-store';

export type AuthenticatedAccount = Readonly<Record<string, JsonValue>>;

export interface AuthProvider {
  readonly method: AuthMethod;
  authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount>;
  clearPending?(): void;
}

export class AuthCancelledError extends Error {
  constructor() {
    super('Authentication cancelled');
    this.name = 'AuthCancelledError';
  }
}

export class AuthCoordinator {
  readonly #accountStore: AccountStore;
  readonly #providers: ReadonlyMap<AuthMethod, AuthProvider>;
  #activeController: AbortController | undefined;

  constructor(accountStore: AccountStore, providers: readonly AuthProvider[]) {
    this.#accountStore = accountStore;
    this.#providers = new Map(providers.map((provider) => [provider.method, provider]));
  }

  async start(request: AuthRequest): Promise<AccountCollection> {
    if (this.#activeController) {
      throw new Error('Authentication already in progress');
    }
    const provider = this.#providers.get(request.method);
    if (!provider) {
      throw new TypeError(`Authentication provider unavailable: ${request.method}`);
    }
    const controller = new AbortController();
    this.#activeController = controller;
    try {
      const account = await provider.authenticate(request, controller.signal);
      if (controller.signal.aborted) {
        throw new AuthCancelledError();
      }
      return request.method === 'offline'
        ? await this.#accountStore.add(account)
        : await this.#accountStore.saveAuthenticated(account);
    } finally {
      if (this.#activeController === controller) {
        this.#activeController = undefined;
      }
    }
  }

  cancel(): boolean {
    const hadActiveAuthentication = this.#activeController !== undefined;
    this.#activeController?.abort();
    for (const provider of this.#providers.values()) {
      provider.clearPending?.();
    }
    return hadActiveAuthentication;
  }
}
