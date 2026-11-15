import type { DiagnosticSource } from './local-crash-diagnostics';

// Keep inventory ownership source-local: a nested Fabric API module is not
// necessarily a separate JAR in mods/, and must never be matched by filename.
export function fabricNamespaceContext(sources: readonly DiagnosticSource[]) {
  for (const source of [...sources].reverse()) {
    const lines = source.content.split(/\r?\n/);
    const mismatch =
      /Namespace\s*\(([^)\r\n]{1,64})\)\s*does not match current runtime namespace\s*\(([^)\r\n]{1,64})\)/i;
    let index = lines.length - 1;
    while (index >= 0 && !mismatch.test(lines[index])) {
      index--;
    }
    if (index < 0) {
      continue;
    }
    const namespaces = lines[index].match(mismatch)!;
    const failure = lines
      .slice(Math.max(0, index - 16), index + 1)
      .join('\n')
      .match(/Failed to read (?:classTweaker|accessWidener) file from mod\s+([a-z0-9_.-]+)/i);
    const moduleId = failure?.[1]?.toLowerCase();
    const owners = new Map<string, string>();
    const inventory = new Map<string, string>();
    let active = false;
    let root: { id: string; version: string } | undefined;
    for (const raw of lines.slice(0, index)) {
      const line = raw.replace(/<[^>]+>|<!\[CDATA\[|\]\]>/g, '');
      if (/Loading \d+ mods:/.test(line)) {
        active = true;
        root = undefined;
        continue;
      }
      if (!active) {
        continue;
      }
      const top = line.match(/^\s*-\s+([a-z0-9_.-]+)\s+([^\s<]+)/i);
      const child = line.match(/^\s*[|\\+│├└─ -]*[|\\+├└]--?\s+([a-z0-9_.-]+)\s+([^\s<]+)/i);
      if (top) {
        root = { id: top[1].toLowerCase(), version: top[2] };
        inventory.set(root.id, root.version);
        if (root.id === moduleId) {
          owners.set(root.id, root.version);
        }
      } else if (child && root) {
        if (child[1].toLowerCase() === moduleId) {
          owners.set(root.id, root.version);
        }
      } else if (line.trim()) {
        active = false;
        root = undefined;
      }
    }
    const gameVersion = source.content.match(/Loading Minecraft\s+([\w.+-]+)\s+with/i)?.[1];
    const olderMods = [...inventory].filter(
      ([id, version]) =>
        !['minecraft', 'java', 'fabricloader'].includes(id) &&
        /^26\./.test(gameVersion ?? '') &&
        /(?:\+|-)mc1\./i.test(version),
    );
    return {
      moduleId,
      owners,
      gameVersion,
      olderMods,
      from: namespaces[1],
      to: namespaces[2],
      evidence: [
        { file: source.name, line: lines[index].slice(0, 420) },
        ...(failure ? [{ file: source.name, line: failure[0].slice(0, 420) }] : []),
      ],
    };
  }
  return undefined;
}
