export const invitationRetentionMs = 24 * 60 * 60 * 1000;

function timestamp(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function invitationDates(
  source: Record<string, unknown>,
  firstReceivedAt: number,
  now = Date.now(),
): { createdAt: number; expiresAt: number } {
  const createdAt = Math.min(timestamp(source.createdAt) ?? firstReceivedAt, firstReceivedAt, now);
  return {
    createdAt,
    expiresAt: Math.min(timestamp(source.expiresAt) ?? Infinity, createdAt + invitationRetentionMs),
  };
}
