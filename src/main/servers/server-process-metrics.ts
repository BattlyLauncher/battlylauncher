import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface ProcessMetrics {
  readonly cpuSeconds: number;
  readonly memoryBytes: number;
}

type MetricsRunner = (
  executable: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string }>;

const defaultRunner: MetricsRunner = async (executable, args) => {
  const result = await execute(executable, [...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3_000,
    maxBuffer: 64 * 1024,
  });
  return { stdout: result.stdout };
};

function finite(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError('Invalid process metrics');
  }
  return parsed;
}

function unixCpuSeconds(value: string): number {
  const match = /^(?:(\d+)-)?(\d+(?::\d+){1,2})$/.exec(value.trim());
  if (!match) {
    throw new TypeError('Invalid process CPU time');
  }
  const days = Number(match[1] ?? 0);
  const fields = match[2].split(':').map(Number);
  if (!fields.length || fields.some((field) => !Number.isFinite(field) || field < 0)) {
    throw new TypeError('Invalid process CPU time');
  }
  return days * 86400 + fields.reduce((total, field) => total * 60 + field, 0);
}

export async function sampleServerProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  runner: MetricsRunner = defaultRunner,
): Promise<ProcessMetrics> {
  if (!Number.isInteger(pid) || pid < 1) {
    throw new TypeError('Invalid process id');
  }
  if (platform === 'win32') {
    const script =
      '& { $p=Get-Process -Id $args[0] -ErrorAction Stop; @{cpuSeconds=[double]$p.CPU;memoryBytes=[double]$p.WorkingSet64}|ConvertTo-Json -Compress }';
    const { stdout } = await runner('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
      String(pid),
    ]);
    const value: unknown = JSON.parse(stdout);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Invalid process metrics');
    }
    const source = value as Record<string, unknown>;
    return { cpuSeconds: finite(source.cpuSeconds), memoryBytes: finite(source.memoryBytes) };
  }
  const { stdout } = await runner('ps', ['-o', 'time=,rss=', '-p', String(pid)]);
  const match = stdout.trim().match(/^(\S+)\s+(\d+)$/);
  if (!match?.[1] || !match[2]) {
    throw new TypeError('Invalid process metrics');
  }
  return { cpuSeconds: unixCpuSeconds(match[1]), memoryBytes: finite(match[2]) * 1024 };
}
