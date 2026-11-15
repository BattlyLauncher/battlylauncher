import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import {
  normalizeServerDraft,
  normalizeServerId,
  normalizeServerProperties,
  normalizeServerSoftware,
  normalizeServerSummary,
  serverIdPattern,
  type ServerProperties,
  type ServerSummary,
} from '../../shared/servers/server-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ServerAccountRegistry } from './server-account-registry';

const maximumServers = 100;
const maximumMetadataBytes = 1024 * 1024;

async function realDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError('Invalid server directory');
  }
}

async function metadata(path: string): Promise<Record<string, unknown>> {
  const buffer = await readBoundedRegularFile(path, maximumMetadataBytes);
  const parsed = JSON.parse(buffer.toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Server metadata must be an object');
  }
  return parsed as Record<string, unknown>;
}

export class ServerStore {
  readonly #archiveRoot: string;
  readonly #root: string;
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #registry?: ServerAccountRegistry;

  constructor(root: string, archiveRoot: string, registry?: ServerAccountRegistry) {
    this.#registry = registry;
    if (!isAbsolute(root) || !isAbsolute(archiveRoot)) {
      throw new TypeError('Server paths must be absolute');
    }
    this.#root = resolve(root);
    this.#archiveRoot = resolve(archiveRoot);
    if (this.#root === this.#archiveRoot) {
      throw new TypeError('Server paths must be different');
    }
  }

  async list(): Promise<ServerSummary[]> {
    await this.#writeQueue;
    return this.#listUnlocked();
  }

  async #listUnlocked(): Promise<ServerSummary[]> {
    await mkdir(this.#root, { recursive: true });
    await realDirectory(this.#root);
    const entries = await readdir(this.#root, { withFileTypes: true });
    const servers: ServerSummary[] = [];
    for (const entry of entries.slice(0, maximumServers)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !serverIdPattern.test(entry.name)) {
        continue;
      }
      try {
        servers.push(
          normalizeServerSummary(
            entry.name,
            await metadata(join(this.#root, entry.name, 'server.json')),
          ),
        );
      } catch {
        // An incomplete legacy server stays on disk and is not exposed to the renderer.
      }
    }
    if (this.#registry) {
      const authorized = (await this.#registry.list(servers)).map((server) => {
        const local = servers.find(
          (entry) => entry.id === server.id || entry.domain === server.domain,
        );
        return {
          ...server,
          ...(local?.eulaAccepted ? { eulaAccepted: true } : {}),
          // A hardware limit belongs to this PC, including when an older API omits it.
          ...(local?.properties.maxCpuPercent !== undefined
            ? {
                properties: { ...server.properties, maxCpuPercent: local.properties.maxCpuPercent },
              }
            : {}),
        };
      });
      for (const server of authorized) {
        const directory = join(this.#root, server.id);
        const legacy = servers.find(
          (entry) => entry.id !== server.id && entry.domain === server.domain,
        );
        if (legacy && !(await pathExists(directory))) {
          // The account may have registered this server from another PC first.
          // Bind its existing local files to the API id instead of starting an empty world.
          const previous = join(this.#root, legacy.id);
          await realDirectory(previous);
          await rename(previous, directory);
        }
        await mkdir(directory, { recursive: true });
        await realDirectory(directory);
        const cached = servers.find((entry) => entry.id === server.id);
        if (!cached || JSON.stringify(cached) !== JSON.stringify(server)) {
          await writeFileAtomically(
            join(directory, 'server.json'),
            `${JSON.stringify(server, null, 2)}\n`,
          );
        }
        if (!(await pathExists(join(directory, 'server.properties')))) {
          await writeFileAtomically(
            join(directory, 'server.properties'),
            this.#serializeProperties(server.properties, server.port) + 'online-mode=false\n',
          );
        }
      }
      return authorized;
    }
    return servers.sort((left, right) => left.name.localeCompare(right.name));
  }

  create(value: unknown, accountLimit = maximumServers): Promise<ServerSummary[]> {
    const draft = normalizeServerDraft(value);
    if (!Number.isInteger(accountLimit) || accountLimit < 1 || accountLimit > maximumServers) {
      throw new TypeError('Invalid server limit');
    }
    return this.#enqueue(async () => {
      if ((await this.#listUnlocked()).length >= accountLimit) {
        throw new Error('Has alcanzado el límite de un servidor por cuenta.');
      }
      await mkdir(this.#root, { recursive: true });
      await realDirectory(this.#root);
      const id = randomUUID().replaceAll('-', '').slice(0, 12);
      const staging = join(this.#root, `.creating-${id}`);
      const target = join(this.#root, id);
      await mkdir(staging);
      try {
        const record = {
          ...draft,
          properties: normalizeServerProperties({ viewDistance: 6, simulationDistance: 4 }),
          software: normalizeServerSoftware(null),
        };
        if (this.#registry) {
          await this.#registry.create(normalizeServerSummary(id, record));
        }
        await writeFileAtomically(
          join(staging, 'server.json'),
          `${JSON.stringify(record, null, 2)}\n`,
        );
        await writeFileAtomically(
          join(staging, 'server.properties'),
          this.#serializeProperties(record.properties, draft.port) + 'online-mode=false\n',
        );
        await rename(staging, target);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
      return this.#listUnlocked();
    });
  }

  updateProperties(idValue: unknown, value: unknown): Promise<ServerSummary[]> {
    const id = normalizeServerId(idValue);
    const properties = normalizeServerProperties(value);
    return this.#enqueue(async () => {
      const directory = await this.#directory(id);
      const current = await metadata(join(directory, 'server.json'));
      const currentSummary = normalizeServerSummary(id, current);
      if (this.#registry) {
        await this.#registry.update(normalizeServerSummary(id, { ...current, properties }));
      }
      await writeFileAtomically(
        join(directory, 'server.json'),
        `${JSON.stringify({ ...current, properties }, null, 2)}\n`,
      );
      await writeFileAtomically(
        join(directory, 'server.properties'),
        this.#mergeProperties(
          (
            await readBoundedRegularFile(join(directory, 'server.properties'), maximumMetadataBytes)
          ).toString('utf8'),
          properties,
          currentSummary.port,
        ),
      );
      return this.#listUnlocked();
    });
  }

  updateSoftware(idValue: unknown, value: unknown): Promise<ServerSummary[]> {
    const id = normalizeServerId(idValue);
    const software = normalizeServerSoftware(value);
    return this.#enqueue(async () => {
      const directory = await this.#directory(id);
      const current = await metadata(join(directory, 'server.json'));
      normalizeServerSummary(id, current);
      if (this.#registry) {
        await this.#registry.update(normalizeServerSummary(id, { ...current, software }));
      }
      await writeFileAtomically(
        join(directory, 'server.json'),
        `${JSON.stringify({ ...current, software }, null, 2)}\n`,
      );
      return this.#listUnlocked();
    });
  }

  remove(idValue: unknown): Promise<ServerSummary[]> {
    const id = normalizeServerId(idValue);
    return this.#enqueue(async () => {
      await realDirectory(this.#root);
      const directory = await this.#directory(id);
      if (resolve(directory) !== join(this.#root, id)) {
        throw new Error('Invalid deletion path');
      }
      if (this.#registry) {
        await this.#registry.remove(id);
      }
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return this.#listUnlocked();
    });
  }

  archive(idValue: unknown): Promise<ServerSummary[]> {
    const id = normalizeServerId(idValue);
    return this.#enqueue(async () => {
      const directory = await this.#directory(id);
      await mkdir(this.#archiveRoot, { recursive: true });
      await realDirectory(this.#archiveRoot);
      const target = join(this.#archiveRoot, `${id}-${Date.now()}`);
      if (await pathExists(target)) {
        throw new Error('Server archive target already exists');
      }
      if (this.#registry) {
        await this.#registry.remove(id);
      }
      await rename(directory, target);
      return this.#listUnlocked();
    });
  }

  async #directory(id: string): Promise<string> {
    if (this.#registry && !(await this.#listUnlocked()).some((server) => server.id === id)) {
      throw new Error('El servidor no pertenece a la cuenta activa');
    }
    const directory = join(this.#root, id);
    await realDirectory(directory);
    return directory;
  }

  async directoryPathInternal(idValue: unknown): Promise<string> {
    return this.#directory(normalizeServerId(idValue));
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #mergeProperties(existing: string, properties: ServerProperties, port: number): string {
    const updates = new Map(
      this.#serializeProperties(properties, port)
        .split('\n')
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line] as const;
        }),
    );
    // Minecraft and mods add properties of their own. Never discard those on a UI edit.
    const lines = existing.split(/\r?\n/).map((line) => {
      const key = line.match(/^\s*([^#!:=\s]+)\s*[:=]/)?.[1];
      if (!key || !updates.has(key)) {
        return line;
      }
      const replacement = updates.get(key)!;
      updates.delete(key);
      return replacement;
    });
    return [...lines, ...updates.values()].join('\n').replace(/\n*$/, '\n');
  }

  #serializeProperties(properties: ServerProperties, port: number): string {
    return [
      '# Generated by Battly Launcher',
      `server-port=${port}`,
      `max-players=${properties.maxPlayers}`,
      ...(properties.viewDistance !== undefined
        ? [`view-distance=${properties.viewDistance}`]
        : []),
      ...(properties.simulationDistance !== undefined
        ? [`simulation-distance=${properties.simulationDistance}`]
        : []),
      `gamemode=${properties.gamemode}`,
      `difficulty=${properties.difficulty}`,
      `spawn-protection=${properties.spawnProtection}`,
      `pvp=${properties.pvp}`,
      `spawn-animals=${properties.spawnAnimals}`,
      `allow-nether=${properties.allowNether}`,
      `enable-command-block=${properties.enableCommandBlock}`,
      `spawn-monsters=${properties.spawnMonsters}`,
      `force-gamemode=${properties.forceGamemode}`,
      `white-list=${properties.whitelist}`,
      `resource-pack=${properties.resourcePack}`,
      `resource-pack-prompt=${properties.resourcePackPrompt}`,
      '',
    ].join('\n');
  }
}
