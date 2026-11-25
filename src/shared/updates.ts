export interface UpdateSettings {
  channel: 'stable' | 'beta';
}
export interface InstalledPatchNotes {
  readonly key: string;
  readonly version: string;
  readonly notes: string;
}
export interface UpdateSnapshot {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  kind: 'installer' | 'patch' | null;
  version: string;
  build: number;
  installedPatchNotes?: InstalledPatchNotes;
  target: string;
  message: string;
  percent: number;
  downloaded: number;
  reused: number;
  phase?: 'downloading' | 'verifying' | 'installing';
  installationError?: boolean;
  patchConfigured: boolean;
  rollback: boolean;
  noticeId?: number;
  remindAt?: number;
  settings: UpdateSettings;
}
export type UpdateAction = 'check' | 'download' | 'install' | 'rollback' | 'cancel' | 'later';
