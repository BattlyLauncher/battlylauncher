interface PlayOption {
  id: string;
  version: string;
  installedAt?: number;
}

const loaderNames: Readonly<Record<string, string>> = {
  legacyfabric: 'Legacy Fabric',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  optifine: 'OptiFine',
  labymod: 'LabyMod',
};

export function comparePlayOptions(
  left: PlayOption,
  right: PlayOption,
  sort: string,
  direction: string,
): number {
  const sign = direction === 'asc' ? 1 : -1;
  let compared: number;
  if (sort === 'recent') {
    compared = (left.installedAt ?? 0) - (right.installedAt ?? 0);
  } else if (sort === 'name') {
    compared = formatPlayVersion(left.id).localeCompare(formatPlayVersion(right.id), undefined, {
      numeric: true,
    });
  } else {
    compared = left.version.localeCompare(right.version, undefined, { numeric: true });
  }
  return sign * (compared || left.id.localeCompare(right.id, undefined, { numeric: true }));
}

export function formatPlayVersion(version = ''): string {
  version = version.trim();
  const displayLoader =
    /^(legacy[ -]?fabric|fabric|forge|neoforge|quilt|optifine|labymod)(?=\s)/i.exec(version);
  if (displayLoader) {
    const name = loaderNames[displayLoader[1].toLowerCase().replace(/[ -]/g, '')];
    const label = name + version.slice(displayLoader[0].length);
    if (name === 'Forge') {
      return label.replace(
        /^(Forge (\d+\.\d+(?:\.\d+)?)) \(([^)]+)\)$/,
        (_match, prefix: string, game: string, build: string) => {
          const loaderVersion = build.startsWith(game + '-') ? build.slice(game.length + 1) : build;
          return `${prefix} (${loaderVersion})`;
        },
      );
    }
    return label;
  }
  const lower = version.toLowerCase();
  const oldLaby = version.match(/labymod[\s-]+4-(\d+\.\d+(?:\.\d+)?)-([a-f0-9]{8})/i);
  if (oldLaby) {
    return `LabyMod ${oldLaby[1]} (${oldLaby[2]})`;
  }
  if (lower.startsWith('labymod-')) {
    return `LabyMod ${version.slice('labymod-'.length)}`;
  }
  if (lower.startsWith('labymod ')) {
    return version.replace(/^labymod\s+/i, 'LabyMod ');
  }
  if (lower.startsWith('cmpack_') || lower.startsWith('cmpack-')) {
    return `CM-Pack ${version.slice(7)}`;
  }
  if (/optifine/i.test(version)) {
    const match = version.match(
      /^(\d+\.\d+(?:\.\d+)?)-optifine[_-]?(?:hd)?[_-]?(?:[iu])?[_-]?(.*)/i,
    );
    if (match) {
      return `OptiFine ${match[1]}${match[2] ? ` (${match[2]})` : ''}`;
    }
    const minecraft = version.match(/(?:^|\s)(\d+\.\d+(?:\.\d+)?)(?:\s|$)/)?.[1];
    const build = version.match(/\(([^)]+)\)/)?.[1];
    return `OptiFine${minecraft ? ` ${minecraft}` : ''}${build ? ` (${build})` : ''}`;
  }
  const legacy = version.match(/^legacyfabric-(?:loader-)?([0-9.]+)-(.+)$/i);
  if (legacy) {
    return `Legacy Fabric ${legacy[2]} (${legacy[1]})`;
  }
  const fabric = version.match(/^fabric-loader-([0-9.]+(?:-[a-z]+[0-9.]*)?)-(.+)$/i);
  if (fabric) {
    return `Fabric ${fabric[2]} (${fabric[1]})`;
  }
  const neoForge = version.match(/neoforge[_-]?(\d+)\.(\d+)\.(\d+)/i);
  if (neoForge) {
    return `NeoForge 1.${neoForge[1]}.${neoForge[2]} (${neoForge[3]})`;
  }
  if (lower.includes('forge') && !lower.includes('neoforge')) {
    const forge = version.match(/(\d+\.\d+(?:\.\d+)?)-forge[_-]?([0-9.]+)?/i);
    if (forge) {
      return `Forge ${forge[1]}${forge[2] ? ` (${forge[2]})` : ''}`;
    }
  }
  const quilt = version.match(/^quilt-loader-([0-9.]+(?:-[a-z]+[0-9.]*)?)-(.+)$/i);
  if (quilt) {
    return `Quilt ${quilt[2]} (${quilt[1]})`;
  }
  const legacyFabric = version.match(/legacyfabric-?(?:loader)?-?([0-9.]+)?-?([0-9.]+)?/i);
  if (legacyFabric?.[2]) {
    return `Legacy Fabric ${legacyFabric[2]}${legacyFabric[1] ? ` (${legacyFabric[1]})` : ''}`;
  }
  const loaderSuffix = /-(forge|fabric|quilt|legacyfabric|neoforge)$/i.exec(version);
  if (loaderSuffix) {
    const name = loaderNames[loaderSuffix[1].toLowerCase()];
    return `${name} ${version.slice(0, loaderSuffix.index).trim()}`;
  }
  return version;
}
