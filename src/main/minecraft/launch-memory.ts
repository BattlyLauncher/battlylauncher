import type { MinecraftLaunchOptions } from './launcher-adapter';

/** Heap settings have one source of truth: the resolved launch memory settings. */
export function isHeapArgument(argument: string): boolean {
  return (
    /^-Xm[xs]/i.test(argument) ||
    /^-XX:(?:MaxHeapSize|InitialHeapSize|SoftMaxHeapSize|MaxRAM|MaxRAMPercentage|InitialRAMPercentage|MinRAMPercentage)=/i.test(
      argument,
    )
  );
}

export function configuredHeapArguments(
  arguments_: readonly string[],
  memory: MinecraftLaunchOptions['memory'],
): string[] {
  return [
    ...arguments_.filter((argument) => !isHeapArgument(argument)),
    `-Xms${memory.minimumMiB}M`,
    `-Xmx${memory.maximumMiB}M`,
  ];
}

export function configuredGameJvmArguments(
  arguments_: readonly string[],
  memory: MinecraftLaunchOptions['memory'],
): string[] {
  const configured = configuredHeapArguments(arguments_, memory);
  if (!configured.some((argument) => /^-XX:[+-]AlwaysPreTouchStacks$/.test(argument))) {
    return configured;
  }
  // A loader can move the unlock flag when merging duplicate JVM options.
  // HotSpot checks the flag as soon as it parses AlwaysPreTouchStacks.
  return [
    '-XX:+UnlockDiagnosticVMOptions',
    ...configured.filter((argument) => !/^-XX:[+-]UnlockDiagnosticVMOptions$/.test(argument)),
  ];
}

/** Node's normalized spawn argv includes the executable at index zero. */
export function configuredJavaSpawnArguments(
  arguments_: readonly string[],
  memory: MinecraftLaunchOptions['memory'],
): string[] {
  const boundary = arguments_.findIndex(
    (value, index) =>
      index > 0 && ['-cp', '-classpath', '--class-path', '-jar', '--module', '-m'].includes(value),
  );
  if (boundary < 0) {
    return [...arguments_];
  }
  return [
    arguments_[0],
    ...configuredGameJvmArguments(arguments_.slice(1, boundary), memory),
    ...arguments_.slice(boundary),
  ];
}
