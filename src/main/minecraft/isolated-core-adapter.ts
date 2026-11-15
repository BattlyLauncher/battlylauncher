import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { networkAvailable } from '../network/connectivity';
import type { MinecraftCoreRuntime } from './minecraft-core-runtime';
import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import type {
  MinecraftLauncherAdapter,
  MinecraftLaunchOptions,
  MinecraftLaunchEventSink,
  MinecraftLaunchHandle,
  MinecraftLaunchExit,
} from './launcher-adapter';

type CoreWorkerMessage =
  | { kind: 'child' | 'child-exit'; pid: number }
  | { kind: 'event'; event: Parameters<MinecraftLaunchEventSink>[0] }
  | { kind: 'complete'; exit: MinecraftLaunchExit }
  | { kind: 'failure'; message: string };

function terminateChild(pid: number): void {
  if (process.platform === 'win32') {
    const task = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    task.on('error', () => undefined);
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // El hijo puede haber terminado antes de recibir la cancelación.
    }
  }
}

/** Cada preparación cancela su worker y sus propios procesos Java. */
export class IsolatedCoreAdapter implements MinecraftLauncherAdapter {
  readonly engine = 'minecraft-java-core' as const;

  constructor(
    private runtime: Pick<MinecraftCoreRuntime, 'load' | 'installedPath'>,
    private descriptor: MinecraftCorePackage,
  ) {}

  // async convierte también los errores de preparación síncronos en rechazos de la promesa.
  // eslint-disable-next-line @typescript-eslint/require-await
  async launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle> {
    let worker: Worker | undefined;
    let done = false;
    let cancelled = false;
    const children = new Set<number>();
    let resolveCompletion!: (exit: MinecraftLaunchExit) => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<MinecraftLaunchExit>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    void completion.catch(() => undefined);

    const finish = (exit?: MinecraftLaunchExit, error?: Error): void => {
      if (done) {
        return;
      }
      done = true;
      if (error) {
        children.forEach(terminateChild);
        rejectCompletion(error);
      } else {
        resolveCompletion(exit || { code: null, signal: 'SIGTERM' });
      }
      void worker?.terminate();
    };

    void this.runtime
      .load(this.descriptor)
      .then(() => {
        if (cancelled) {
          return;
        }
        if (!this.runtime.installedPath) {
          throw Error('Minecraft core installation is unavailable');
        }

        worker = new Worker(join(__dirname, 'core-worker-bootstrap.js'), {
          workerData: {
            packagePath: this.runtime.installedPath,
            descriptor: this.descriptor,
            options,
            online: networkAvailable(),
          },
        });
        worker.on('message', (message: CoreWorkerMessage) => {
          if (message.kind === 'child') {
            if (cancelled) {
              terminateChild(message.pid);
            } else {
              children.add(message.pid);
            }
          }
          if (message.kind === 'child-exit') {
            children.delete(message.pid);
          }
          if (done) {
            return;
          }
          if (message.kind === 'event') {
            emit(message.event);
          }
          if (message.kind === 'complete') {
            finish(message.exit);
          }
          if (message.kind === 'failure') {
            finish(undefined, new Error(message.message));
          }
        });
        worker.once('error', (error) => finish(undefined, error));
        worker.once('exit', (code) => {
          if (!done) {
            finish(
              undefined,
              new Error('Minecraft worker exited before completion (' + code + ')'),
            );
          }
        });
      })
      .catch((error: Error) => finish(undefined, error));

    return {
      completion,
      cancel: () => {
        if (done) {
          return false;
        }
        cancelled = true;
        children.forEach(terminateChild);
        emit({
          type: 'log',
          stream: 'game',
          message: '[Battly] Minecraft preparation cancelled',
        });
        finish();
        return true;
      },
    };
  }
}
