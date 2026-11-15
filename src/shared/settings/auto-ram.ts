export interface AutoRamRecommendation {
  readonly freeGb: number;
  readonly maximumGb: number;
  readonly minimumGb: number;
  readonly targetPercent: number;
  readonly totalGb: number;
}

const gibibyte = 1024 ** 3;
const stepGb = 0.5;

function finiteBytes(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function roundToStep(value: number): number {
  return Math.max(stepGb, Math.round(value / stepGb) * stepGb);
}

export function recommendAutoRam(totalBytes: number, freeBytes: number): AutoRamRecommendation {
  const totalGb = Math.max(1, Math.floor(finiteBytes(totalBytes, 'total memory') / gibibyte));
  const freeGb = Math.max(
    0,
    Math.round((Math.min(finiteBytes(freeBytes, 'free memory'), totalBytes) / gibibyte) * 10) / 10,
  );
  const freePercent = Math.max(0, Math.min(100, (freeGb / totalGb) * 100));
  const targetRatio =
    freePercent >= 60
      ? 0.6
      : freePercent >= 40
        ? 0.5
        : freePercent >= 25
          ? 0.4
          : freePercent >= 15
            ? 0.3
            : 0.2;
  const availableTargetGb = Math.min(
    totalGb,
    roundToStep(totalGb * Math.min(targetRatio, 0.7)),
    roundToStep(Math.max(stepGb, freeGb - 0.5)),
  );
  // Free RAM is a momentary measurement, not a viable Minecraft heap limit.
  // Keep a useful heap ceiling under pressure without eagerly committing it.
  const minimumHeapGb = totalGb >= 4 ? 2 : 1;
  const maximumGb = Math.min(Math.max(1, totalGb - 1), Math.max(minimumHeapGb, availableTargetGb));
  return {
    totalGb,
    freeGb,
    minimumGb: Math.min(maximumGb, freeGb < 1.5 ? 0.5 : 1),
    maximumGb,
    targetPercent: Math.round((maximumGb / totalGb) * 100),
  };
}
