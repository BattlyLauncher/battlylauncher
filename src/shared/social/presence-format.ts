import { neoForgeMinecraftVersion } from '../minecraft/play-version-presentation';

/** Hide Minecraft's default port in status text without changing connection addresses. */
export function formatPresenceServer(text: string): string {
  return text.replace(/:25565(?=$|[\s,;·)\]])/gu, '');
}

const gameVersion = String.raw`(?:1\.\d+(?:\.\d+)?|(?:2[6-9]|[3-9]\d)\.\d+(?:\.\d+)?)(?:-(?:pre|rc|snapshot)-?\d+)?|\d{2}w\d{2}[a-z]`;
const loaders = String.raw`legacy[ -]?fabric|neoforge|optifine|minecraft|fabric|quilt|forge|vanilla`;
const loaderFirst = new RegExp(`^(${loaders})[ _-]+(${gameVersion})(?:\\s+\\([^)]+\\))?$`, 'i');
const gameFirst = new RegExp(`^(${gameVersion})[ _-]+(${loaders})(?:[-_][\\w.+-]+)?$`, 'i');
const fabricOrQuiltId = new RegExp(
  `^(legacyfabric|fabric|quilt)-loader-\\d+\\.\\d+(?:\\.\\d+)?(?:-[a-z]+[\\d.]*)?-(${gameVersion})$`,
  'i',
);

export function parseMinecraftPresence(text: string): { loader: string; version: string } | null {
  const value = text.trim();
  const neoForgeId = /^neoforge[ _-]+(\d{2}\.\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?)$/i.exec(value);
  const neoForgeGame = neoForgeId && neoForgeMinecraftVersion(neoForgeId[1]);
  if (neoForgeGame) {
    return { loader: 'neoforge', version: neoForgeGame };
  }
  const prefixed = loaderFirst.exec(value) ?? fabricOrQuiltId.exec(value);
  const suffixed = prefixed ? null : gameFirst.exec(value);
  const loader = (prefixed?.[1] ?? suffixed?.[2])?.toLowerCase().replace(/[ -]/g, '');
  const version = prefixed?.[2] ?? suffixed?.[1];
  if (!loader || !version) {
    return null;
  }
  return { loader: loader === 'minecraft' ? 'vanilla' : loader, version };
}

export function formatPresenceVersion(text: string): string {
  const names: Record<string, string> = {
    fabric: 'Fabric',
    legacyfabric: 'Legacy Fabric',
    quilt: 'Quilt',
    forge: 'Forge',
    neoforge: 'NeoForge',
    optifine: 'OptiFine',
    vanilla: 'Minecraft',
    minecraft: 'Minecraft',
  };
  return text.replace(
    /\b(?:legacyfabric|neoforge|optifine|minecraft|fabric|quilt|forge|vanilla)\b/gi,
    (name) => names[name.toLowerCase()],
  );
}
