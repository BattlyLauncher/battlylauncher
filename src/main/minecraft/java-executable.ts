import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

async function regularExecutable(path: string): Promise<boolean> {
  return stat(path)
    .then((file) => file.isFile())
    .catch(() => false);
}

/** Read the actual JVM version, rather than trusting the saved path or folder name. */
export async function inspectJavaExecutable(path: string): Promise<number> {
  return (await inspectJavaRuntime(path)).major;
}

export function parseJavaArchitecture(output: string): 'x64' | 'ia32' | 'arm64' | null {
  const value = /^\s*os\.arch\s*=\s*(\S+)\s*$/m.exec(output)?.[1];
  if (/^(amd64|x86_64)$/i.test(value ?? '')) {
    return 'x64';
  }
  if (/^(x86|i[3-6]86)$/i.test(value ?? '')) {
    return 'ia32';
  }
  if (/^(aarch64|arm64)$/i.test(value ?? '')) {
    return 'arm64';
  }
  return null;
}

export async function inspectJavaRuntime(
  path: string,
): Promise<{ major: number; bits: 32 | 64 | null; architecture: 'x64' | 'ia32' | 'arm64' | null }> {
  if (!(await regularExecutable(path))) {
    throw new Error(`No existe el ejecutable de Java: ${path}`);
  }
  const consoleJava = join(dirname(path), 'java.exe');
  const executable =
    process.platform === 'win32' &&
    basename(path).toLowerCase() === 'javaw.exe' &&
    (await regularExecutable(consoleJava))
      ? consoleJava
      : path;
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      ['-XshowSettings:properties', '-version'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 32_768 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`No se pudo ejecutar Java: ${path}`, { cause: error }));
        } else {
          resolve(`${stdout}\n${stderr}`);
        }
      },
    );
  });
  const match = /(?:openjdk|java)\s+version\s+"(?:1\.)?(\d+)/i.exec(output);
  if (!match) {
    throw new Error(`No se pudo identificar la versión de Java: ${path}`);
  }
  const model = /sun\.arch\.data\.model\s*=\s*(32|64)\b/.exec(output);
  return {
    major: Number(match[1]),
    bits: model ? (Number(model[1]) as 32 | 64) : null,
    architecture: parseJavaArchitecture(output),
  };
}
