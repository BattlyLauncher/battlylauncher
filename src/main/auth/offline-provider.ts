import { createHash } from 'node:crypto';

import type { AuthRequest } from '../../shared/auth/auth-contract';
import type { AuthProvider, AuthenticatedAccount } from './auth-coordinator';

function offlineUuid(username: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class OfflineProvider implements AuthProvider {
  readonly method = 'offline' as const;

  authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid request for offline provider');
    }
    if (signal.aborted) {
      return Promise.reject(new Error('Authentication cancelled'));
    }
    const uuid = offlineUuid(request.username);
    return Promise.resolve({
      uuid,
      name: request.username,
      type: 'offline',
      premium: false,
      token: uuid,
      access_token: uuid,
      client_token: uuid,
      meta: { type: 'offline', offline: true },
    });
  }
}
