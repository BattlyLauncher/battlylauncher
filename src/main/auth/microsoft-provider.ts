import type { AuthRequest } from '../../shared/auth/auth-contract';
import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import { parseLegacyStorageDocument } from '../../shared/storage/legacy-storage';
import type { MinecraftCoreRuntime } from '../minecraft/minecraft-core-runtime';
import {
  AuthCancelledError,
  type AuthProvider,
  type AuthenticatedAccount,
} from './auth-coordinator';

export interface MicrosoftRuntimeConfiguration {
  readonly clientId: string;
  readonly corePackage: MinecraftCorePackage;
}

export interface MicrosoftProviderOptions {
  readonly loadConfiguration: () => Promise<MicrosoftRuntimeConfiguration>;
  readonly runtime: MinecraftCoreRuntime;
}

function stringField(source: Record<string, unknown>, key: string, maxLength = 8192): string {
  const value = Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    throw new TypeError(`Microsoft authentication returned an invalid ${key}`);
  }
  return value;
}

export class MicrosoftProvider implements AuthProvider {
  readonly method = 'microsoft' as const;
  readonly #loadConfiguration: () => Promise<MicrosoftRuntimeConfiguration>;
  readonly #runtime: MinecraftCoreRuntime;

  constructor(options: MicrosoftProviderOptions) {
    this.#loadConfiguration = options.loadConfiguration;
    this.#runtime = options.runtime;
  }

  async authenticate(request: AuthRequest, signal: AbortSignal): Promise<AuthenticatedAccount> {
    if (request.method !== this.method) {
      throw new TypeError('Invalid Microsoft authentication request');
    }
    if (signal.aborted) {
      throw new AuthCancelledError();
    }
    const configuration = await this.#loadConfiguration();
    const core = await this.#runtime.load(configuration.corePackage);
    if (signal.aborted) {
      throw new AuthCancelledError();
    }
    const result = await new core.Microsoft(configuration.clientId).getAuth();
    if (signal.aborted) {
      throw new AuthCancelledError();
    }
    if (result === null || typeof result !== 'object' || Array.isArray(result)) {
      throw new TypeError('Microsoft authentication returned invalid data');
    }
    const source = result as Record<string, unknown>;
    const account = {
      type: 'microsoft',
      access_token: stringField(source, 'access_token'),
      client_token: stringField(source, 'client_token'),
      uuid: stringField(source, 'uuid', 64),
      name: stringField(source, 'name', 64),
      refresh_token: stringField(source, 'refresh_token'),
      user_properties:
        (Object.getOwnPropertyDescriptor(source, 'user_properties')?.value as unknown) ?? '{}',
      meta: (Object.getOwnPropertyDescriptor(source, 'meta')?.value as unknown) ?? {
        type: 'microsoft',
      },
    };
    return parseLegacyStorageDocument({ account }).values.account as AuthenticatedAccount;
  }
}
