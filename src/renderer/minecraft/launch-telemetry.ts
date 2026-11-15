export interface TransferSampleState {
  readonly current: number;
  readonly item: string;
  readonly sampledAt: number;
}

export interface TransferSample {
  readonly bytesPerSecond: number;
  readonly etaSeconds: number;
}

export function sampleTransfer(
  previous: TransferSampleState | null,
  progress: { readonly current: number; readonly item: string; readonly total: number },
  now: number,
  intervalMs = 3_000,
): { readonly sample: TransferSample | null; readonly state: TransferSampleState } {
  const state = { current: progress.current, item: progress.item, sampledAt: now };
  if (
    !previous ||
    previous.item !== progress.item ||
    progress.current < previous.current ||
    now - previous.sampledAt < intervalMs
  ) {
    return {
      state:
        previous &&
        previous.item === progress.item &&
        progress.current >= previous.current &&
        now - previous.sampledAt < intervalMs
          ? previous
          : state,
      sample: null,
    };
  }
  const elapsedSeconds = (now - previous.sampledAt) / 1_000;
  const bytesPerSecond = (progress.current - previous.current) / elapsedSeconds;
  return {
    state,
    sample:
      bytesPerSecond > 0
        ? {
            bytesPerSecond,
            etaSeconds: Math.max(0, (progress.total - progress.current) / bytesPerSecond),
          }
        : null,
  };
}

export function isInstallOnlyPhase(phase: string): boolean {
  return /(?:^|[-_])(check|install|extract)(?:$|[-_])|^(?:ready|version-json|java-runtime|runtime)$/i.test(
    phase,
  );
}
