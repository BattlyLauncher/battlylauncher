export interface BattlyClientBuild {
  readonly id: string;
  readonly clientVersion: string;
  readonly minecraftVersion: string;
  readonly build: number;
  readonly channel: 'stable' | 'beta';
  readonly platform: 'win32' | 'linux' | 'darwin';
  readonly architecture: 'x64' | 'arm64';
  readonly downloadUrl: string;
  readonly sha256: string;
  readonly size: number;
  readonly javaVersion: number;
  readonly publishedAt: string;
}

export interface BattlyClientUpdateNotice {
  readonly minecraftVersion: string;
  readonly installedVersion: string;
  readonly installedBuild: number;
  readonly clientVersion: string;
  readonly build: number;
  readonly canUpdateNow: boolean;
}

export function compareClientVersions(left: string, right: string): number {
  const parse = (value: string) => /^(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?$/.exec(value);
  const a = parse(left),
    b = parse(right);
  if (!a || !b) {
    throw new TypeError('Invalid Battly Client metadata');
  }
  for (let i = 1; i <= 3; i++) {
    const delta = Number(a[i] || 0) - Number(b[i] || 0);
    if (delta) {
      return Math.sign(delta);
    }
  }
  if (!a[4] || !b[4]) {
    return a[4] === b[4] ? 0 : a[4] ? -1 : 1;
  }
  const x = a[4].split('.'),
    y = b[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined || y[i] === undefined) {
      return x[i] === y[i] ? 0 : x[i] === undefined ? -1 : 1;
    }
    if (x[i] === y[i]) {
      continue;
    }
    const xn = /^\d+$/.test(x[i]),
      yn = /^\d+$/.test(y[i]);
    if (xn && yn) {
      return Math.sign(Number(x[i]) - Number(y[i]));
    }
    if (xn !== yn) {
      return xn ? -1 : 1;
    }
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

export function battlyClientBuildId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    throw new TypeError('Invalid Battly Client build');
  }
  return value;
}

export function validateBattlyClientBuilds(value: unknown): readonly BattlyClientBuild[] {
  const builds = (value as { builds?: unknown })?.builds;
  if (!Array.isArray(builds) || builds.length > 500) {
    throw new TypeError('Invalid Battly Client catalog');
  }
  const ids = new Set<string>();
  return builds.map((item: BattlyClientBuild) => {
    if (!item || typeof item !== 'object') {
      throw new TypeError('Invalid Battly Client build');
    }
    const id = battlyClientBuildId(item.id);
    if (ids.has(id)) {
      throw new TypeError('Duplicate Battly Client build');
    }
    ids.add(id);
    const url = new URL(item.downloadUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !/^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.-]+)?$/.test(item.clientVersion) ||
      !/^\d+\.\d+(?:\.\d+)?$/.test(item.minecraftVersion) ||
      !['stable', 'beta'].includes(item.channel) ||
      !['win32', 'linux', 'darwin'].includes(item.platform) ||
      !['x64', 'arm64'].includes(item.architecture) ||
      !Number.isSafeInteger(item.build) ||
      item.build < 1 ||
      !Number.isSafeInteger(item.size) ||
      item.size < 1 ||
      item.size > 128 * 1024 * 1024 ||
      !Number.isInteger(item.javaVersion) ||
      item.javaVersion < 8 ||
      item.javaVersion > 99 ||
      !Number.isFinite(Date.parse(item.publishedAt))
    ) {
      throw new TypeError('Invalid Battly Client metadata');
    }
    return {
      id,
      clientVersion: item.clientVersion,
      minecraftVersion: item.minecraftVersion,
      build: item.build,
      channel: item.channel,
      platform: item.platform,
      architecture: item.architecture,
      downloadUrl: url.href,
      sha256: item.sha256,
      size: item.size,
      javaVersion: item.javaVersion,
      publishedAt: item.publishedAt,
    };
  });
}
