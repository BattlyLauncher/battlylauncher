export interface BattlyDataRootSnapshot {
  readonly recoveryPath?: string;
  readonly configurable: boolean;
  readonly currentPath: string;
  readonly custom: boolean;
  readonly defaultPath: string;
}

export interface DataRootProgress {
  readonly phase: 'checking' | 'copying' | 'verifying' | 'committing' | 'complete';
  readonly source: string;
  readonly target: string;
  readonly bytes: number;
  readonly total: number;
  readonly file: string;
}
