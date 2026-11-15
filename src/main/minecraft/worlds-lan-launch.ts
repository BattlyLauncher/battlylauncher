import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldsSnapshot } from '../../shared/social/battly-worlds-contract';
import type { MinecraftDirectConnectServer } from '../../shared/minecraft/launch-contract';
import type { MinecraftLaunchOptions } from './launcher-adapter';

/** A renderer cannot turn arbitrary server connections into LAN connections. */
export function withWorldsLanConnection(
  options: MinecraftLaunchOptions,
  server: MinecraftDirectConnectServer | null | undefined,
  room: WorldsSnapshot | undefined,
  agentPath: string,
): MinecraftLaunchOptions {
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

export function worldsLanAgentPath(resources: string, compiledDirectory: string): string {
  const packaged = join(resources, 'worlds-lan', 'worlds-lan-agent.jar');
  return existsSync(packaged)
    ? packaged
    : join(compiledDirectory, '..', '..', 'build-resources', 'worlds-lan', 'worlds-lan-agent.jar');
}
