/** Compact counters with two decimals, without inflating the displayed count. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }
  for (const [unit, suffix] of [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (value >= unit) {
      return String(Math.floor((value / unit) * 100) / 100) + suffix;
    }
  }
  return String(Math.floor(value));
}
