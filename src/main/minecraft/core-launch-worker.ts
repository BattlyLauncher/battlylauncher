import { parentPort, workerData } from 'node:worker_threads';
import { channel } from 'node:diagnostics_channel';
import { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { MinecraftJavaCoreAdapter } from './minecraft-java-core-adapter';
import { configureConnectivity } from '../network/connectivity';
import type { MinecraftCoreModule } from './minecraft-core-runtime';
import type { MinecraftCorePackage } from '../../shared/minecraft/core-package';
import type { MinecraftLaunchOptions } from './launcher-adapter';
interface CoreWorkerInput {
  online: boolean;
  options: MinecraftLaunchOptions;
  packagePath: string;
  descriptor: MinecraftCorePackage;
}
const input = workerData as CoreWorkerInput;
const port = parentPort!;
configureConnectivity(() => input.online);
Object.assign(process.env, input.options.environment || {});
const loadModule = createRequire(__filename);
const workerHttp = loadModule('./core-worker-http.js') as {
  configureCoreWorkerHttp(): void;
};
workerHttp.configureCoreWorkerHttp();
channel('child_process').subscribe((message: unknown) => {
  const child: unknown =
    message && typeof message === 'object' ? Reflect.get(message, 'process') : null;
  if (child instanceof ChildProcess) {
    child.once('spawn', () => port.postMessage({ kind: 'child', pid: child.pid }));
    child.once('close', () => port.postMessage({ kind: 'child-exit', pid: child.pid }));
  }
});
const adapter = new MinecraftJavaCoreAdapter(
  { load: () => Promise.resolve(loadModule(input.packagePath) as MinecraftCoreModule) },
  input.descriptor,
);
void adapter
  .launch(input.options, (event) => port.postMessage({ kind: 'event', event }))
  .then((handle) => handle.completion)
  .then(
    (exit) => port.postMessage({ kind: 'complete', exit }),
    (error) =>
      port.postMessage({
        kind: 'failure',
        message: error instanceof Error ? error.message : String(error),
      }),
  );
