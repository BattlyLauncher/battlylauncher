import type { BattlyProtocolAction } from '../shared/app-protocol';
import { discordLaunchScheme } from '../shared/discord-contract';

export type { BattlyProtocolAction } from '../shared/app-protocol';

const scheme = 'battlylauncher:';

export function battlyProtocolArgument(argv: readonly string[]): string | undefined {
  return argv.find(
    (value) =>
      /^battlylauncher:\/\//i.test(value) ||
      value.toLowerCase().startsWith(`${discordLaunchScheme}://`),
  );
}

export function battlyProtocolAction(value: unknown): BattlyProtocolAction | undefined {
  if (typeof value !== 'string' || value.length > 16_384) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.username || url.password) {
    return undefined;
  }
  if (url.protocol.toLowerCase() === `${discordLaunchScheme}:`) {
    if (`${url.hostname}${url.pathname}`.replace(/\/$/, '') !== 'join') {
      return undefined;
    }
    const secret = url.searchParams.get('secret');
    return secret && /^[a-f0-9]{64}$/.test(secret) ? { type: 'worlds-discord', secret } : undefined;
  }
  if (url.protocol.toLowerCase() !== scheme) {
    return undefined;
  }
  const route = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (route === 'worlds/discord') {
    const secret = url.searchParams.get('secret');
    if (secret && /^[a-f0-9]{64}$/.test(secret)) {
      return { type: 'worlds-discord', secret };
    }
    return undefined;
  }
  if (route === 'ajustes' || route === 'settings') {
    return { type: 'settings' };
  }
  if (route === 'publish-theme') {
    return { type: 'themes', tab: 'share' };
  }
  if (
    route === 'marketplace' ||
    route === 'themes' ||
    route === 'theme' ||
    route.startsWith('theme/')
  ) {
    return { type: 'themes', tab: 'marketplace' };
  }
  // Authentication callbacks use the active Google flow and its nonce, never a URI token.
  return undefined;
}
