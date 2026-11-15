import type { PlayVersionLaunchRequest } from './play-version-contract';
export type CrashIssueSeverity = 'critical' | 'warning' | 'info';

export type CrashRepairKind =
  | 'adjust-memory'
  | 'disable-mod'
  | 'install-mod-dependency'
  | 'resolve-mod-conflict'
  | 'quarantine-file'
  | 'remove-jvm-argument'
  | 'install-mesa';

export interface MinecraftCrashEvidence {
  readonly file: string;
  readonly line: string;
}

export interface MinecraftCrashRepair {
  readonly id: string;
  readonly kind: CrashRepairKind;
  readonly label: string;
  readonly description: string;
  readonly requiresFileSelection: boolean;
  readonly mod?: {
    readonly name: string;
    readonly version: string | null;
    readonly gameVersion: string | null;
  };
}

export interface MinecraftCrashIssue {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: CrashIssueSeverity;
  readonly confidence: 'high' | 'medium';
  readonly evidence: readonly MinecraftCrashEvidence[];
  readonly repairs: readonly MinecraftCrashRepair[];
}

export interface MinecraftCrashSource {
  readonly name: string;
  readonly path: string;
  readonly modifiedAt: string;
}

export interface MinecraftCrashReport {
  readonly stage?: 'preflight';
  readonly id: string;
  readonly createdAt: string;
  readonly exitCode: number | null;
  readonly instanceId: string | null;
  readonly launchRequest?: PlayVersionLaunchRequest;
  readonly issues: readonly MinecraftCrashIssue[];
  readonly sources: readonly MinecraftCrashSource[];
  readonly summary: string;
  readonly rawLog: string;
  readonly fingerprint?: string;
  readonly engineVersion?: string;
}

export interface MinecraftCrashRepairResult {
  readonly ok: boolean;
  readonly message: string;
  readonly repairId: string | null;
}

export interface MinecraftCrashRepairProgress {
  readonly reportId: string;
  readonly repairId: string;
  readonly phase: 'searching' | 'installing' | 'repairing';
  readonly mod?: string;
}

export function isCrashRepairProgress(value: unknown): value is MinecraftCrashRepairProgress {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.reportId === 'string' &&
    entry.reportId.length <= 120 &&
    typeof entry.repairId === 'string' &&
    entry.repairId.length <= 120 &&
    ['searching', 'installing', 'repairing'].includes(String(entry.phase)) &&
    (entry.mod === undefined || (typeof entry.mod === 'string' && entry.mod.length <= 300))
  );
}

export function normalizeCrashRepairRequest(
  reportId: unknown,
  repairId: unknown,
): { readonly reportId: string; readonly repairId: string } {
  const valid = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
  if (!valid(reportId) || !valid(repairId)) {
    throw new TypeError('Invalid crash repair request');
  }
  return { reportId, repairId };
}

export function normalizeCrashRepairRollback(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(value)) {
    throw new TypeError('Invalid crash repair rollback');
  }
  return value;
}

export function isMinecraftCrashReport(value: unknown): value is MinecraftCrashReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  return (
    (source.stage === undefined || source.stage === 'preflight') &&
    typeof source.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,120}$/.test(source.id) &&
    typeof source.createdAt === 'string' &&
    (source.exitCode === null || Number.isInteger(source.exitCode)) &&
    (source.instanceId === null || typeof source.instanceId === 'string') &&
    typeof source.summary === 'string' &&
    source.summary.length <= 1_000 &&
    typeof source.rawLog === 'string' &&
    source.rawLog.length <= 180_000 &&
    Array.isArray(source.issues) &&
    source.issues.length <= 20 &&
    Array.isArray(source.sources) &&
    source.sources.length <= 12
  );
}
