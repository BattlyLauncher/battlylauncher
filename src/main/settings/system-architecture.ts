import { machine } from 'node:os';
export function systemArchitecture(): NodeJS.Architecture {
  const host =
    process.platform === 'win32'
      ? process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || machine()
      : machine();
  if (/^(amd64|x86_64)$/i.test(host)) {
    return 'x64';
  }
  if (/^(arm64|aarch64)$/i.test(host)) {
    return 'arm64';
  }
  if (/^(x86|i[3-6]86)$/i.test(host)) {
    return 'ia32';
  }
  return process.arch;
}
