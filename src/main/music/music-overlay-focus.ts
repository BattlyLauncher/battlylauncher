import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

// This helper sees window handles and process IDs only. It never reads window contents.
const script = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class BattlyMusicFocus {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 public static uint Owner(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return pid; }
 public static bool Restore(long handle, uint pid) {
  IntPtr window = new IntPtr(handle);
  return IsWindow(window) && Owner(window) == pid && SetForegroundWindow(window);
 }
}
'@
[Console]::WriteLine('READY')
while ($null -ne ($line=[Console]::ReadLine())) {
 try {
  $request=ConvertFrom-Json $line
  if ($request.type -eq 'capture') {
   $window=[BattlyMusicFocus]::GetForegroundWindow()
   $response=@{id=$request.id;handle=$window.ToInt64().ToString();pid=[BattlyMusicFocus]::Owner($window)}
  } else {
   $response=@{id=$request.id;ok=[BattlyMusicFocus]::Restore([long]$request.handle,[uint32]$request.pid)}
  }
  [Console]::WriteLine(($response|ConvertTo-Json -Compress))
 } catch { [Console]::WriteLine((@{id=$request.id;ok=$false}|ConvertTo-Json -Compress)) }
}
`;

export interface MusicOverlayFocus {
  capture(): Promise<void>;
  restore(): Promise<boolean>;
  dispose(): void;
}
export class WindowsMusicOverlayFocus implements MusicOverlayFocus {
  #helper?: ChildProcessWithoutNullStreams;
  #ready?: Promise<void>;
  #anchor?: { handle: string; pid: number };
  #sequence = 0;
  #pending = new Map<number, (value: Record<string, unknown>) => void>();
  #disposed = false;

  async #start(): Promise<void> {
    if (this.#disposed || process.platform !== 'win32') {
      return;
    }
    return (this.#ready ??= new Promise((resolve, reject) => {
      const child = (this.#helper = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false },
      ));
      let buffered = '',
        ready = false;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Music focus helper timed out'));
      }, 5000);
      const closed = (): void => {
        clearTimeout(timer);
        if (!ready) {
          reject(new Error('Music focus helper closed'));
        }
        for (const complete of this.#pending.values()) {
          complete({});
        }
        this.#pending.clear();
        this.#ready = undefined;
        if (this.#helper === child) {
          this.#helper = undefined;
        }
      };
      child.stdin.on('error', () => {});
      child.on('error', closed);
      child.on('exit', closed);
      child.stderr.resume();
      child.stdout.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        if (buffered.length > 8192) {
          child.kill();
          return;
        }
        let end: number;
        while ((end = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, end).trim();
          buffered = buffered.slice(end + 1);
          if (line === 'READY') {
            ready = true;
            clearTimeout(timer);
            resolve();
            continue;
          }
          try {
            const value = JSON.parse(line) as Record<string, unknown>;
            const id = Number(value.id);
            this.#pending.get(id)?.(value);
            this.#pending.delete(id);
          } catch {
            /* Ignore malformed helper output. */
          }
        }
      });
    }));
  }
  async #request(value: object): Promise<Record<string, unknown>> {
    try {
      await this.#start();
    } catch {
      return {};
    }
    if (!this.#helper || this.#disposed) {
      return {};
    }
    const id = ++this.#sequence;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({});
      }, 1000);
      this.#pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      this.#helper!.stdin.write(JSON.stringify({ ...value, id }) + '\n');
    });
  }
  async capture(): Promise<void> {
    const result = await this.#request({ type: 'capture' });
    this.#anchor =
      typeof result.handle === 'string' &&
      /^\d{1,20}$/.test(result.handle) &&
      Number.isInteger(result.pid) &&
      Number(result.pid) > 0
        ? { handle: result.handle, pid: Number(result.pid) }
        : undefined;
  }
  async restore(): Promise<boolean> {
    if (!this.#anchor) {
      return false;
    }
    const anchor = this.#anchor;
    return (await this.#request({ type: 'restore', ...anchor })).ok === true;
  }
  dispose(): void {
    this.#disposed = true;
    this.#helper?.stdin.end();
    for (const complete of this.#pending.values()) {
      complete({});
    }
    this.#pending.clear();
  }
}
