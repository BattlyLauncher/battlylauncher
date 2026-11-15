import { spawn } from 'node:child_process';

export interface ServerCpuLimit {
  close(): void;
}

// Windows uses a CPU job quota, not priority or affinity. CpuRate is percent * 100.
// https://learn.microsoft.com/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information
const windowsHelper = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BattlyCpuJob {
  [StructLayout(LayoutKind.Sequential)] public struct Rate { public uint Flags; public uint CpuRate; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Rate rate, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Run(uint pid, uint percent) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    IntPtr process = IntPtr.Zero;
    try {
      var rate = new Rate { Flags = 5, CpuRate = percent * 100 };
      if (!SetInformationJobObject(job, 15, ref rate, 8)) throw new Win32Exception();
      process = OpenProcess(0x101, false, pid);
      if (process == IntPtr.Zero || !AssignProcessToJobObject(job, process)) throw new Win32Exception();
      Console.WriteLine("READY");
      while (Console.ReadLine() != null) {}
    } finally {
      var unlimited = new Rate();
      SetInformationJobObject(job, 15, ref unlimited, 8);
      if (process != IntPtr.Zero) CloseHandle(process);
      CloseHandle(job);
    }
  }
}
'@
`;

// A separate helper keeps the Unix duty cycle independent of the launcher UI.
// Closing its stdin (including a launcher exit) always resumes the server.
const unixHelper = String.raw`
const pid = Number(process.argv[1]), percent = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 1 || !Number.isInteger(percent) || percent < 1 || percent >= 100) process.exit(1);
let timer, paused = false, closing = false;
function finish() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  if (paused) { try { process.kill(pid, 'SIGCONT'); } catch {} }
  process.exit(0);
}
function cycle() {
  try { process.kill(pid, 'SIGCONT'); paused = false; } catch { return finish(); }
  timer = setTimeout(() => {
    try { process.kill(pid, 'SIGSTOP'); paused = true; } catch { return finish(); }
    timer = setTimeout(cycle, 100 - percent);
  }, percent);
}
process.stdin.resume();
process.stdin.on('end', finish);
process.on('SIGTERM', finish);
process.on('SIGINT', finish);
process.on('SIGHUP', finish);
process.on('uncaughtException', finish);
process.on('exit', () => { if (paused) { try { process.kill(pid, 'SIGCONT'); } catch {} } });
cycle();
process.stdout.write('READY\n');
`;

export async function limitServerCpu(
  pid: number,
  percent: number,
  failed: () => void = () => {},
): Promise<ServerCpuLimit> {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 1 ||
    pid === process.pid ||
    !Number.isInteger(percent) ||
    percent < 1 ||
    percent > 100
  ) {
    throw new TypeError('Invalid server CPU limit');
  }
  if (percent === 100) {
    return { close() {} };
  }
  if (!['win32', 'linux', 'darwin'].includes(process.platform)) {
    throw new Error('Server CPU limiting is not supported on this platform');
  }
  const script = `${windowsHelper}\n[BattlyCpuJob]::Run(${pid}, ${percent})`;
  const helper =
    process.platform === 'win32'
      ? spawn(
          'powershell.exe',
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false },
        )
      : spawn(process.execPath, ['-e', unixHelper, String(pid), String(percent)], {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });
  let closed = false,
    ready = false;
  helper.stdin.on('error', () => {});
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      close();
      reject(new Error('Server CPU limiter timed out'));
    }, 15_000);
    const close = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeout(timer);
      helper.stdin.end();
    };
    const failure = (): void => {
      clearTimeout(timer);
      if (closed) {
        return;
      }
      closed = true;
      if (process.platform !== 'win32') {
        try {
          process.kill(pid, 'SIGCONT');
        } catch {
          /* The server may already have exited. */
        }
      }
      if (ready) {
        failed();
      } else {
        reject(new Error('No se pudo aplicar el límite de CPU del servidor'));
      }
    };
    helper.on('error', failure);
    helper.on('exit', failure);
    helper.stderr.resume();
    helper.stdout.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-512);
      if (!ready && !closed && /(?:^|\n)READY\r?\n/.test(output)) {
        ready = true;
        clearTimeout(timer);
        resolve({ close });
      }
    });
  });
}
