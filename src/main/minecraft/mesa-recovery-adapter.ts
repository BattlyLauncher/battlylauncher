import { observeLauncherProcesses } from './launcher-process-observer';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { MesaRuntimeService } from './mesa-runtime-service';
import { isMesaCompatibleFailure } from './mesa-runtime-service';
import type { MinecraftLaunchEvent } from '../../shared/minecraft/launch-contract';
import type {
  MinecraftLauncherAdapter,
  MinecraftLaunchOptions,
  MinecraftLaunchEventSink,
  MinecraftLaunchHandle,
  MinecraftLaunchExit,
} from './launcher-adapter';

export class MesaRecoveryAdapter implements MinecraftLauncherAdapter {
  readonly engine;
  constructor(
    private readonly adapter: MinecraftLauncherAdapter,
    private readonly runtime: Pick<MesaRuntimeService, 'prepare'>,
    private readonly stateRoot: string,
    private readonly platform = process.platform,
  ) {
    this.engine = adapter.engine;
  }

  async launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle> {
    if (this.platform !== 'win32' || options.installOnly) {
      return this.adapter.launch(options, emit);
    }
    const abort = new AbortController();
    let child: MinecraftLaunchHandle | undefined;
    let cancelled = false;
    const key = createHash('sha256')
      .update(
        `${options.gameDirectory}|${options.version.customId || options.version.id}|${options.javaPath}`,
      )
      .digest('hex');
    const statePath = join(this.stateRoot, `${key}.json`);
    const log = (message: string): void =>
      emit({ type: 'log', stream: 'game', message: `[Battly] ${message}` });
    const save = async (state: string): Promise<void> => {
      await mkdir(this.stateRoot, { recursive: true });
      await writeFileAtomically(statePath, JSON.stringify({ state }));
    };
    const completion = (async (): Promise<MinecraftLaunchExit> => {
      const state = await readBoundedRegularFile(statePath, 1024 * 1024)
        .then((text) => (JSON.parse(text.toString('utf8')) as { state: string }).state)
        .catch(() => 'new');
      let current = options;
      let attempted = state !== 'new';
      let retrying = false;
      if (state === 'enabled') {
        log(
          'Compatibilidad Mesa3D activada para esta versión. El renderizado por software puede reducir los FPS.',
        );
        current = await this.runtime.prepare(options, emit, abort.signal);
      }
      while (true) {
        abort.signal.throwIfAborted();
        let evidence = '';
        let graphicsFailure = false;
        let graphicsReady = false;
        const terminal: MinecraftLaunchEvent[] = [];
        let exit: MinecraftLaunchExit;
        try {
          child = await observeLauncherProcesses(
            () =>
              this.adapter.launch(current, (event) => {
                if (event.type === 'log') {
                  evidence = (evidence + '\n' + event.message).slice(-64_000);
                  graphicsFailure ||= isMesaCompatibleFailure(evidence);
                  graphicsReady ||= /Created:\s*\d+x\d+[^\r\n]*minecraft:textures\/atlas\//.test(
                    event.message,
                  );
                }
                if (
                  event.type === 'exit' ||
                  (event.type === 'state' && ['failed', 'exited'].includes(event.state))
                ) {
                  terminal.push(event);
                } else {
                  emit(event);
                }
              }),
            () => {},
            current.environment && current.javaPath
              ? { executable: current.javaPath, values: current.environment }
              : undefined,
          );
          if (cancelled) {
            child.cancel();
          }
          exit = await child.completion;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          graphicsFailure ||= isMesaCompatibleFailure(detail);
          if (cancelled || attempted || !graphicsFailure) {
            if (retrying && !cancelled) {
              await save('failed');
            }
            throw error;
          }
          exit = { code: 1, signal: null };
          if (!terminal.length) {
            terminal.push({ type: 'exit', ...exit });
          }
        }
        if (retrying) {
          const recovered = !graphicsFailure && (graphicsReady || (!cancelled && exit.code === 0));
          await save(recovered ? 'enabled' : 'failed');
          if (!recovered && !cancelled) {
            log(
              'Mesa3D no ha resuelto el inicio. No se volverá a aplicar automáticamente a esta versión.',
            );
          }
        }
        // Minecraft may exit with code 0 after its native GLFW error dialog.
        // The explicit graphics diagnostic takes precedence over that exit code.
        if (cancelled || attempted || exit.signal || !graphicsFailure) {
          terminal.forEach(emit);
          return exit;
        }
        attempted = true;
        retrying = true;
        // Persist before downloading: failures or app restarts must never loop.
        await save('failed');
        emit({ type: 'state', state: 'preparing' });
        emit({ type: 'phase', phase: 'mesa-recovery' });
        log(
          'Fallo de OpenGL detectado. Descargando Mesa3D y reparando la compatibilidad gráfica automáticamente…',
        );
        try {
          current = await this.runtime.prepare(options, emit, abort.signal);
          abort.signal.throwIfAborted();
        } catch (error) {
          if (!cancelled) {
            log(
              `No se pudo preparar Mesa3D: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          terminal.forEach(emit);
          return exit;
        }
        log(
          'Mesa3D preparado. Reintentando Minecraft una sola vez; el renderizado por software puede reducir los FPS.',
        );
      }
    })();
    return {
      completion,
      cancel: () => {
        cancelled = true;
        abort.abort();
        child?.cancel();
        return true;
      },
    };
  }
}
