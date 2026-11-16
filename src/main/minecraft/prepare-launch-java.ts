import { isAbsolute, join, relative } from 'node:path';

import type { ManagedJavaMajor } from '../../shared/settings/java-runtime-contract';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';
import { inspectJavaRuntime } from './java-executable';
import { systemArchitecture } from '../settings/system-architecture';
import { ensureMinecraftJava, resolveMinecraftJava } from './minecraft-java-selection';
import type { ManagedJavaRuntimeService } from '../settings/managed-java-runtime-service';
import { networkAvailable, OfflineError } from '../network/connectivity';

export async function installLaunchJava(
  service: Pick<ManagedJavaRuntimeService, 'subscribe' | 'install'>,
  major: ManagedJavaMajor,
  emit: MinecraftLaunchEventSink,
): Promise<unknown> {
  let phase = '';
  const unsubscribe = service.subscribe((progress) => {
    if (progress.major !== major) {
      return;
    }
    const nextPhase =
      progress.phase === 'download'
        ? 'java-download'
        : progress.phase === 'extracting'
          ? 'extract'
          : 'java-runtime';
    if (progress.phase !== 'complete' && nextPhase !== phase) {
      phase = nextPhase;
      emit({ type: 'phase', phase });
    }
    if (progress.phase === 'download') {
      emit({
        type: 'progress',
        current: progress.completedBytes,
        total: progress.totalBytes,
        item: progress.current,
      });
    }
  });
  try {
    return await service.install(major);
  } finally {
    unsubscribe();
  }
}

export interface LaunchJavaPreparation {
  readonly contentRoot: string;
  readonly explicitInstancePath?: boolean;
  readonly requiredJavaVersion?: string;
  readonly install: (major: ManagedJavaMajor) => Promise<unknown>;
}

function managedPath(root: string, path: string): boolean {
  const local = relative(join(root, 'runtime'), path);
  return Boolean(local) && !isAbsolute(local) && local !== '..' && !/^\.\.[/\\]/.test(local);
}

export function withJavaMemoryLimit(
  options: MinecraftLaunchOptions,
  bits: 32 | 64 | null,
  log: (message: string) => void,
  heapLimitMiB = 1024,
): MinecraftLaunchOptions {
  if (bits !== 32 && !(bits === null && systemArchitecture() === 'ia32')) {
    return options;
  }
  // A 32-bit JVM needs address space for native libraries as well as its heap.
  const maximumMiB = Math.min(options.memory.maximumMiB, heapLimitMiB);
  const minimumMiB = Math.min(options.memory.minimumMiB, maximumMiB);
  const javaArguments = options.javaArguments.filter(
    (argument) => !/^(?:-Xm[sx]|-XX:(?:MaxHeapSize|InitialHeapSize)=)/i.test(argument),
  );
  if (
    maximumMiB !== options.memory.maximumMiB ||
    javaArguments.length !== options.javaArguments.length
  ) {
    log(
      `Java de 32 bits: la memoria de este inicio se limita a ${maximumMiB} MB para poder reservar espacio para la JVM y sus librerías. Los ajustes guardados no cambian.`,
    );
  }
  return { ...options, memory: { minimumMiB, maximumMiB }, javaArguments };
}

/** Windows HotSpot 25 can fault while committing interpreter stack shadow pages.
 * Pre-touching Java thread stacks avoids that lazy commit path; do not apply
 * diagnostic flags to older JVMs or change the configured heap/stack size.
 */
export function withWindowsJava25Stacks(
  options: MinecraftLaunchOptions,
  major: number,
  platform: NodeJS.Platform = process.platform,
): MinecraftLaunchOptions {
  if (platform !== 'win32' || major !== 25) {
    return options;
  }
  return {
    ...options,
    javaArguments: [
      ...options.javaArguments.filter(
        (argument) =>
          !/^-XX:[+-](?:UnlockDiagnosticVMOptions|AlwaysPreTouchStacks)$/.test(argument),
      ),
      '-XX:+UnlockDiagnosticVMOptions',
      '-XX:+AlwaysPreTouchStacks',
    ],
  };
}

export async function prepareLaunchJava(
  options: MinecraftLaunchOptions,
  preparation: LaunchJavaPreparation,
  emit: MinecraftLaunchEventSink,
): Promise<MinecraftLaunchOptions> {
  // A global custom Java path must not override internal Minecraft versions.
  // Explicit instance/per-launch paths and custom clients keep their selection.
  if (
    !options.version?.customId &&
    !preparation.explicitInstancePath &&
    options.javaPath &&
    !managedPath(preparation.contentRoot, options.javaPath)
  ) {
    const automatic = { ...options };
    delete automatic.javaPath;
    options = automatic;
  }
  // The native core owns automatic runtime selection and installation. Only
  // explicitly configured paths need Battly's validation before handing off.
  // The core selects Java using process.arch. A 32-bit launcher on 64-bit
  // Windows must instead use the managed runtime selected for the host OS.
  if (
    networkAvailable() &&
    process.arch === systemArchitecture() &&
    options.engine === 'minecraft-java-core' &&
    (!options.javaPath ||
      (!preparation.explicitInstancePath && managedPath(preparation.contentRoot, options.javaPath)))
  ) {
    const automatic = { ...options };
    delete automatic.javaPath;
    const required = options.version
      ? await resolveMinecraftJava(
          preparation.contentRoot,
          options.version.customId ?? options.version.id,
          preparation.requiredJavaVersion,
          options.root,
          options.version.id,
        )
      : null;
    return withJavaMemoryLimit(
      withWindowsJava25Stacks(automatic, required?.major ?? 0),
      null,
      (message) => emit({ type: 'log', stream: 'game', message: `[Battly] ${message}` }),
    );
  }
  const resolveSelection = () =>
    resolveMinecraftJava(
      preparation.contentRoot,
      options.version.customId ?? options.version.id,
      preparation.requiredJavaVersion,
      options.root,
      options.version.id,
    );
  const required = await resolveSelection();
  const log = (message: string): void =>
    emit({ type: 'log', stream: 'game', message: `[Battly] ${message}` });
  log(`${options.version.id} requiere Java ${required.major}`);
  if (options.javaPath) {
    const explicit =
      preparation.explicitInstancePath || !managedPath(preparation.contentRoot, options.javaPath);
    if (explicit) {
      const runtime = await inspectJavaRuntime(options.javaPath);
      const selectedMajor = runtime.major;
      if (required.maximumMajor && selectedMajor > required.maximumMajor) {
        throw new Error(
          `${options.version.customId ?? options.version.id} necesita Java ${required.major}. La ruta configurada usa Java ${selectedMajor}; selecciona Java ${required.major} o activa la selección automática.`,
        );
      }
      if (selectedMajor < required.major) {
        throw new Error(
          `La ruta de Java configurada usa Java ${selectedMajor}; ${options.version.id} requiere Java ${required.major}. Selecciona un Java compatible o activa la selección automática.`,
        );
      }
      log(`Java ${selectedMajor} configurado: ${options.javaPath}`);
      return withJavaMemoryLimit(
        withWindowsJava25Stacks(options, selectedMajor),
        runtime.bits,
        log,
      );
    }
    try {
      const runtime = await inspectJavaRuntime(options.javaPath);
      const selectedMajor = runtime.major;
      if (selectedMajor === required.major) {
        log(`Java ${selectedMajor} comprobado: ${options.javaPath}`);
        return withJavaMemoryLimit(
          withWindowsJava25Stacks(options, selectedMajor),
          runtime.bits,
          log,
        );
      }
      log(
        `La selección guardada usa Java ${selectedMajor}; se usará Java ${required.major} para esta versión.`,
      );
    } catch {
      log(`La ruta de Java guardada ya no funciona; se buscará Java ${required.major} instalado.`);
    }
  }
  const install = async (major: ManagedJavaMajor): Promise<unknown> => {
    if (!networkAvailable()) {
      throw new OfflineError();
    }
    emit({ type: 'phase', phase: 'java-runtime' });
    log(`Preparando Java ${major} automáticamente…`);
    return preparation.install(major);
  };
  let selected = await ensureMinecraftJava(resolveSelection, install);
  let runtime = await inspectJavaRuntime(selected.path!).catch(() => null);
  if (runtime?.major !== selected.major) {
    log(`El runtime Java ${selected.major} está incompleto o no corresponde; se reinstalará.`);
    await install(selected.major);
    selected = await resolveSelection();
    if (!selected.path) {
      throw new Error(`Java ${selected.major} no se pudo instalar`);
    }
    runtime = await inspectJavaRuntime(selected.path);
  }
  if (runtime?.major !== required.major) {
    throw new Error(`El runtime instalado no corresponde a Java ${required.major}`);
  }
  log(`Java ${runtime.major} comprobado: ${selected.path}`);
  return withJavaMemoryLimit(
    withWindowsJava25Stacks({ ...options, javaPath: selected.path! }, runtime.major),
    runtime.bits,
    log,
  );
}
