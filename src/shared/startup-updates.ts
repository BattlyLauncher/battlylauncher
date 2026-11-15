export const startupUpdateChannels = {
  snapshot: 'startup-update:snapshot',
  action: 'startup-update:action',
} as const;

export interface StartupUpdateSnapshot {
  phase: 'checking' | 'downloading' | 'verifying' | 'installing' | 'error';
  kind: 'installer' | 'patch' | null;
  target: string;
  percent: number | null;
  downloaded: number;
  reused: number;
  channel: 'stable' | 'beta';
}

export interface StartupUpdateBridge {
  onSnapshot(listener: (snapshot: StartupUpdateSnapshot) => void): () => void;
  action(action: 'retry' | 'continue'): void;
}

export function isStartupUpdateSnapshot(value: unknown): value is StartupUpdateSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    ['checking', 'downloading', 'verifying', 'installing', 'error'].includes(String(v.phase)) &&
    (v.kind === null || v.kind === 'patch' || v.kind === 'installer') &&
    typeof v.target === 'string' &&
    v.target.length <= 100 &&
    (v.percent === null ||
      (typeof v.percent === 'number' &&
        Number.isFinite(v.percent) &&
        v.percent >= 0 &&
        v.percent <= 100)) &&
    typeof v.downloaded === 'number' &&
    Number.isFinite(v.downloaded) &&
    v.downloaded >= 0 &&
    typeof v.reused === 'number' &&
    Number.isFinite(v.reused) &&
    v.reused >= 0 &&
    (v.channel === 'stable' || v.channel === 'beta')
  );
}
