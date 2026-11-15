import type {
  MinecraftLauncherAdapter,
  MinecraftLaunchOptions,
  MinecraftLaunchEventSink,
  MinecraftLaunchHandle,
} from '../minecraft/launcher-adapter';
import { observeLauncherProcesses } from '../minecraft/launcher-process-observer';
import type { ClientBridge } from './client-bridge';
/** Every game gets a separate capability; only Battly Client claims native controls. */
export class BattlyClientAdapter implements MinecraftLauncherAdapter {
  readonly engine;
  constructor(
    private readonly adapter: MinecraftLauncherAdapter,
    private readonly bridge: ClientBridge,
  ) {
    this.engine = adapter.engine;
  }
  async launch(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchHandle> {
    if (options.installOnly) {
      return this.adapter.launch(options, emit);
    }
    const lease = await this.bridge.lease(options.authorization);
    if (
      /^battly(?:-client)?[- ](?:26\.3|1\.8\.9|1\.12\.2|1\.16\.5|1\.20\.1|1\.21\.11)$/i.test(
        options.version.customId || options.version.id,
      )
    ) {
      lease.claim();
    }
    try {
      const enriched = {
        ...options,
        environment: { ...options.environment, ...lease.environment },
      };
      const handle = await observeLauncherProcesses(
        () =>
          this.adapter.launch(enriched, (event) => {
            if (event.type === 'process') {
              lease.process(event.pid);
            }
            emit(event);
          }),
        () => {},
        { executable: options.javaPath || 'java', values: enriched.environment },
      );
      const completion = handle.completion.finally(lease.close);
      void completion.catch(() => undefined);
      return {
        completion,
        cancel: () => {
          lease.close();
          return handle.cancel();
        },
      };
    } catch (error) {
      lease.close();
      throw error;
    }
  }
}
