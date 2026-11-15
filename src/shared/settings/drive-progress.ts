export interface DriveTransferProgress {
  readonly phase: 'checking' | 'files' | 'publishing';
  readonly completedFiles: number;
  readonly totalFiles: number;
  /** Logical world bytes confirmed or reused; includes acknowledged in-flight chunks. */
  readonly completedBytes?: number;
  readonly totalBytes?: number;
}

export function driveProgressPercent(detail?: DriveTransferProgress): number | null {
  if (!detail) {
    return null;
  }
  const useBytes = (detail.totalBytes ?? 0) > 0;
  const total = useBytes ? detail.totalBytes! : detail.totalFiles;
  const done = useBytes ? (detail.completedBytes ?? 0) : detail.completedFiles;
  if (!total || !Number.isFinite(total) || !Number.isFinite(done)) {
    return null;
  }
  return Math.max(0, Math.min(99, (done / total) * 100));
}

export function driveProgressLabel(detail: DriveTransferProgress, complete = false): string {
  const percent = complete ? 100 : driveProgressPercent(detail);
  const format = (bytes: number): string =>
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1048576);
  return detail.totalBytes
    ? `${percent === null ? '' : `${Math.floor(percent)}% · `}${format(complete ? detail.totalBytes : (detail.completedBytes ?? 0))} / ${format(detail.totalBytes)} MB`
    : detail.totalFiles
      ? `${complete ? detail.totalFiles : detail.completedFiles} / ${detail.totalFiles}`
      : complete
        ? '100%'
        : '';
}
