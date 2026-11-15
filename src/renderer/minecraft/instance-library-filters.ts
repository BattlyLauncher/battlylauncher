import type { InstanceSummary } from '../../shared/minecraft/instance';

export interface InstanceLibraryFilters {
  readonly query: string;
  readonly loader: string;
  readonly version: string;
  readonly sort: string;
  readonly direction: string;
}

const searchable = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();

export function filterInstanceLibrary(
  instances: readonly InstanceSummary[],
  filters: InstanceLibraryFilters,
  recent: readonly string[],
): InstanceSummary[] {
  const query = searchable(filters.query.trim());
  const recency = new Map(recent.map((id, index) => [id, recent.length - index]));
  const direction = filters.direction === 'asc' ? 1 : -1;
  return instances
    .filter(
      (instance) =>
        (!filters.loader || (instance.loader?.toLowerCase() || 'vanilla') === filters.loader) &&
        (!filters.version || instance.version === filters.version) &&
        (!query ||
          searchable(
            `${instance.name} ${instance.description} ${instance.version} ${instance.loader ?? 'vanilla'}`,
          ).includes(query)),
    )
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
      const comparison =
        filters.sort === 'name'
          ? byName
          : filters.sort === 'version'
            ? left.version.localeCompare(right.version, undefined, { numeric: true })
            : (recency.get(left.id) ?? 0) - (recency.get(right.id) ?? 0);
      return direction * (comparison || byName);
    });
}
