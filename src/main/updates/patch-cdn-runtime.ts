import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createCdnPatchFetch } from './patch-cdn-transport';
import type { PatchRuntime } from './update-service';
const runtimeSymbol = Symbol.for('battly.patch.runtime');
const installed = new WeakSet<object>();
interface Options {
  installedRoot: string;
  userData: string;
  fetcher?: typeof globalThis.fetch;
}
interface RuntimeConfig {
  githubRepository?: string;
  publicKey?: string;
}
/** Switch only after the original bootstrap has confirmed the running signed build. */
export function installPatchCdn({ installedRoot, userData, fetcher }: Options): boolean {
  const previous = Reflect.get(globalThis, runtimeSymbol) as PatchRuntime | undefined;
  if (!previous || installed.has(previous)) {
    return false;
  }
  const before = previous.snapshot();
  if (!before.enabled || before.pending) {
    return false;
  }
  try {
    const load = createRequire(join(installedRoot, 'package.json'));
    const bootstrap = load('./bootstrap/patch-runtime.cjs') as {
      createRuntime(options: {
        config: RuntimeConfig;
        root: string;
        installedRoot: string;
        fetcher: typeof globalThis.fetch;
      }): PatchRuntime & { boot(): string };
    };
    const helpers = load('./bootstrap/runtime-config.cjs') as {
      runtimeConfig(config: RuntimeConfig): RuntimeConfig;
      patchStorageRoot(userData: string, config: RuntimeConfig): string;
    };
    const config = helpers.runtimeConfig(load('./bootstrap/config.json') as RuntimeConfig);
    if (config.githubRepository !== 'BattlyLauncher/battlylauncher' || !config.publicKey) {
      return false;
    }
    const replacement = bootstrap.createRuntime({
      config,
      installedRoot,
      root: helpers.patchStorageRoot(userData, config),
      fetcher: createCdnPatchFetch({ fetcher }),
    });
    // The installed verifier rechecks the active slot. No installer file is replaced.
    replacement.boot();
    const after = replacement.snapshot();
    if (after.pending || after.build !== before.build) {
      throw Error('La build activa no coincide');
    }
    Reflect.set(globalThis, runtimeSymbol, replacement);
    installed.add(replacement);
    return true;
  } catch {
    // Keep the existing updater if the installed bootstrap does not support this adapter.
    console.warn(
      '[Updates] No se pudo activar el respaldo de la CDN; se conserva el transporte actual.',
    );
    return false;
  }
}
