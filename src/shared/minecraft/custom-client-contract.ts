export interface BattlyCustomClient {
  readonly id: string;
  readonly name: string;
  readonly folderName: string;
  readonly downloadUrl: string;
  readonly requiredJavaVersion: string | null;
  readonly sha256?: string;
  readonly size?: number;
}

function own(source: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(source, key)?.value as unknown;
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid custom client ${label}`);
  }
  const text = value.trim();
  if (
    !text ||
    text.length > maximum ||
    [...text].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new TypeError(`Invalid custom client ${label}`);
  }
  return text;
}

export function validateBattlyCustomClients(value: unknown): readonly BattlyCustomClient[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid Battly versions catalog');
  }
  const versions = own(value as Record<string, unknown>, 'versions');
  if (!Array.isArray(versions)) {
    throw new TypeError('Invalid Battly versions catalog');
  }
  const clients: BattlyCustomClient[] = [];
  for (const item of versions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const source = item as Record<string, unknown>;
    if (own(source, 'type') !== 'client') {
      continue;
    }
    try {
      const id = safeText(own(source, 'version'), 'id', 64);
      const name = safeText(own(source, 'name'), 'name', 128);
      const folderName = safeText(own(source, 'folderName'), 'folder', 128);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(folderName)) {
        throw new TypeError('Invalid custom client folder');
      }
      const rawUrl = own(source, 'downloadUrl') ?? own(source, 'downlaodUrl');
      const downloadUrl = safeText(rawUrl, 'URL', 2048);
      const url = new URL(downloadUrl);
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new TypeError('Invalid custom client URL');
      }
      const rawJava = own(source, 'requiredJavaVersion');
      clients.push({
        id,
        name,
        folderName,
        downloadUrl: url.toString(),
        requiredJavaVersion:
          typeof rawJava === 'string' && /^\d{1,2}$/.test(rawJava) ? rawJava : null,
      });
    } catch {
      // One malformed client must not reject valid updates and silently reuse
      // an older catalog. Invalid entries remain unavailable for installation.
      continue;
    }
  }
  return clients;
}

export function normalizeCustomClientId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) {
    throw new TypeError('Invalid custom client id');
  }
  return value;
}
