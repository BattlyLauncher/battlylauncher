import { isAbsolute, resolve } from 'node:path';

import {
  isValidAccountId,
  normalizeAccountCollection,
  type AccountCollection,
} from '../../shared/accounts/account';
import { parseLegacyStorageDocument, type JsonValue } from '../../shared/storage/legacy-storage';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { enqueueProfileWrite } from '../storage/profile-write-queue';

const maxStoreBytes = 16 * 1024 * 1024;

export class AccountStore {
  readonly #storePath: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(storePath: string) {
    if (!isAbsolute(storePath)) {
      throw new TypeError('Account store path must be absolute');
    }
    this.#storePath = resolve(storePath);
  }

  async #readValues(): Promise<Record<string, JsonValue>> {
    const content = await readBoundedRegularFile(this.#storePath, maxStoreBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString('utf8')) as unknown;
    } catch {
      throw new TypeError('Account store is not valid JSON');
    }
    return { ...parseLegacyStorageDocument(parsed).values };
  }

  async list(): Promise<AccountCollection> {
    await this.#writeQueue;
    return normalizeAccountCollection(await this.#readValues());
  }

  async getInternal(uuid: string): Promise<Readonly<Record<string, JsonValue>> | null> {
    if (!isValidAccountId(uuid)) {
      throw new TypeError('Invalid account id');
    }
    await this.#writeQueue;
    const values = await this.#readValues();
    if (!Array.isArray(values.accounts)) {
      return null;
    }
    const account = values.accounts.find(
      (candidate) =>
        candidate !== null &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        candidate.uuid === uuid,
    );
    return account && typeof account === 'object' && !Array.isArray(account)
      ? { ...account }
      : null;
  }

  async selectedInternal(): Promise<Readonly<Record<string, JsonValue>> | null> {
    await this.#writeQueue;
    const values = await this.#readValues();
    const selected = normalizeAccountCollection(values).selectedAccountUuid;
    if (!selected || !Array.isArray(values.accounts)) {
      return null;
    }
    for (const candidate of values.accounts) {
      if (
        candidate !== null &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        candidate.uuid === selected
      ) {
        return { ...candidate };
      }
    }
    return null;
  }

  async selectedBattlyInternal(): Promise<Readonly<Record<string, JsonValue>> | null> {
    await this.#writeQueue;
    const values = await this.#readValues();
    if (!Array.isArray(values.accounts)) {
      return null;
    }
    const collection = normalizeAccountCollection(values);
    const selected = collection.accounts.find(
      (account) => account.uuid === collection.selectedAccountUuid,
    );
    const candidates = values.accounts.filter(
      (candidate): candidate is Record<string, JsonValue> =>
        candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate),
    );
    const battly = candidates.filter(
      (candidate) => candidate.type === 'battly' && typeof candidate.token === 'string',
    );
    const selectedBattly = battly.find((candidate) => candidate.uuid === selected?.uuid);
    const matchingName = battly.find((candidate) => candidate.name === selected?.name);
    const fallback = selectedBattly ?? matchingName ?? battly[0];
    return fallback ? { ...fallback } : null;
  }

  add(account: Readonly<Record<string, JsonValue>>): Promise<AccountCollection> {
    return this.#save(account, false);
  }

  saveAuthenticated(account: Readonly<Record<string, JsonValue>>): Promise<AccountCollection> {
    return this.#save(account, true);
  }

  #save(
    account: Readonly<Record<string, JsonValue>>,
    refreshExisting: boolean,
  ): Promise<AccountCollection> {
    return this.#enqueue((values) => {
      const projected = normalizeAccountCollection({ accounts: [account] });
      const validated = projected.accounts[0];
      if (!validated) {
        throw new TypeError('Authentication provider returned an invalid account');
      }
      const sourceAccounts = values.accounts;
      if (sourceAccounts !== undefined && !Array.isArray(sourceAccounts)) {
        throw new TypeError('Account store has no valid account list');
      }
      const existing = normalizeAccountCollection(values).accounts.find(
        (candidate) => candidate.uuid === validated.uuid,
      );
      if (existing) {
        if (!refreshExisting) {
          throw new TypeError('Account already exists');
        }
        if (existing.type !== validated.type || validated.type === 'unknown') {
          throw new TypeError('Authenticated account conflicts with an existing account type');
        }
        // Replace credentials only after the provider authenticated this identity.
        // Do not merge stale tokens or overwrite another account with the same name.
        values.accounts = (sourceAccounts ?? []).map((candidate) =>
          candidate !== null &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          candidate.uuid === validated.uuid
            ? { ...account }
            : candidate,
        );
      } else {
        values.accounts = [...(sourceAccounts ?? []), { ...account }];
      }
      values['selected-account'] = validated.uuid;
    });
  }

  select(uuid: string): Promise<AccountCollection> {
    return this.#mutate(uuid, (values, accounts) => {
      if (!accounts.accounts.some((account) => account.uuid === uuid)) {
        throw new TypeError('Account not found');
      }
      values['selected-account'] = uuid;
    });
  }

  remove(uuid: string): Promise<AccountCollection> {
    return this.#mutate(uuid, (values, accounts) => {
      if (!accounts.accounts.some((account) => account.uuid === uuid)) {
        throw new TypeError('Account not found');
      }
      const sourceAccounts = values.accounts;
      if (!Array.isArray(sourceAccounts)) {
        throw new TypeError('Account store has no account list');
      }
      values.accounts = sourceAccounts.filter(
        (candidate) =>
          candidate === null ||
          typeof candidate !== 'object' ||
          Array.isArray(candidate) ||
          candidate.uuid !== uuid,
      );
      if (values['selected-account'] === uuid) {
        delete values['selected-account'];
      }
    });
  }

  removeAll(): Promise<AccountCollection> {
    return this.#enqueue((values) => {
      values.accounts = [];
      delete values['selected-account'];
    });
  }

  #mutate(
    uuid: string,
    mutation: (values: Record<string, JsonValue>, accounts: AccountCollection) => void,
  ): Promise<AccountCollection> {
    if (!isValidAccountId(uuid)) {
      return Promise.reject(new TypeError('Invalid account id'));
    }
    return this.#enqueue((values) => {
      mutation(values, normalizeAccountCollection(values));
    });
  }

  #enqueue(
    mutation: (values: Record<string, JsonValue>) => void | Promise<void>,
  ): Promise<AccountCollection> {
    let result: AccountCollection | undefined;
    const operation = this.#writeQueue.then(() =>
      enqueueProfileWrite(this.#storePath, async () => {
        const values = await this.#readValues();
        await mutation(values);
        await writeFileAtomically(this.#storePath, `${JSON.stringify(values, null, 2)}\n`);
        result = normalizeAccountCollection(values);
      }),
    );
    this.#writeQueue = operation.catch(() => undefined);
    return operation.then(() => {
      if (!result) {
        throw new Error('Account mutation did not complete');
      }
      return result;
    });
  }
}
