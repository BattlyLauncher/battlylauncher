import { createHash } from 'node:crypto';

import type { JsonValue } from '../../shared/storage/legacy-storage';
import type { AuthenticatedAccount } from './auth-coordinator';

const maxResponseBytes = 1024 * 1024;

export function validatedBattlyEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new TypeError('Battly authentication endpoint must use HTTPS');
  }
  return url.toString();
}

export async function readBattlyJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new TypeError('Battly authentication response is too large');
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (!response.body) {
    throw new TypeError('Battly authentication response has no body');
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      throw new TypeError('Battly authentication response is too large');
    }
    chunks.push(value);
  }
  const content = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(content)) as unknown;
  } catch {
    throw new TypeError('Battly authentication response is not valid JSON');
  }
}

export function battlyDataObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Battly authentication response has no data');
  }
  return value as Record<string, unknown>;
}

export function ownValue(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? (descriptor.value as unknown)
    : undefined;
}

function legacyBattlyUuid(username: string): string {
  const digest = createHash('md5').update(username).digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return digest.toString('hex');
}

export function parseBattlyAccount(
  result: Record<string, unknown>,
  fallbackUsername: string,
  premium: boolean,
): AuthenticatedAccount {
  const data = battlyDataObject(ownValue(result, 'data'));
  const token = ownValue(data, 'token');
  const canonicalName = ownValue(data, 'username');
  const remoteUuid = ownValue(data, 'uuid');
  if (
    typeof token !== 'string' ||
    !token ||
    token.length > 8192 ||
    typeof canonicalName !== 'string' ||
    !canonicalName ||
    canonicalName.length > 64 ||
    (remoteUuid !== undefined &&
      (typeof remoteUuid !== 'string' || !remoteUuid || remoteUuid.length > 128))
  ) {
    throw new TypeError('Battly authentication returned invalid account data');
  }
  return {
    type: 'battly',
    access_token: token,
    client_token: token,
    uuid: typeof remoteUuid === 'string' ? remoteUuid : legacyBattlyUuid(fallbackUsername),
    name: canonicalName,
    token,
    user_properties: '{}',
    premium,
    meta: { type: 'battly', offline: true } satisfies Record<string, JsonValue>,
  };
}

export async function isBattlyPremium(
  fetchImplementation: typeof fetch,
  premiumUrl: string,
  username: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    return await readBattlyPremium(fetchImplementation, premiumUrl, username, signal);
  } catch {
    return false;
  }
}

export const battlyPremiumUrl = 'https://api.battlylauncher.com/api/v2/users/profile/';

export async function readBattlyPremium(
  fetchImplementation: typeof fetch,
  premiumUrl: string,
  username: string,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetchImplementation(
    premiumUrl.endsWith('/profile/') ? premiumUrl + encodeURIComponent(username) : premiumUrl,
    {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal,
    },
  );
  if (!response.ok) {
    throw new Error('No se pudo consultar Battly Plus');
  }
  const result = await readBattlyJson(response);
  if (Array.isArray(result)) {
    return result.some(
      (name) => typeof name === 'string' && name.toLowerCase() === username.toLowerCase(),
    );
  }
  const root = battlyDataObject(result);
  const profile = battlyDataObject(root.profile);
  if (
    root.status !== 200 ||
    typeof profile.username !== 'string' ||
    profile.username.toLowerCase() !== username.toLowerCase() ||
    typeof profile.isPremium !== 'boolean'
  ) {
    throw new Error('Respuesta de Battly Plus inválida');
  }
  return profile.isPremium;
}
