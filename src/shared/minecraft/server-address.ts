import type { MinecraftDirectConnectServer } from './launch-contract';

/** Read addresses without interpreting the final IPv6 group as a port. */
export function parseMinecraftServerAddress(
  value: string,
  defaultPort = 25565,
): MinecraftDirectConnectServer | null {
  if (
    value.length > 261 ||
    !Number.isInteger(defaultPort) ||
    defaultPort < 1 ||
    defaultPort > 65535
  ) {
    return null;
  }
  const address = value.trim();
  const bracketed = /^\[([0-9a-f:]+)\](?::(\d{1,5}))?$/i.exec(address);
  const simple = /^([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(address);
  let host: string,
    port = defaultPort;
  if (bracketed || simple) {
    const match = (bracketed ?? simple)!;
    host = match[1];
    if (match[2]) {
      port = Number(match[2]);
    }
  } else if (/^[0-9a-f:]+$/i.test(address) && address.includes(':')) {
    host = address;
  } else {
    return null;
  }
  if (host.length > 253 || port < 1 || port > 65535) {
    return null;
  }
  if (host.includes(':')) {
    try {
      new URL(`http://[${host}]/`);
    } catch {
      return null;
    }
  }
  return { host, port };
}

export function minecraftServerAddress(server: MinecraftDirectConnectServer): string {
  return `${server.host.includes(':') ? `[${server.host}]` : server.host}:${server.port}`;
}
