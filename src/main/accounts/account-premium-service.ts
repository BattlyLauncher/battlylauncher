import type { AccountCollection } from '../../shared/accounts/account';
import { battlyPremiumUrl, readBattlyPremium } from '../auth/battly-auth-common';

/** Refresh UI entitlements without changing game credentials or the legacy profile. */
export class AccountPremiumService {
  #cache = new Map<string, { premium: boolean; until: number }>();
  #pending = new Map<string, Promise<boolean>>();
  constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async refresh(collection: AccountCollection): Promise<AccountCollection> {
    return {
      ...collection,
      accounts: await Promise.all(
        collection.accounts.map(async (account) => {
          if (account.type !== 'battly') {
            return account;
          }
          const key = account.name.toLowerCase();
          const cached = this.#cache.get(key);
          if (cached && cached.until > this.clock()) {
            return { ...account, premium: cached.premium };
          }
          let pending = this.#pending.get(key);
          if (!pending) {
            pending = readBattlyPremium(
              this.fetchImplementation,
              battlyPremiumUrl,
              account.name,
              AbortSignal.timeout(6000),
            )
              .then((premium) => {
                this.#cache.set(key, { premium, until: this.clock() + 60_000 });
                return premium;
              })
              .catch(() => {
                const premium = cached?.premium ?? account.premium;
                this.#cache.set(key, { premium, until: this.clock() + 15_000 });
                return premium;
              })
              .finally(() => this.#pending.delete(key));
            this.#pending.set(key, pending);
          }
          return { ...account, premium: await pending };
        }),
      ),
    };
  }
}
