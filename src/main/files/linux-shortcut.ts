import { mkdir, chmod } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { writeFileAtomically } from './atomic-file';

// Desktop Entry strings and Exec arguments have separate escaping layers.
function desktopString(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new TypeError('Invalid desktop entry value');
  }
  return value.replaceAll('\\', '\\\\');
}

export function desktopArgument(value: string): string {
  return desktopString(`"${value.replaceAll('%', '%%').replace(/[\\"`$]/g, '\\$&')}"`);
}

export async function createLinuxShortcut(
  path: string,
  options: {
    label: string;
    executable: string;
    args: readonly string[];
    icon: string;
  },
): Promise<void> {
  if (!isAbsolute(path) || !isAbsolute(options.executable)) {
    throw new TypeError('Shortcut paths must be absolute');
  }
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${desktopString(options.label)}`,
    `Exec=${[options.executable, ...options.args].map(desktopArgument).join(' ')}`,
    `Icon=${desktopString(options.icon)}`,
    'Terminal=false',
    'Categories=Game;',
    '',
  ].join('\n');
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomically(path, content);
  await chmod(path, 0o755);
}
