import { statSync } from 'node:fs';
import AdmZip from 'adm-zip';

/** A native classifier is extracted by getNatives, not a regular classpath JAR. */
export function isNativeOnlyLibrary(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') {
    return false;
  }
  const library = raw as { name?: string; natives?: unknown; downloads?: { artifact?: unknown } };
  return (
    typeof library.name === 'string' &&
    library.name.split(':').length === 3 &&
    Boolean(library.natives && typeof library.natives === 'object') &&
    !library.downloads?.artifact
  );
}

/** Old Forge installs often omit the universal classifier from Maven coordinates. */
export function normalizeLegacyForgeLibraries(libraries: readonly unknown[]): unknown[] {
  return libraries.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    const library = raw as { name?: string; downloads?: unknown; url?: string };
    const match =
      /^net\.minecraftforge:forge:(1\.(?:[0-9]|1[0-2])(?:\.[0-9]+)?-[a-zA-Z0-9._-]+)$/.exec(
        library.name ?? '',
      );
    if (!match || library.downloads) {
      return raw;
    }
    return {
      ...library,
      name: `${library.name}:universal`,
      url: library.url || 'https://maven.minecraftforge.net/',
    };
  });
}

export function verifyLauncherLibraries(files: readonly string[]): void {
  for (const file of files) {
    const info = statSync(file);
    if (!info.isFile() || !info.size) {
      throw new Error(`MCLC_INVALID_LIBRARY: ${file}`);
    }
    if (
      /forge-1\.8\.9-[^/\\]+-universal\.jar$/i.test(file) &&
      !new AdmZip(file).getEntry('net/minecraftforge/fml/common/launcher/FMLTweaker.class')
    ) {
      throw new Error(`MCLC_INVALID_FORGE_JAR: ${file}`);
    }
  }
}

/** Legacy custom profiles omit URLs for ordinary Mojang Maven libraries.
 * Explicit download metadata (including generated artifacts) must stay untouched. */
export function normalizeLegacyLibraryRepositories(libraries: readonly unknown[]): unknown[] {
  return libraries.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }
    const lib = raw as { name?: string; url?: unknown; downloads?: unknown };
    if (
      lib.url ||
      lib.downloads ||
      !/^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.+~-]+(?::[a-zA-Z0-9_.-]+)?$/.test(
        lib.name ?? '',
      )
    ) {
      return raw;
    }
    return { ...lib, url: 'https://libraries.minecraft.net/' };
  });
}
