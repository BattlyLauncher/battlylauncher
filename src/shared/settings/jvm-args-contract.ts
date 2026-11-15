export interface JvmArgsConfig {
  readonly byVersion: Readonly<Record<string, string>>;
}

export function normalizeJvmArgsConfig(value: unknown): JvmArgsConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid JVM arguments configuration');
  }
  const raw = Object.getOwnPropertyDescriptor(value, 'byVersion')?.value as unknown;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Invalid JVM version arguments');
  }
  const byVersion: Record<string, string> = {};
  for (const [version, args] of Object.entries(raw as Record<string, unknown>)) {
    const key = version.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(key) || typeof args !== 'string') {
      throw new TypeError('Invalid JVM version arguments');
    }
    const normalizedArgs = args.trim();
    if (normalizedArgs.length > 4096 || /[\0\r\n]/.test(normalizedArgs)) {
      throw new TypeError('Invalid JVM version arguments');
    }
    if (normalizedArgs) {
      byVersion[key] = normalizedArgs;
    }
  }
  return { byVersion };
}
