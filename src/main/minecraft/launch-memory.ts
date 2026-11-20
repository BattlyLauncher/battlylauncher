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

const javaOptionsWithValue = new Set([
  '-cp',
  '-classpath',
  '--class-path',
  '-p',
  '--module-path',
  '--upgrade-module-path',
  '--add-modules',
  '--limit-modules',
  '--add-reads',
  '--add-exports',
  '--add-opens',
  '--patch-module',
  '--enable-native-access',
  '--source',
]);

/** Java accepts JVM options both before and after the classpath option. */
export function javaApplicationArgumentIndex(arguments_: readonly string[]): number {
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (
      !argument.startsWith('-') ||
      argument === '-jar' ||
      argument === '-m' ||
      argument === '--module' ||
      argument.startsWith('--module=')
    ) {
      return index;
    }
    if (javaOptionsWithValue.has(argument)) {
      index++;
    }
  }
  return -1;
}

/** Node's normalized spawn argv includes the executable at index zero. */
export function configuredJavaSpawnArguments(
  arguments_: readonly string[],
  memory: MinecraftLaunchOptions['memory'],
): string[] {
  const javaArguments = arguments_.slice(1);
  const boundary = javaApplicationArgumentIndex(javaArguments);
  if (boundary < 0) {
    return [...arguments_];
  }
  return [
    arguments_[0],
    ...configuredGameJvmArguments(javaArguments.slice(0, boundary), memory),
    ...javaArguments.slice(boundary),
  ];
}
