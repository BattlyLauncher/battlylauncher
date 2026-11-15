import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';
import { isHeapArgument } from './launch-memory';

export interface WindowsMemorySnapshot {
  commitLimitBytes: number;
  availableCommitBytes: number;
  physicalTotalBytes: number;
  physicalAvailableBytes: number;
}
export interface LaunchMemoryAssessment {
  severity: 'safe' | 'warning' | 'critical' | 'unknown';
  availableCommitMiB: number;
  physicalAvailableMiB: number;
  configuredMiB: number;
  recommendedMiB: number | null;
}
export type LaunchMemoryDecision = 'cancel' | 'retry' | 'adjust' | 'settings' | 'continue';
export class LaunchMemoryCancelledError extends Error {
  constructor() {
    super('Minecraft launch cancelled during memory preflight');
  }
}

export function parseWindowsMemorySnapshot(value: unknown): WindowsMemorySnapshot {
  if (!value || typeof value !== 'object') {
    throw Error('Invalid Windows memory counters');
  }
  const data = value as Record<string, unknown>;
  for (const key of [
    'commitLimitBytes',
    'availableCommitBytes',
    'physicalTotalBytes',
    'physicalAvailableBytes',
  ]) {
    if (typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || data[key] < 0) {
      throw Error('Invalid Windows memory counter');
    }
  }
  const result = data as unknown as WindowsMemorySnapshot;
  if (
    result.commitLimitBytes <= 0 ||
    result.physicalTotalBytes <= 0 ||
    result.availableCommitBytes > result.commitLimitBytes ||
    result.physicalAvailableBytes > result.physicalTotalBytes
  ) {
    throw Error('Inconsistent Windows memory counters');
  }
  return result;
}

// System-wide CommitLimit - CommitTotal, not free RAM or free disk space.
// https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getperformanceinfo
const probe = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BattlyMemoryCounters {
 [StructLayout(LayoutKind.Sequential)]
 public struct Info {
  public uint cb;
  public UIntPtr CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable;
  public UIntPtr SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize;
  public uint HandleCount, ProcessCount, ThreadCount;
 }
 [DllImport("psapi.dll", SetLastError=true)]
 [return: MarshalAs(UnmanagedType.Bool)]
 public static extern bool GetPerformanceInfo(ref Info info, uint size);
}
'@
$m = New-Object BattlyMemoryCounters+Info
$m.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($m)
if (-not [BattlyMemoryCounters]::GetPerformanceInfo([ref]$m, $m.cb)) { throw 'GetPerformanceInfo failed' }
$page = $m.PageSize.ToUInt64()
@{
 commitLimitBytes = $m.CommitLimit.ToUInt64() * $page
 availableCommitBytes = ($m.CommitLimit.ToUInt64() - $m.CommitTotal.ToUInt64()) * $page
 physicalTotalBytes = $m.PhysicalTotal.ToUInt64() * $page
 physicalAvailableBytes = $m.PhysicalAvailable.ToUInt64() * $page
} | ConvertTo-Json -Compress
`;
export async function readWindowsMemorySnapshot(): Promise<WindowsMemorySnapshot> {
  if (process.platform !== 'win32') {
    throw Error('Windows memory counters are unavailable on this OS');
  }
  const executable = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const { stdout } = await promisify(execFile)(
    executable,
    ['-NoProfile', '-NonInteractive', '-Command', probe],
    { windowsHide: true, timeout: 8000, maxBuffer: 32768, encoding: 'utf8' },
  );
  return parseWindowsMemorySnapshot(JSON.parse(stdout.trim()) as unknown);
}

export function assessLaunchMemory(
  snapshot: WindowsMemorySnapshot,
  memory: MinecraftLaunchOptions['memory'],
  usefulHeapMiB = 1024,
): LaunchMemoryAssessment {
  const current = parseWindowsMemorySnapshot(snapshot);
  const availableCommitMiB = Math.floor(current.availableCommitBytes / 1024 ** 2);
  const physicalAvailableMiB = Math.floor(current.physicalAvailableBytes / 1024 ** 2);
  // Leave 1 GiB for native JVM allocations plus 512 MiB for other processes.
  const budget = Math.floor((availableCommitMiB - 1536) / 256) * 256;
  const required = Math.max(usefulHeapMiB, memory.minimumMiB);
  const critical = budget < required;
  const recommendedMiB = critical
    ? null
    : Math.min(
        memory.maximumMiB,
        budget,
        Math.max(required, Math.floor((physicalAvailableMiB - 512) / 256) * 256),
      );
  return {
    severity: critical
      ? 'critical'
      : memory.maximumMiB > budget || physicalAvailableMiB < 512
        ? 'warning'
        : 'safe',
    availableCommitMiB,
    physicalAvailableMiB,
    configuredMiB: memory.maximumMiB,
    recommendedMiB,
  };
}

interface Dependencies {
  supported: boolean;
  read: () => Promise<WindowsMemorySnapshot>;
  ask: (assessment: LaunchMemoryAssessment) => Promise<LaunchMemoryDecision>;
  openSettings: () => Promise<void>;
}
export class LaunchMemoryPreflight {
  constructor(private readonly dependencies: Dependencies) {}
  async prepare(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
  ): Promise<MinecraftLaunchOptions> {
    if (!this.dependencies.supported || options.installOnly) {
      return options;
    }
    for (;;) {
      let assessment: LaunchMemoryAssessment;
      try {
        assessment = assessLaunchMemory(
          await this.dependencies.read(),
          options.memory,
          /^1\.(?:[0-9]|1[012])(?:\.|$)/.test(options.version.id) ? 1024 : 2048,
        );
      } catch {
        assessment = {
          severity: 'unknown',
          availableCommitMiB: 0,
          physicalAvailableMiB: 0,
          configuredMiB: options.memory.maximumMiB,
          recommendedMiB: null,
        };
      }
      emit({
        type: 'log',
        stream: 'game',
        message: `[memory-preflight] ${JSON.stringify(assessment)}`,
      });
      if (assessment.severity === 'safe') {
        return options;
      }
      const decision = await this.dependencies.ask(assessment);
      if (decision === 'retry') {
        continue;
      }
      if (decision === 'settings') {
        try {
          await this.dependencies.openSettings();
        } catch {
          emit({
            type: 'log',
            stream: 'game',
            message: '[memory-preflight] Could not open Windows advanced settings',
          });
        }
        continue;
      }
      if (decision === 'continue' && assessment.severity === 'unknown') {
        return options;
      }
      if (
        decision === 'adjust' &&
        assessment.severity === 'warning' &&
        assessment.recommendedMiB !== null
      ) {
        options = {
          ...options,
          memory: {
            maximumMiB: assessment.recommendedMiB,
            minimumMiB: Math.min(options.memory.minimumMiB, assessment.recommendedMiB),
          },
          javaArguments: options.javaArguments.filter((argument) => !isHeapArgument(argument)),
        };
        continue; // Fresh counters before accepting the temporary adjustment.
      }
      throw new LaunchMemoryCancelledError();
    }
  }
}
