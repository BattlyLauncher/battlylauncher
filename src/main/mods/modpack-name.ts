export function normalizeModpackName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function names(name: string): string[] {
  const result = [normalizeModpackName(name)];
  const suffix = /^(.*?)\s+[-–—]\s+([a-z]+\s*\d*)$/i.exec(name);
  if (suffix?.[1] && suffix[2]) {
    const words = suffix[1].match(/[a-z]+|\d+/gi) ?? [];
    const abbreviation = words.map((word) => (/^\d/.test(word) ? word : word[0])).join('');
    if (normalizeModpackName(abbreviation) === normalizeModpackName(suffix[2])) {
      result.push(normalizeModpackName(suffix[1]));
    }
  }
  return result;
}

export function sameModpackName(name: string, candidate: string): boolean {
  const expected = names(name);
  return names(candidate).some((alias) => expected.includes(alias));
}

export function modpackSlugs(name: string): readonly string[] {
  const slug = (value: string): string =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/([a-z])(\d)/g, '$1-$2')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const base = name.split(/\s+[-–—]\s+/)[0] ?? name;
  return [...new Set([slug(name), slug(base)])].filter(
    (value) => value.length >= 3 && value.length <= 160,
  );
}
