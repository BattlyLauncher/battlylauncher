import { spawn } from 'node:child_process';
import {
  isMinecraftClientReadyMessage,
  type MinecraftLaunchEvent,
} from '../../shared/minecraft/launch-contract';

/** Windows confirms a visible GLFW/LWJGL window owned by the launched Java PID. */
export async function waitForVisibleMinecraftWindow(
  pid: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class BattlyGameWindow {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback c, IntPtr p);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int size);
 public static bool Visible(uint wanted) {
  bool found=false;
  EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);
   if(owner==wanted && IsWindowVisible(h)){var name=new StringBuilder(256);GetClassName(h,name,256);
    if(name.ToString().StartsWith("GLFW") || name.ToString().StartsWith("LWJGL")){found=true;return false;}}
   return true;},IntPtr.Zero);return found;
 }
}
'@
for($attempt=0;$attempt -lt 1200;$attempt++) {
 if (-not (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { exit }
 if ([BattlyGameWindow]::Visible(${pid})) { Write-Output 'visible';exit }
 Start-Sleep -Milliseconds 500
}`;
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], signal },
    );
    let visible = false;
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('visible')) {
        visible = true;
      }
    });
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(visible && !signal.aborted));
  });
}

export class MinecraftClientReadyObserver {
  #abort: AbortController | undefined;
  #ready = false;
  #ended = false;
  #renderReady = false;
  #hasProcess = false;
  #renderFallback: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly emit: (event: MinecraftLaunchEvent) => void,
    private readonly platform = process.platform,
    private readonly probe = waitForVisibleMinecraftWindow,
  ) {}
  observe(event: MinecraftLaunchEvent): void {
    if (
      event.type === 'exit' ||
      (event.type === 'state' && ['failed', 'exited'].includes(event.state))
    ) {
      this.#ended = true;
      this.#abort?.abort();
      clearTimeout(this.#renderFallback);
      return;
    }
    if (this.#ready || this.#ended) {
      return;
    }
    if (event.type === 'process' && this.platform === 'win32') {
      this.#hasProcess = true;
      this.#abort?.abort();
      const controller = (this.#abort = new AbortController());
      void this.probe(event.pid, controller.signal)
        .then((visible) => {
          if (visible && !controller.signal.aborted) {
            this.#confirm();
          }
        })
        .catch(() => undefined);
      this.#scheduleRenderFallback();
    } else if (event.type === 'log' && isMinecraftClientReadyMessage(event.message)) {
      if (this.platform !== 'win32') {
        this.#confirm();
      } else {
        this.#renderReady = true;
        this.#scheduleRenderFallback();
      }
    }
  }
  #scheduleRenderFallback(): void {
    if (!this.#hasProcess || !this.#renderReady || this.#renderFallback) {
      return;
    }
    // Some Windows setups block the helper or expose a different window class.
    // Keep native detection as the fast path; require actual rendering readiness
    // and a grace period before falling back. Never infer readiness from Java spawn.
    this.#renderFallback = setTimeout(() => this.#confirm(), 8000);
    this.#renderFallback.unref();
  }
  #confirm(): void {
    if (this.#ready || this.#ended) {
      return;
    }
    this.#ready = true;
    clearTimeout(this.#renderFallback);
    this.#abort?.abort();
    this.emit({ type: 'client-ready' });
  }
}
