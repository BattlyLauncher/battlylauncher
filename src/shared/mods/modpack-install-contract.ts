import type { InstanceSummary } from '../minecraft/instance';

export const modpackInstallPhases = [
  'reading',
  'downloading-archive',
  'extracting',
  'downloading-files',
  'writing',
  'complete',
] as const;

export type ModpackInstallPhase = (typeof modpackInstallPhases)[number];

export interface ModpackInstallProgress {
  readonly pack?: InstanceSummary;
  readonly current: number;
  readonly item: string;
  readonly message: string;
  readonly phase: ModpackInstallPhase;
  readonly total: number;
}

export type ModpackInstallProgressSink = (progress: ModpackInstallProgress) => void;

/** Percentage of the current measurable task, never an invented phase weight. */
export function modpackInstallPercent(progress: ModpackInstallProgress): number {
  if (progress.phase === 'complete') {
    return 100;
  }
  if (progress.total <= 0) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, progress.current / progress.total)) * 1000) / 10;
}

export function isModpackInstallProgress(value: unknown): value is ModpackInstallProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const progress = value as Record<string, unknown>;
  return (
    typeof progress.current === 'number' &&
    Number.isFinite(progress.current) &&
    progress.current >= 0 &&
    typeof progress.total === 'number' &&
    Number.isFinite(progress.total) &&
    progress.total > 0 &&
    progress.current <= progress.total &&
    typeof progress.item === 'string' &&
    progress.item.length <= 512 &&
    typeof progress.message === 'string' &&
    progress.message.length <= 512 &&
    typeof progress.phase === 'string' &&
    (modpackInstallPhases as readonly string[]).includes(progress.phase)
  );
}
