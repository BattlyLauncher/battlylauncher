import { join } from 'node:path';

import {
  normalizeServerId,
  normalizeServerPlayerListMutation,
  type ServerPlayerEntry,
  type ServerPlayerListKind,
  type ServerPlayerListsSnapshot,
} from '../../shared/servers/server-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ServerStore } from './server-store';

const maximumListBytes = 4 * 1024 * 1024;
const maximumEntries = 10_000;
const files: Readonly<Record<ServerPlayerListKind, string>> = {
  banned: 'banned-players.json',
  whitelist: 'whitelist.json',
  blacklist: 'blacklist.json',
  operators: 'ops.json',
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function player(value: unknown): ServerPlayerEntry | null {
  const source = record(value);
  if (!source) {
    return null;
  }
  const name = own(source, 'name');
  const uuid = own(source, 'uuid');
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_]{1,16}$/.test(name)) {
    return null;
  }
  if (
    typeof uuid !== 'string' ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(uuid)
  ) {
    return null;
  }
  return {
    name,
    uuid: uuid.toLowerCase(),
    created:
      optionalText(own(source, 'created'), 128) ??
      optionalText(own(source, 'added'), 128) ??
      optionalText(own(source, 'expiresOn'), 128),
    reason: optionalText(own(source, 'reason'), 256),
  };
}

async function readEntries(path: string): Promise<ServerPlayerEntry[]> {
  if (!(await pathExists(path))) {
    return [];
  }
  const parsed = JSON.parse(
    (await readBoundedRegularFile(path, maximumListBytes)).toString('utf8'),
  ) as unknown;
  if (!Array.isArray(parsed)) {
    throw new TypeError('Server player list must be an array');
  }
  const entries: ServerPlayerEntry[] = [];
  for (const value of parsed.slice(0, maximumEntries)) {
    const entry = player(value);
    if (entry && !entries.some((candidate) => candidate.uuid === entry.uuid)) {
      entries.push(entry);
    }
  }
  return entries;
}

function serialized(kind: ServerPlayerListKind, entries: readonly ServerPlayerEntry[]): string {
  const values = entries.map((entry) => {
    if (kind === 'banned') {
      return {
        uuid: entry.uuid,
        name: entry.name,
        created: entry.created ?? new Date().toISOString(),
        source: 'BattlyPanel',
        expires: 'forever',
        reason: entry.reason ?? 'Baneado desde Battly',
      };
    }
    if (kind === 'operators') {
      return { uuid: entry.uuid, name: entry.name, level: 4, bypassesPlayerLimit: false };
    }
    if (kind === 'blacklist') {
      return { uuid: entry.uuid, name: entry.name, created: entry.created };
    }
    return { uuid: entry.uuid, name: entry.name };
  });
  return `${JSON.stringify(values, null, 2)}\n`;
}

export class ServerPlayerListService {
  readonly #store: ServerStore;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(store: ServerStore) {
    this.#store = store;
  }

  async snapshot(idValue: unknown): Promise<ServerPlayerListsSnapshot> {
    const id = normalizeServerId(idValue);
    await this.#writeQueue;
    return this.#snapshotUnlocked(id);
  }

  async #snapshotUnlocked(id: string): Promise<ServerPlayerListsSnapshot> {
    const directory = await this.#store.directoryPathInternal(id);
    const [banned, whitelist, blacklist, operators, history] = await Promise.all([
      readEntries(join(directory, files.banned)),
      readEntries(join(directory, files.whitelist)),
      readEntries(join(directory, files.blacklist)),
      readEntries(join(directory, files.operators)),
      readEntries(join(directory, 'usercache.json')),
    ]);
    return { lists: { banned, whitelist, blacklist, operators }, history };
  }

  mutate(idValue: unknown, mutationValue: unknown): Promise<ServerPlayerListsSnapshot> {
    const id = normalizeServerId(idValue);
    const mutation = normalizeServerPlayerListMutation(mutationValue);
    return this.#enqueue(async () => {
      const directory = await this.#store.directoryPathInternal(id);
      const path = join(directory, files[mutation.kind]);
      const entries = await readEntries(path);
      const index = entries.findIndex((entry) => entry.uuid === mutation.uuid);
      if (mutation.action === 'add' && index === -1) {
        entries.push({
          name: mutation.name,
          uuid: mutation.uuid,
          created: new Date().toISOString(),
          reason: mutation.kind === 'banned' ? 'Baneado desde Battly' : null,
        });
      }
      if (mutation.action === 'remove' && index >= 0) {
        entries.splice(index, 1);
      }
      await writeFileAtomically(path, serialized(mutation.kind, entries));
      return this.#snapshotUnlocked(id);
    });
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
