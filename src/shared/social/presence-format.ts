/** Hide Minecraft's default port in status text without changing connection addresses. */
export function formatPresenceServer(text: string): string {
  return text.replace(/:25565(?=$|[\s,;·)\]])/gu, '');
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
