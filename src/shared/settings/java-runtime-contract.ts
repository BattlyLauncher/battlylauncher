export const managedJavaMajors = [8, 16, 17, 21, 25] as const;
export type ManagedJavaMajor = (typeof managedJavaMajors)[number];
export type JavaRuntimeProvider = 'mojang' | 'adoptium' | 'zulu';
export function normalizeJavaRuntimeProvider(value: unknown): JavaRuntimeProvider {
  if (value === undefined || value === 'mojang') {
    return 'mojang';
  }
  if (value === 'adoptium' || value === 'zulu') {
    return value;
  }
  throw new TypeError('Proveedor de Java no válido');
}

export interface ManagedJavaRuntime {
  readonly installed: boolean;
  readonly major: ManagedJavaMajor;
  readonly path: string | null;
  readonly selected: boolean;
  readonly version: string | null;
}

export interface ManagedJavaSnapshot {
  readonly runtimes: readonly ManagedJavaRuntime[];
  readonly selectedMajor: ManagedJavaMajor | null;
}

export type ManagedJavaInstallPhase = 'complete' | 'download' | 'resolving' | 'extracting';

export interface ManagedJavaInstallProgress {
  readonly completedBytes: number;
  readonly current: string;
  readonly major: ManagedJavaMajor;
  readonly phase: ManagedJavaInstallPhase;
  readonly totalBytes: number;
}

export function normalizeManagedJavaMajor(value: unknown): ManagedJavaMajor {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    !(managedJavaMajors as readonly number[]).includes(value)
  ) {
    throw new TypeError('Versión de Java administrada no válida');
  }
  return value as ManagedJavaMajor;
}

export function isManagedJavaInstallProgress(value: unknown): value is ManagedJavaInstallProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  return (
    typeof source.major === 'number' &&
    (managedJavaMajors as readonly number[]).includes(source.major) &&
    (source.phase === 'extracting' ||
      source.phase === 'resolving' ||
      source.phase === 'download' ||
      source.phase === 'complete') &&
    typeof source.completedBytes === 'number' &&
    Number.isFinite(source.completedBytes) &&
    source.completedBytes >= 0 &&
    typeof source.totalBytes === 'number' &&
    Number.isFinite(source.totalBytes) &&
    source.totalBytes >= 0 &&
    typeof source.current === 'string' &&
    source.current.length <= 1_024
  );
}
