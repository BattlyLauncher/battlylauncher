export type AccountType = 'battly' | 'microsoft' | 'offline' | 'unknown';

export interface AccountSummary {
  readonly name: string;
  readonly offline: boolean;
  readonly premium: boolean;
  readonly selected: boolean;
  readonly type: AccountType;
  readonly uuid: string;
}

export interface AccountCollection {
  readonly accounts: readonly AccountSummary[];
  readonly selectedAccountUuid: string | null;
}

const accountIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxAccounts = 100;

function isValidAccountName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
  );
}

function readOwnValue(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? (descriptor.value as unknown)
    : undefined;
}

export function isValidAccountId(value: unknown): value is string {
  return typeof value === 'string' && accountIdPattern.test(value);
}

function normalizeSelectedAccount(value: unknown): string | null {
  if (isValidAccountId(value)) {
    return value;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const outer = value as Record<string, unknown>;
  const selected = readOwnValue(outer, 'selected');
  if (isValidAccountId(selected)) {
    return selected;
  }
  const nested = readOwnValue(outer, 'value');
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
    return null;
  }
  return normalizeSelectedAccount(nested);
}

function normalizeType(account: Record<string, unknown>): AccountType {
  const directType = readOwnValue(account, 'type');
  let metaType: unknown;
  const meta = readOwnValue(account, 'meta');
  if (meta !== null && typeof meta === 'object' && !Array.isArray(meta)) {
    metaType = readOwnValue(meta as Record<string, unknown>, 'type');
  }
  const type = directType ?? metaType;
  return type === 'battly' || type === 'microsoft' || type === 'offline' ? type : 'unknown';
}

function isOfflineAccount(account: Record<string, unknown>, type: AccountType): boolean {
  if (type === 'offline') {
    return true;
  }
  const meta = readOwnValue(account, 'meta');
  return (
    meta !== null &&
    typeof meta === 'object' &&
    !Array.isArray(meta) &&
    readOwnValue(meta as Record<string, unknown>, 'offline') === true
  );
}

export function normalizeAccountCollection(value: unknown): AccountCollection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { accounts: [], selectedAccountUuid: null };
  }
  const root = value as Record<string, unknown>;
  const sourceAccounts = readOwnValue(root, 'accounts');
  const selectedCandidate = normalizeSelectedAccount(readOwnValue(root, 'selected-account'));
  if (!Array.isArray(sourceAccounts)) {
    return { accounts: [], selectedAccountUuid: null };
  }

  const seenIds = new Set<string>();
  const projected: Omit<AccountSummary, 'selected'>[] = [];
  for (const candidate of sourceAccounts.slice(0, maxAccounts)) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const account = candidate as Record<string, unknown>;
    const uuid = readOwnValue(account, 'uuid');
    const name = readOwnValue(account, 'name');
    if (!isValidAccountId(uuid) || !isValidAccountName(name) || seenIds.has(uuid)) {
      continue;
    }
    seenIds.add(uuid);
    const type = normalizeType(account);
    projected.push({
      uuid,
      name,
      type,
      premium: readOwnValue(account, 'premium') === true,
      offline: isOfflineAccount(account, type),
    });
  }

  const selectedAccountUuid =
    selectedCandidate && seenIds.has(selectedCandidate) ? selectedCandidate : null;
  return {
    accounts: projected.map((account) => ({
      ...account,
      selected: account.uuid === selectedAccountUuid,
    })),
    selectedAccountUuid,
  };
}
