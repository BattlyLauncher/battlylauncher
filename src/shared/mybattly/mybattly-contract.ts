import type { LocalModInspection } from '../mods/mod-contract';

export interface MyBattlyWorld {
  readonly iconDataUrl?: string;
  readonly modifiedAt: string;
  readonly name: string;
}

export interface MyBattlyResourcePack {
  readonly enabled: boolean;
  readonly iconDataUrl?: string;
  readonly name: string;
}

export interface DriveState {
  readonly connected: boolean;
  readonly email: string | null;
  readonly name: string | null;
  readonly folderId: string | null;
}

export interface WorldBackupSummary {
  readonly scope?: string;
  readonly restorable?: boolean;
  readonly storage?: 'local' | 'drive';

  readonly archiveName: string;
  readonly createdAt: string;
  readonly id: string;
  readonly sizeBytes: number;
  readonly worldName: string;
}

export interface MyBattlySocialSummary {
  readonly friendCount: number;
  readonly onlineFriendCount: number;
  readonly receivedRequestCount: number;
  readonly receivedRequests: readonly string[];
}

export interface MyBattlySnapshot {
  readonly usageHistory?: readonly UsageDay[];
  readonly backupCount: number;
  readonly latestBackupAt: string | null;
  readonly mods: readonly LocalModInspection[];
  readonly playedSeconds: number | null;
  readonly launcherSeconds?: number | null;
  readonly resourcePacks: readonly MyBattlyResourcePack[];
  readonly social: MyBattlySocialSummary | null;
  readonly username: string;
  readonly worlds: readonly MyBattlyWorld[];
}

export interface UsageDay {
  readonly date: string;
  readonly game: number;
  readonly launcher: number;
  readonly hours: readonly {
    readonly hour: number;
    readonly game: number;
    readonly launcher: number;
  }[];
}

export function normalizeContentName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new TypeError('Invalid content name');
  }
  return value;
}

export function normalizeBackupId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new TypeError('Invalid backup id');
  }
  return value;
}
