export type AuthMethod =
  | 'battly-google'
  | 'battly-password'
  | 'battly-token'
  | 'battly-two-factor'
  | 'microsoft'
  | 'offline';

export type AuthRequest =
  | { readonly method: 'battly-google'; readonly code?: string }
  | { readonly method: 'battly-password'; readonly password: string; readonly username: string }
  | { readonly method: 'battly-token'; readonly token: string }
  | {
      readonly method: 'battly-two-factor';
      readonly mode: 'recovery' | 'totp';
      readonly code: string;
    }
  | { readonly method: 'microsoft' }
  | { readonly method: 'offline'; readonly username: string };

export type AuthOutcome =
  | { readonly accounts: AccountCollection; readonly ok: true }
  | {
      readonly code: 'cancelled' | 'failed' | 'two-factor-required' | 'unavailable';
      readonly message: string;
      readonly ok: false;
    };

function own(source: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? (descriptor.value as unknown)
    : undefined;
}

function assertExactKeys(source: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError('Authentication request contains unsupported fields');
  }
}

export function normalizeAuthRequest(value: unknown): AuthRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Authentication request must be an object');
  }
  const source = value as Record<string, unknown>;
  const method = own(source, 'method');
  if (method === 'battly-google' && own(source, 'code') !== undefined) {
    assertExactKeys(source, ['method', 'code']);
    const code = own(source, 'code');
    if (typeof code !== 'string' || !/^[A-Z0-9]{6}$/.test(code)) {
      throw new TypeError('Introduce el código de seis caracteres de la página de Google');
    }
    return { method, code };
  }
  if (method === 'microsoft' || method === 'battly-google') {
    assertExactKeys(source, ['method']);
    return { method };
  }
  if (method === 'battly-password') {
    assertExactKeys(source, ['method', 'username', 'password']);
    const username = own(source, 'username');
    const password = own(source, 'password');
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      username.length > 254 ||
      typeof password !== 'string' ||
      !password ||
      password.length > 1024
    ) {
      throw new TypeError('Invalid Battly credentials');
    }
    return { method, username: username.trim(), password };
  }
  if (method === 'battly-token') {
    assertExactKeys(source, ['method', 'token']);
    const token = own(source, 'token');
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > 8_192 ||
      [...token].some((character) => (character.codePointAt(0) ?? 0) < 32)
    ) {
      throw new TypeError('Invalid Battly login token');
    }
    return { method, token };
  }
  if (method === 'offline') {
    assertExactKeys(source, ['method', 'username']);
    const username = own(source, 'username');
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(username.trim())) {
      throw new TypeError('Invalid offline username');
    }
    return { method, username: username.trim() };
  }
  if (method === 'battly-two-factor') {
    assertExactKeys(source, ['method', 'mode', 'code']);
    const mode = own(source, 'mode');
    const code = own(source, 'code');
    if (mode === 'totp' && typeof code === 'string' && /^\d{6}$/.test(code)) {
      return { method, mode, code };
    }
    if (
      mode === 'recovery' &&
      typeof code === 'string' &&
      code.length >= 8 &&
      code.length <= 128 &&
      /^[A-Za-z0-9-]+$/.test(code)
    ) {
      return { method, mode, code: code.toUpperCase() };
    }
    throw new TypeError('Invalid Battly two-factor code');
  }
  throw new TypeError('Unsupported authentication method');
}
import type { AccountCollection } from '../accounts/account';
