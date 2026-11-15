import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export interface BypackAssociationOptions {
  readonly executablePath: string;
  readonly appPath?: string;
  readonly iconPath: string;
}

function quotedPath(path: string): string {
  if (!win32.isAbsolute(path) || /["\r\n\0]/.test(path)) {
    throw new Error('Ruta inválida para registrar .bypack');
  }
  return `"${path.replace(/\\+$/, (suffix) => suffix + suffix)}"`;
}

export function bypackAssociationValues(options: BypackAssociationOptions): {
  command: string;
  icon: string;
} {
  const command = [quotedPath(options.executablePath)];
  if (options.appPath) {
    command.push(quotedPath(options.appPath));
  }
  command.push('"%1"');
  return { command: command.join(' '), icon: `${quotedPath(options.iconPath)},0` };
}

export async function registerBypackAssociation(options: BypackAssociationOptions): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }
  const data = Buffer.from(JSON.stringify(bypackAssociationValues(options))).toString('base64');
  // Only base64 data is interpolated. Paths never become PowerShell or shell code.
  const script = `
$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$script:changed = $false
function Set-AssociationValue([string]$path, [string]$name, [string]$value) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($path)
  try {
    if ($key.GetValue($name, $null) -cne $value) {
      $key.SetValue($name, $value, [Microsoft.Win32.RegistryValueKind]::String)
      $script:changed = $true
    }
  } finally { $key.Dispose() }
}
$classes = 'Software\\Classes\\'
$progId = 'BattlyLauncher.Bypack'
Set-AssociationValue ($classes + $progId) '' 'Battly Pack'
Set-AssociationValue ($classes + $progId + '\\DefaultIcon') '' $data.icon
Set-AssociationValue ($classes + $progId + '\\shell\\open\\command') '' $data.command
Set-AssociationValue ($classes + '.bypack\\OpenWithProgids') $progId ''
Set-AssociationValue ($classes + '.bypack') '' $progId
if ($script:changed) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BattlyAssociationShell { [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2); }'
  [BattlyAssociationShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}
`;
  await execute(
    win32.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 },
  );
}
