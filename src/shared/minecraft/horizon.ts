export const horizonMinecraftVersion = '26.3';
export const horizonPlayVersionId = `horizon-${horizonMinecraftVersion}`;

export function horizonArchive(platform: string, arch: string): string | undefined {
  if (platform === 'linux' && arch === 'x64') {
    return 'horizon-linux-x86_64.tar.gz';
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    return `horizon-windows-${arch}.zip`;
  }
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return `horizon-macos-${arch}.zip`;
  }
  return undefined;
}
