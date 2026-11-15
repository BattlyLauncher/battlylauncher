import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { resolve } from 'node:path';

import type { MinecraftLaunchExit } from './launcher-adapter';

export interface ObservedLauncherProcess {
  readonly child: ChildProcess;
  readonly spawned: Promise<void>;
  readonly completion: Promise<MinecraftLaunchExit>;
}

interface SpawnOptions {
  file: string;
  envPairs: string[];
  args: string[];
}

interface LaunchEnvironment {
  readonly executable: string;
  readonly values: Readonly<Record<string, string>>;
}

type PrepareArguments = (arguments_: readonly string[], child: ChildProcess) => readonly string[];

function configureChildSpawn(
  child: ChildProcess,
  environment?: LaunchEnvironment,
  prepareArguments?: PrepareArguments,
): void {
  if (!environment && !prepareArguments) {
    return;
  }

  // Los motores no exponen estas opciones. El cambio se limita al hijo observado;
  // modificar process.env también afectaría a otros lanzamientos simultáneos.
  const original = Reflect.get(child, 'spawn') as (options: SpawnOptions) => unknown;
  Reflect.set(child, 'spawn', function (options: SpawnOptions) {
    if (
      environment &&
      resolve(options.file).toLowerCase() === resolve(environment.executable).toLowerCase()
    ) {
      const overriddenKeys = new Set(
        Object.keys(environment.values).map((key) => key.toUpperCase()),
      );
      options = {
        ...options,
        envPairs: [
          ...options.envPairs.filter(
            (pair) => !overriddenKeys.has(pair.split('=', 1)[0].toUpperCase()),
          ),
          ...Object.entries(environment.values).map(([key, value]) => `${key}=${value}`),
        ],
      };
    }
    if (prepareArguments) {
      options = { ...options, args: [...prepareArguments(options.args, child)] };
    }
    return Reflect.apply(original, child, [options]);
  });
}

function observeChild(child: ChildProcess): ObservedLauncherProcess {
  let didSpawn = false;
  let resolveSpawn!: () => void;
  let rejectSpawn!: (error: Error) => void;
  let resolveExit!: (exit: MinecraftLaunchExit) => void;
  let rejectExit!: (error: Error) => void;
  const spawned = new Promise<void>((resolve, reject) => {
    resolveSpawn = resolve;
    rejectSpawn = reject;
  });
  const completion = new Promise<MinecraftLaunchExit>((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  // Ambos eventos pueden llegar antes de que el motor devuelva el control del lanzamiento.
  void spawned.catch(() => undefined);
  void completion.catch(() => undefined);
  child.once('spawn', () => {
    didSpawn = true;
    resolveSpawn();
  });
  child.on('error', (error: Error) => {
    rejectSpawn(error);
    rejectExit(error);
  });
  child.once('close', (code, signal) => {
    if (!didSpawn) {
      rejectSpawn(new Error('Java cerró antes de crear el proceso de Minecraft'));
    }
    resolveExit({ code, signal });
  });
  return { child, spawned, completion };
}

/**
 * Observa los hijos creados por esta operación antes de que spawn pueda emitir ENOENT.
 * El contexto asíncrono separa los lanzamientos simultáneos.
 */
export async function observeLauncherProcesses<T>(
  operation: () => Promise<T>,
  onCreated: (process: ObservedLauncherProcess) => void,
  environment?: LaunchEnvironment,
  prepareArguments?: PrepareArguments,
): Promise<T> {
  const scope = new AsyncLocalStorage<boolean>();
  const creations = channel('child_process');
  const created = (message: unknown): void => {
    if (!scope.getStore() || !message || typeof message !== 'object') {
      return;
    }
    const child = Reflect.get(message, 'process') as unknown;
    if (!(child instanceof ChildProcess)) {
      return;
    }
    configureChildSpawn(child, environment, prepareArguments);
    onCreated(observeChild(child));
  };
  creations.subscribe(created);
  try {
    return await scope.run(true, operation);
  } finally {
    creations.unsubscribe(created);
    scope.disable();
  }
}
