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
    ...configuredHeapArguments(arguments_.slice(1, boundary), memory),
    ...arguments_.slice(boundary),
  ];
}
