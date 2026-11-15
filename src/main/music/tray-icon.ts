import { nativeImage, type NativeImage } from 'electron';

/** macOS sizes status items from their image's logical dimensions, not the app icon size. */
export function createTrayIcon(
  path: string,
  platform: NodeJS.Platform = process.platform,
  translate: (source: string) => string = (source) => source,
): string | NativeImage {
  if (platform !== 'darwin') {
    return path;
  }
  const source = nativeImage.createFromPath(path);
  if (source.isEmpty()) {
    throw new Error(translate('No se pudo cargar el icono de Battly'));
  }

  const icon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const pixels = 18 * scaleFactor;
    icon.addRepresentation({
      scaleFactor,
      buffer: source.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG(),
    });
  }
  return icon;
}
