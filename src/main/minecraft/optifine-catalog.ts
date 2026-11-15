export const optifineDownloadsUrl = 'https://optifine.net/downloads';

export interface OptiFineRelease {
  readonly minecraftVersion: string;
  readonly version: string;
  readonly filename: string;
  readonly isStable: boolean;
  readonly forgeVersion?: string | null;
}

/** Includes the releases hidden behind More/Preview on the official page. */
export function parseOptiFineCatalog(html: string): readonly OptiFineRelease[] {
  const releases = new Map<string, OptiFineRelease>();
  for (const match of html.matchAll(
    /\b((preview_)?OptiFine_(\d+\.\d+(?:\.\d+)?)_HD_([A-Za-z0-9_]+)\.jar)\b/g,
  )) {
    const [, filename, preview, minecraftVersion, version] = match;
    const rowStart = html.lastIndexOf('<tr', match.index);
    const rowEnd = html.indexOf('</tr>', match.index);
    const forge =
      rowStart >= 0 && rowEnd >= 0
        ? html
            .slice(rowStart, rowEnd)
            .match(/class=['"](?:colForge|downloadLineForge)['"][^>]*>\s*Forge\s+([^<\r\n]+)/i)?.[1]
            ?.trim()
            .replace(/^#/, '')
        : undefined;
    releases.set(filename, {
      filename,
      minecraftVersion,
      version,
      isStable: !preview && !/pre\d/i.test(version),
      ...(forge ? { forgeVersion: /^\d[\d.]*$/.test(forge) ? forge : null } : {}),
    });
  }
  return [...releases.values()];
}

export async function fetchOptiFineCatalog(
  fetcher: typeof fetch = fetch,
): Promise<readonly OptiFineRelease[]> {
  const response = await fetcher(optifineDownloadsUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) {
    throw new Error('No se pudo consultar el catálogo oficial de OptiFine');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      throw new Error('Catálogo OptiFine demasiado grande');
    }
    chunks.push(chunk);
  }
  const releases = parseOptiFineCatalog(Buffer.concat(chunks).toString('utf8'));
  if (!releases.length) {
    throw new Error('El catálogo oficial de OptiFine no contiene versiones');
  }
  return releases;
}
