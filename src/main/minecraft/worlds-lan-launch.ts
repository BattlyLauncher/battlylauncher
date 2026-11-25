import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import type { MinecraftDirectConnectServer } from '../../shared/minecraft/launch-contract';
import type { MinecraftLaunchOptions } from './launcher-adapter';
import { writeFileAtomically } from '../files/atomic-file';

export function supportsOpenWorldsRoom(options: MinecraftLaunchOptions): boolean {
  return !options.installOnly;
}

/** Shares the current room with games that were already running when the tunnel opened. */
export class WorldsLanRoomLease {
  readonly path: string;
  #address = '';
  #timer?: ReturnType<typeof setInterval>;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, `room-${randomUUID()}.lease`);
  }

  update(room?: WorldsSnapshot): void {
    const port = Number(/^127\.0\.0\.1:(\d{1,5})$/.exec(room?.address ?? '')?.[1]);
    const address =
      room?.state === 'joined' && room.code && port >= 1 && port <= 65535
        ? `127.0.0.1:${port}`
        : '';
    if (address === this.#address) {
      return;
    }
    clearInterval(this.#timer);
    this.#address = address;
    if (!address) {
      try {
        rmSync(this.path, { force: true });
      } catch {
        // The previous lease expires even when the file cannot be removed.
      }
      return;
    }
    const refresh = () => {
      const pending = this.path + '.pending';
      try {
        writeFileSync(pending, `${this.#address}\n${Date.now() + 15000}\n`, { mode: 0o600 });
        renameSync(pending, this.path);
      } catch {
        // A failed refresh expires by itself in the game.
      }
    };
    refresh();
    this.#timer = setInterval(refresh, 5000);
    this.#timer.unref();
  }
}

/** A renderer cannot turn arbitrary server connections into LAN connections. */
export function withWorldsLanConnection(
  options: MinecraftLaunchOptions,
  server: MinecraftDirectConnectServer | null | undefined,
  room: WorldsSnapshot | undefined,
  agentPath: string,
  roomLeasePath?: string,
): MinecraftLaunchOptions {
  if (roomLeasePath && supportsOpenWorldsRoom(options) && existsSync(agentPath)) {
    return {
      ...options,
      javaArguments: [
        ...options.javaArguments,
        `-javaagent:${agentPath}=room-file:${roomLeasePath}`,
      ],
    };
  }
  if (
    !server ||
    server.host !== '127.0.0.1' ||
    room?.state !== 'joined' ||
    room.address !== `127.0.0.1:${server.port}` ||
    !room.code
  ) {
    return options;
  }
  if (!existsSync(agentPath)) {
    throw new Error('Worlds LAN connection adapter is missing');
  }
  return {
    ...options,
    javaArguments: [...options.javaArguments, `-javaagent:${agentPath}=127.0.0.1:${server.port}`],
  };
}

export async function worldsLanAgentPath(
  resources: string,
  compiledDirectory: string,
  destination: string,
): Promise<string> {
  const patchAsset = join(compiledDirectory, 'minecraft', 'compatibility', 'worlds-lan-agent.jar');
  if (existsSync(patchAsset)) {
    const bytes = await readFile(patchAsset);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const cached = join(destination, digest, 'worlds-lan-agent.jar');
    if (!(await readFile(cached).catch(() => null))?.equals(bytes)) {
      await writeFileAtomically(cached, bytes);
    }
    return cached;
  }
  const development = join(
    compiledDirectory,
    '..',
    '..',
    'build-resources',
    'worlds-lan',
    'worlds-lan-agent.jar',
  );
  if (existsSync(development)) {
    return development;
  }
  const packaged = join(resources, 'worlds-lan', 'worlds-lan-agent.jar');
  return packaged;
}
