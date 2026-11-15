import { stat } from 'node:fs/promises';

import AdmZip from 'adm-zip';

import type {
  LocalModInspection,
  LocalModSummary,
  LocalModRequirement,
} from '../../shared/mods/mod-contract';

const metadataLimit = 1024 * 1024;
const iconLimit = 4 * 1024 * 1024;
const ignoredDependencies = new Set([
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'forge',
  'neoforge',
  'minecraft',
  'java',
]);

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : null;
}

function ranges(value: unknown): readonly string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === 'string')
    .slice(0, 32)
    .map((v) => v.slice(0, 256));
}

function requirements(value: unknown, kind: LocalModRequirement['kind']): LocalModRequirement[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value)
    .slice(0, 256)
    .map(([id, value]) => ({ id, ranges: ranges(value), kind }));
}

function dependencyIds(value: unknown): readonly string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value)
    .filter((id) => !ignoredDependencies.has(id.toLowerCase()))
    .slice(0, 256);
}

function minecraftVersion(value: unknown): string | null {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized?.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null;
}

function readEntry(zip: AdmZip, name: string): string | null {
  const entry = zip.getEntry(name);
  if (!entry || entry.header.size > metadataLimit) {
    return null;
  }
  return zip.readAsText(entry).slice(0, metadataLimit);
}

function declaredJarVersion(zip: AdmZip, version: string | null): string | null {
  if (version !== '${file.jarVersion}') {
    return version;
  }
  const manifest = readEntry(zip, 'META-INF/MANIFEST.MF')?.replace(/\r?\n /g, '');
  return manifest?.match(/^Implementation-Version:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

function iconPath(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort((left, right) => Number(right[0]) - Number(left[0]));
  return entries[0]?.[1] ?? null;
}

function iconDataUrl(zip: AdmZip, rawPath: string | null): string | null {
  const declared = rawPath?.replaceAll('\\', '/').replace(/^\.\//, '') ?? '';
  const path =
    (declared && zip.getEntry(declared)
      ? declared
      : zip
          .getEntries()
          .find((entry) =>
            /(^|\/)(logo|icon|pack)\.(png|jpg|jpeg|webp|gif)$/i.test(entry.entryName),
          )?.entryName) ?? declared;
  if (!path || path.startsWith('/') || path.split('/').includes('..')) {
    return null;
  }
  const extension = path.split('.').pop()?.toLowerCase();
  const mime =
    extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'webp'
          ? 'image/webp'
          : extension === 'gif'
            ? 'image/gif'
            : null;
  if (!mime) {
    return null;
  }
  const entry = zip.getEntry(path);
  if (!entry || entry.header.size <= 0 || entry.header.size > iconLimit) {
    return null;
  }
  const content = zip.readFile(entry);
  return content && content.byteLength <= iconLimit
    ? `data:${mime};base64,${content.toString('base64')}`
    : null;
}

function jsonObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid mod metadata');
  }
  return value as Record<string, unknown>;
}

function inspectFabric(source: string, summary: LocalModSummary): LocalModInspection {
  const metadata = jsonObject(source);
  const depends = metadata.depends;
  const minecraft =
    depends && typeof depends === 'object' && !Array.isArray(depends)
      ? (depends as Record<string, unknown>).minecraft
      : undefined;
  return {
    dependencies: dependencyIds(depends),
    requirements: [
      ...requirements(depends, 'required'),
      ...requirements(metadata.breaks, 'conflict'),
    ],
    provides: (Array.isArray(metadata.provides) ? metadata.provides : [])
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 256)
      .map((id) => ({ id, version: text(metadata.version) })),
    environment: text(metadata.environment) ?? '*',
    enabled: summary.enabled,
    filename: summary.filename,
    gameVersion: minecraftVersion(minecraft),
    id: text(metadata.id),
    iconDataUrl: null,
    loader: 'fabric',
    name: text(metadata.name) ?? summary.filename,
    readable: true,
    version: text(metadata.version),
  };
}

function inspectQuilt(source: string, summary: LocalModSummary): LocalModInspection {
  const metadata = jsonObject(source);
  const quiltLoader = metadata.quilt_loader;
  if (!quiltLoader || typeof quiltLoader !== 'object' || Array.isArray(quiltLoader)) {
    throw new TypeError('Invalid Quilt metadata');
  }
  const loader = quiltLoader as Record<string, unknown>;
  const depends = loader.depends;
  const dependencyList: readonly unknown[] = Array.isArray(depends)
    ? (depends as readonly unknown[])
    : [];
  const dependencies = dependencyList.length
    ? dependencyList
        .map((dependency) =>
          dependency && typeof dependency === 'object' && !Array.isArray(dependency)
            ? Reflect.get(dependency, 'optional') === true
              ? null
              : text(Reflect.get(dependency, 'id'))
            : null,
        )
        .filter(
          (id): id is string =>
            typeof id === 'string' && !ignoredDependencies.has(id.toLowerCase()),
        )
        .slice(0, 256)
    : [];
  const minecraft = dependencyList.length
    ? dependencyList.find(
        (dependency) =>
          dependency &&
          typeof dependency === 'object' &&
          !Array.isArray(dependency) &&
          Reflect.get(dependency, 'id') === 'minecraft',
      )
    : undefined;
  const metadataBlock = loader.metadata;
  const displayName =
    metadataBlock && typeof metadataBlock === 'object' && !Array.isArray(metadataBlock)
      ? text(Reflect.get(metadataBlock, 'name'))
      : null;
  return {
    dependencies,
    requirements: dependencyList.flatMap((entry): LocalModRequirement[] => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Reflect.get(entry, 'unless')
      ) {
        return [];
      }
      const id = text(Reflect.get(entry, 'id'));
      if (!id) {
        return [];
      }
      return [
        {
          id,
          ranges: ranges(Reflect.get(entry, 'versions') ?? '*'),
          kind: Reflect.get(entry, 'optional') === true ? 'optional' : 'required',
        },
      ];
    }),
    metadataWarnings: [
      ...(dependencyList.some(
        (entry) =>
          Array.isArray(entry) ||
          (entry && typeof entry === 'object' && Reflect.get(entry, 'unless')),
      )
        ? ['quilt: compound dependency']
        : []),
      ...(loader.breaks ? ['quilt: breaks'] : []),
      ...(loader.jars ? ['quilt: nested JAR'] : []),
    ],
    provides: (Array.isArray(loader.provides) ? loader.provides : []).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }
      const id = text(Reflect.get(entry, 'id'));
      return id
        ? [{ id, version: text(Reflect.get(entry, 'version')) ?? text(loader.version) }]
        : [];
    }),
    enabled: summary.enabled,
    filename: summary.filename,
    gameVersion: minecraftVersion(minecraft),
    id: text(loader.id),
    iconDataUrl: null,
    loader: 'quilt',
    name: displayName ?? summary.filename,
    readable: true,
    version: text(loader.version),
  };
}

function tomlValue(source: string, key: string): string | null {
  const match = source.match(
    new RegExp(`^\\s*${key}\\s*=\\s*(?:"((?:\\\\.|[^"\\r\\n])*)"|'([^'\\r\\n]*)')`, 'm'),
  );
  return (match?.[1] ?? match?.[2])?.trim().slice(0, 256) || null;
}

function inspectForge(
  source: string,
  summary: LocalModSummary,
  loader: 'forge' | 'neoforge',
): LocalModInspection {
  const id = tomlValue(source, 'modId');
  const dependencyBlocks = source.split(/^\s*\[\[dependencies\.[^\]]+\]\]\s*$/m).slice(1);
  const dependencies: string[] = [];
  let gameVersion: string | null = null;
  const declaredRequirements: LocalModRequirement[] = [];
  for (const rawBlock of dependencyBlocks.slice(0, 256)) {
    const block = rawBlock.split(/^\s*\[/m)[0];
    const dependencyId = tomlValue(block, 'modId');
    if (!dependencyId || tomlValue(block, 'side') === 'SERVER') {
      continue;
    }
    const type = tomlValue(block, 'type');
    const kind =
      type === 'incompatible'
        ? 'conflict'
        : /mandatory\s*=\s*false/i.test(block) || type === 'optional' || type === 'discouraged'
          ? 'optional'
          : 'required';
    declaredRequirements.push({
      id: dependencyId,
      ranges: [tomlValue(block, 'versionRange') || '*'],
      kind,
    });
    if (kind !== 'required') {
      continue;
    }
    if (dependencyId.toLowerCase() === 'minecraft') {
      gameVersion = minecraftVersion(tomlValue(block, 'versionRange'));
    } else if (!ignoredDependencies.has(dependencyId.toLowerCase())) {
      dependencies.push(dependencyId);
    }
  }
  return {
    dependencies,
    requirements: declaredRequirements,
    provides: source
      .split(/^\s*\[\[mods\]\]\s*$/m)
      .slice(2)
      .flatMap((block) => {
        const modId = tomlValue(block, 'modId');
        return modId ? [{ id: modId, version: tomlValue(block, 'version') }] : [];
      }),
    enabled: summary.enabled,
    filename: summary.filename,
    gameVersion,
    id,
    iconDataUrl: null,
    loader,
    name: tomlValue(source, 'displayName') ?? summary.filename,
    readable: true,
    version: tomlValue(source, 'version'),
  };
}

function inspectLegacyForge(source: string, summary: LocalModSummary): LocalModInspection {
  const parsed: unknown = JSON.parse(source);
  const candidate = Array.isArray(parsed)
    ? (parsed as readonly unknown[])[0]
    : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (((parsed as Record<string, unknown>).modList as readonly unknown[] | undefined)?.[0] ??
        parsed)
      : undefined;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('Invalid legacy Forge metadata');
  }
  const metadata = candidate as Record<string, unknown>;
  const rawDependencies = Array.isArray(metadata.dependencies)
    ? (metadata.dependencies as readonly unknown[])
    : [];
  const dependencies = rawDependencies
    .map((dependency) =>
      typeof dependency === 'string'
        ? (dependency.match(/required-(?:after|before):([A-Za-z0-9_.-]+)/)?.[1] ?? null)
        : null,
    )
    .filter(
      (dependency): dependency is string =>
        typeof dependency === 'string' && !ignoredDependencies.has(dependency.toLowerCase()),
    )
    .slice(0, 256);
  return {
    dependencies,
    enabled: summary.enabled,
    filename: summary.filename,
    gameVersion: minecraftVersion(metadata.mcversion),
    id: text(metadata.modid),
    iconDataUrl: null,
    loader: 'forge',
    name: text(metadata.name) ?? summary.filename,
    readable: true,
    version: text(metadata.version),
  };
}

function unknown(summary: LocalModSummary): LocalModInspection {
  return {
    ...unreadable(summary),
    readable: true,
  };
}

function unreadable(summary: LocalModSummary): LocalModInspection {
  return {
    dependencies: [],
    enabled: summary.enabled,
    filename: summary.filename,
    gameVersion: null,
    id: null,
    iconDataUrl: null,
    loader: 'unknown',
    name: summary.filename,
    readable: false,
    version: null,
  };
}

function nestedFabric(
  zip: AdmZip,
  metadata: Record<string, unknown>,
  version: string | null,
  budget = { remaining: 32 * 1024 * 1024, count: 0 },
  depth = 0,
): Pick<LocalModInspection, 'provides' | 'metadataWarnings' | 'requirements'> {
  const provides = (Array.isArray(metadata.provides) ? metadata.provides : [])
    .filter((id): id is string => typeof id === 'string')
    .slice(0, 256)
    .map((id) => ({ id, version }));
  const warnings: string[] = [];
  const declaredRequirements = [
    ...requirements(metadata.depends, 'required'),
    ...requirements(metadata.breaks, 'conflict'),
  ];
  const jars = Array.isArray(metadata.jars) ? metadata.jars : [];
  for (const item of jars.slice(0, 256)) {
    const name = item && typeof item === 'object' ? text(Reflect.get(item, 'file')) : null;
    const entry = name ? zip.getEntry(name) : null;
    if (!entry || entry.header.size > budget.remaining || depth >= 8 || ++budget.count > 256) {
      warnings.push(name ?? 'nested JAR');
      continue;
    }
    budget.remaining -= entry.header.size;
    try {
      const buffer = zip.readFile(entry);
      if (!buffer) {
        throw new Error('Unreadable nested JAR');
      }
      const nested = new AdmZip(buffer);
      if (nested.getEntries().length > 16384) {
        throw new Error('Nested JAR limit');
      }
      const source = readEntry(nested, 'fabric.mod.json');
      if (!source) {
        warnings.push(name!);
        continue;
      }
      const data = jsonObject(source),
        id = text(data.id);
      if (id) {
        provides.push({ id, version: text(data.version) });
      }
      const contents = nestedFabric(nested, data, text(data.version), budget, depth + 1);
      provides.push(...(contents.provides ?? []));
      warnings.push(...(contents.metadataWarnings ?? []));
      if (data.environment !== 'server') {
        declaredRequirements.push(...(contents.requirements ?? []));
      }
      if (declaredRequirements.length > 4096) {
        warnings.push('nested dependency limit');
        break;
      }
    } catch {
      warnings.push(name ?? 'nested JAR');
    }
  }
  if (jars.length > 256) {
    warnings.push('nested JAR limit');
  }
  return { provides, metadataWarnings: warnings, requirements: declaredRequirements };
}

function nestedForge(
  zip: AdmZip,
  inspection: LocalModInspection,
  summary: LocalModSummary,
): LocalModInspection {
  const source = readEntry(zip, 'META-INF/jarjar/metadata.json');
  if (!source) {
    return inspection;
  }
  const provides = [...(inspection.provides ?? [])];
  const required = [...(inspection.requirements ?? [])];
  const warnings = [...(inspection.metadataWarnings ?? [])];
  let budget = 32 * 1024 * 1024;
  try {
    const data = jsonObject(source);
    const jars = Array.isArray(data.jars) ? data.jars : [];
    for (const item of jars.slice(0, 256)) {
      const name = item && typeof item === 'object' ? text(Reflect.get(item, 'path')) : null;
      const entry = name ? zip.getEntry(name) : null;
      if (!entry || entry.header.size > budget) {
        warnings.push(name ?? 'jarjar');
        continue;
      }
      budget -= entry.header.size;
      const buffer = zip.readFile(entry);
      if (!buffer) {
        warnings.push(name!);
        continue;
      }
      const inner = new AdmZip(buffer);
      if (inner.getEntries().length > 16384) {
        warnings.push(name!);
        continue;
      }
      const neo = readEntry(inner, 'META-INF/neoforge.mods.toml');
      const forge = readEntry(inner, 'META-INF/mods.toml');
      if (neo || forge) {
        const mod = inspectForge((neo ?? forge)!, summary, neo ? 'neoforge' : 'forge');
        if (mod.id) {
          provides.push({ id: mod.id, version: declaredJarVersion(inner, mod.version) });
        }
        provides.push(...(mod.provides ?? []));
        required.push(...(mod.requirements ?? []));
      }
      if (inner.getEntry('META-INF/jarjar/metadata.json')) {
        warnings.push(name!);
      }
    }
    if (jars.length > 256) {
      warnings.push('jarjar limit');
    }
  } catch {
    warnings.push('jarjar metadata');
  }
  return { ...inspection, provides, requirements: required, metadataWarnings: warnings };
}

export async function inspectLocalMod(
  path: string,
  summary: LocalModSummary,
  preferredLoader?: string,
): Promise<LocalModInspection> {
  try {
    const info = await stat(path);
    if (info.size === 0 || info.size > 512 * 1024 * 1024) {
      return unreadable(summary);
    }
    const zip = new AdmZip(path);
    if (zip.getEntries().length > 16_384) {
      return unreadable(summary);
    }
    const fabric = readEntry(zip, 'fabric.mod.json');
    const preferredMetadata =
      preferredLoader === 'neoforge'
        ? zip.getEntry('META-INF/neoforge.mods.toml')
        : preferredLoader === 'forge'
          ? zip.getEntry('META-INF/mods.toml')
          : preferredLoader === 'quilt'
            ? zip.getEntry('quilt.mod.json')
            : null;
    if (fabric && !preferredMetadata) {
      const metadata = jsonObject(fabric);
      return {
        ...inspectFabric(fabric, summary),
        ...nestedFabric(zip, metadata, text(metadata.version)),
        iconDataUrl: iconDataUrl(zip, iconPath(metadata.icon)),
      };
    }
    const quilt = readEntry(zip, 'quilt.mod.json');
    if (quilt && (!preferredMetadata || preferredLoader === 'quilt')) {
      const metadata = jsonObject(quilt);
      const loader = metadata.quilt_loader;
      const block =
        loader && typeof loader === 'object' && !Array.isArray(loader)
          ? (loader as Record<string, unknown>).metadata
          : null;
      const icon =
        block && typeof block === 'object' && !Array.isArray(block)
          ? (block as Record<string, unknown>).icon
          : null;
      return { ...inspectQuilt(quilt, summary), iconDataUrl: iconDataUrl(zip, iconPath(icon)) };
    }
    const neoForge = readEntry(zip, 'META-INF/neoforge.mods.toml');
    if (neoForge) {
      return nestedForge(
        zip,
        {
          ...inspectForge(neoForge, summary, 'neoforge'),
          version: declaredJarVersion(zip, tomlValue(neoForge, 'version')),
          iconDataUrl: iconDataUrl(zip, tomlValue(neoForge, 'logoFile')),
        },
        summary,
      );
    }
    const forge = readEntry(zip, 'META-INF/mods.toml');
    if (forge) {
      return nestedForge(
        zip,
        {
          ...inspectForge(forge, summary, 'forge'),
          version: declaredJarVersion(zip, tomlValue(forge, 'version')),
          iconDataUrl: iconDataUrl(zip, tomlValue(forge, 'logoFile')),
        },
        summary,
      );
    }
    const legacyForge = readEntry(zip, 'mcmod.info');
    if (legacyForge) {
      const parsed: unknown = JSON.parse(legacyForge);
      const candidate: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : parsed;
      const logo =
        candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>).logoFile
          : null;
      return {
        ...inspectLegacyForge(legacyForge, summary),
        iconDataUrl: iconDataUrl(zip, iconPath(logo)),
      };
    }
    return unknown(summary);
  } catch {
    return unreadable(summary);
  }
}

export { createCompatibilityReport } from '../../shared/mods/compatibility-report';
