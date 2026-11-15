import type { InstanceSummary } from '../../shared/minecraft/instance';
import type { PlayVersionSnapshot } from '../../shared/minecraft/play-version-contract';

export const launchHistoryStorageKey = 'battly.recent-instance-launches.v1';

export interface LoaderPresentation {
  readonly description: string;
  readonly icon: string;
  readonly id: string;
  readonly title: string;
}

export const loaderPresentations: readonly LoaderPresentation[] = [
  {
    id: 'vanilla',
    icon: 'fa-cube',
    title: 'Vanilla',
    description: 'La versión original de Minecraft. Sin modificaciones.',
  },
  {
    id: 'fabric',
    icon: 'fa-feather',
    title: 'Fabric',
    description: 'Un modloader ligero y fácil de usar para mods.',
  },
  {
    id: 'forge',
    icon: 'fa-hammer',
    title: 'Forge',
    description: 'El modloader clásico con una enorme selección de mods.',
  },
  {
    id: 'quilt',
    icon: 'fa-layer-group',
    title: 'Quilt',
    description: 'Un modloader moderno basado en el ecosistema de Fabric.',
  },
  {
    id: 'legacyfabric',
    icon: 'fa-scroll',
    title: 'LegacyFabric',
    description: 'Fabric para versiones antiguas de Minecraft.',
  },
  {
    id: 'neoforge',
    icon: 'fa-fire-flame-curved',
    title: 'NeoForge',
    description: 'La evolución moderna de Forge para versiones recientes.',
  },
];

export function instanceLoader(instance: InstanceSummary): string {
  return instance.loader?.toLowerCase() || 'vanilla';
}

export function instanceLaunchLabel(instance: InstanceSummary): string {
  const loader = instanceLoader(instance);
  const loaderLabel = loaderPresentations.find((entry) => entry.id === loader)?.title ?? loader;
  const build =
    instance.loaderVersion && instance.loaderVersion !== 'latest'
      ? ` ${instance.loaderVersion}`
      : '';
  return loader === 'vanilla'
    ? `${instance.name} · ${instance.version}`
    : `${instance.name} · ${instance.version} · ${loaderLabel}${build}`;
}

export function parseRecentInstanceIds(
  raw: string | null,
  instances: readonly InstanceSummary[],
): string[] {
  if (!raw) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const validIds = new Set(instances.map((instance) => instance.id));
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !validIds.has(entry) || result.includes(entry)) {
      continue;
    }
    result.push(entry);
    if (result.length === 3) {
      break;
    }
  }
  return result;
}

export function recordRecentInstanceId(instanceId: string, current: readonly string[]): string[] {
  return [instanceId, ...current.filter((entry) => entry !== instanceId)].slice(0, 3);
}

export function hasPlayableVersion(snapshot: PlayVersionSnapshot): boolean {
  return snapshot.installed.length > 0;
}
