import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { readPrivateFileWindow } from '../files/read-private-file-window';

import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import {
  appendPrivateData as appendFile,
  readBoundedRegularFile,
  writeFileAtomically,
} from '../files/atomic-file';

const maximumLogBytes = 64 * 1024 * 1024;

export interface LaunchLogFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: number;
  readonly version?: string;
  readonly instanceId?: string;
  readonly startedAt?: number;
}

export interface LaunchLogDocument extends LaunchLogFile {
  readonly content: string;
  readonly truncated: boolean;
}

export interface LaunchLogSession {
  readonly id: string;
  readonly path: string;
  readonly startedAt: number;
  close(): Promise<void>;
  record(event: MinecraftLaunchEvent): void;
}

function absoluteDirectory(path: string): string {
  if (!path || !isAbsolute(path)) {
    throw new TypeError('Launch log root must be absolute');
  }
  return resolve(path);
}

async function assertRealDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new TypeError('Launch log root must be a real directory');
  }
}

function serialize(event: MinecraftLaunchEvent): string {
  return `${JSON.stringify({ timestamp: new Date().toISOString(), event })}\n`;
}

export class LaunchLogService {
  readonly #root: string;
  readonly #metadata = new Map<
    string,
    { size: number; modifiedAt: number; value: Partial<LaunchLogFile> }
  >();

  constructor(root: string) {
    this.#root = absoluteDirectory(root);
  }

  get root(): string {
    return this.#root;
  }

  async #describe(id: string, size: number, modifiedAt: number): Promise<LaunchLogFile> {
    const cached = this.#metadata.get(id);
    let metadata = cached?.value;
    if (
      !cached ||
      (!metadata?.version && (cached.size !== size || cached.modifiedAt !== modifiedAt))
    ) {
      let header: Record<string, unknown> = {};
      let source = '';
      try {
        header = JSON.parse(
          (await readBoundedRegularFile(join(this.#root, `${id}.meta.json`), 8192)).toString(
            'utf8',
          ),
        ) as Record<string, unknown>;
      } catch {
        // Older launches did not write a metadata sidecar. Inspect them once and cache the result.
        source = (await readPrivateFileWindow(join(this.#root, id), 65536)).content.toString(
          'utf8',
        );
        try {
          header = JSON.parse(source.split('\n', 1)[0]) as Record<string, unknown>;
        } catch {
          /* A damaged header does not hide an otherwise readable log. */
        }
      }
      if (!header || typeof header !== 'object' || Array.isArray(header)) {
        header = {};
      }
      let version = typeof header.version === 'string' ? header.version.slice(0, 128) : undefined;
      if (!version) {
        for (const line of source.split('\n')) {
          try {
            const entry = JSON.parse(line) as { event?: { message?: string } };
            const message = entry.event?.message;
            if (!message) {
              continue;
            }
            const marker = message.indexOf('[launch-context] ');
            if (marker >= 0) {
              const context = JSON.parse(message.slice(marker + 17)) as {
                minecraft?: { id?: string };
                loader?: { type?: string; enabled?: boolean };
              };
              if (typeof context.minecraft?.id === 'string') {
                version =
                  `${context.minecraft.id} ${context.loader?.enabled ? (context.loader.type ?? '') : ''}`
                    .trim()
                    .slice(0, 128);
              }
            } else {
              const match = /^\[versi[oó]n\]\s+(.{1,128})/i.exec(message);
              if (match) {
                version = match[1];
              }
            }
            if (version) {
              break;
            }
          } catch {
            /* Ignore non-JSON legacy lines. */
          }
        }
      }
      metadata = {
        ...(version ? { version } : {}),
        ...(typeof header.instanceId === 'string'
          ? { instanceId: header.instanceId.slice(0, 128) }
          : {}),
        ...(typeof header.timestamp === 'string' && Number.isFinite(Date.parse(header.timestamp))
          ? { startedAt: Date.parse(header.timestamp) }
          : {}),
      };
      if (this.#metadata.size >= 1000) {
        this.#metadata.delete(this.#metadata.keys().next().value!);
      }
      this.#metadata.set(id, { size, modifiedAt, value: metadata });
    }
    return { id, name: id.replace(/\.jsonl$/i, ''), size, modifiedAt, ...metadata };
  }

  async list(): Promise<readonly LaunchLogFile[]> {
    await mkdir(this.#root, { recursive: true });
    await assertRealDirectory(this.#root);
    const entries = await readdir(this.#root, { withFileTypes: true });
    const candidates = entries.filter(
      (entry) => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\.jsonl$/.test(entry.name),
    );
    const files: LaunchLogFile[] = [];
    // Legacy logs need decrypting on their first inspection. Keep disk and memory use bounded.
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const batch = await Promise.all(
        candidates.slice(offset, offset + 4).map(async (entry) => {
          try {
            const info = await lstat(join(this.#root, entry.name));
            if (!info.isFile() || info.isSymbolicLink()) {
              return null;
            }
            return await this.#describe(entry.name, info.size, info.mtimeMs);
          } catch {
            // One damaged or removed file must not prevent reading the other sessions.
            return null;
          }
        }),
      );
      files.push(...batch.filter((file): file is LaunchLogFile => file !== null));
    }
    return files.sort((left, right) => right.modifiedAt - left.modifiedAt);
  }

  async read(id: string): Promise<LaunchLogDocument> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\.jsonl$/.test(id)) {
      throw new TypeError('Invalid launch log id');
    }
    await assertRealDirectory(this.#root);
    const info = await lstat(join(this.#root, id));
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Launch log does not exist');
    }
    const file = await this.#describe(id, info.size, info.mtimeMs);
    const tail = await readPrivateFileWindow(join(this.#root, id), 512 * 1024, true);
    const content = tail.content.toString('utf8');
    const truncated = tail.truncated || /"type"\s*:\s*"truncated"/.test(content);
    return { ...file, content, truncated };
  }

  async start(instanceId: string, version?: string): Promise<LaunchLogSession> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(instanceId)) {
      throw new TypeError('Invalid instance id for launch log');
    }
    await mkdir(this.#root, { recursive: true });
    await assertRealDirectory(this.#root);
    const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const path = join(this.#root, `${id}.jsonl`);
    const metadata = {
      timestamp: new Date().toISOString(),
      instanceId,
      type: 'session',
      ...(version ? { version: version.slice(0, 128) } : {}),
    };
    const header = `${JSON.stringify(metadata)}\n`;
    await writeFileAtomically(path, header);
    await writeFileAtomically(`${path}.meta.json`, JSON.stringify(metadata));
    let queue = Promise.resolve();
    let closed = false;
    let truncated = false;
    let writtenBytes = Buffer.byteLength(header);
    const progressCheckpoints = new Map<string, number>();
    return {
      id,
      path,
      startedAt: Date.now(),
      record(event): void {
        if (closed) {
          return;
        }
        if (event.type === 'progress') {
          const previous = progressCheckpoints.get(event.item);
          const threshold = Math.max(256 * 1024, Math.ceil(event.total / 100));
          if (
            previous !== undefined &&
            event.current < event.total &&
            event.current >= previous &&
            event.current - previous < threshold
          ) {
            return;
          }
          progressCheckpoints.set(event.item, event.current);
        }
        const line = serialize(event);
        const lineBytes = Buffer.byteLength(line);
        if (writtenBytes + lineBytes > maximumLogBytes) {
          if (!truncated) {
            truncated = true;
            queue = queue.then(() =>
              appendFile(
                path,
                `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'truncated' })}\n`,
              ),
            );
          }
          return;
        }
        writtenBytes += lineBytes;
        queue = queue.then(() => appendFile(path, line));
      },
      async close(): Promise<void> {
        closed = true;
        await queue;
      },
    };
  }
}
