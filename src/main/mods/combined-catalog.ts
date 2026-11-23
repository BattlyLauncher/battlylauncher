import type { ModSearchRequest, ModSearchResult } from '../../shared/mods/mod-contract';

type Search = (request: ModSearchRequest) => Promise<ModSearchResult>;

export async function searchCombinedCatalog(
  request: ModSearchRequest,
  modrinth: Search,
  curseforge: Search,
): Promise<ModSearchResult> {
  const limit = Math.min(50, request.limit);
  const leftOffset = Math.ceil(request.offset / 2);
  const rightOffset = Math.floor(request.offset / 2);
  const [left, right] = await Promise.all([
    modrinth({ ...request, offset: leftOffset, limit }),
    curseforge({ ...request, offset: rightOffset, limit }),
  ]);
  const offsetFor = (initial: number, count: number, otherOffset: number, otherCount: number) =>
    Math.min(count, initial + Math.max(0, otherOffset - otherCount));
  const aOffset = offsetFor(leftOffset, left.total, rightOffset, right.total);
  const bOffset = offsetFor(rightOffset, right.total, leftOffset, left.total);
  const [a, b] = await Promise.all([
    aOffset >= left.total
      ? []
      : aOffset === leftOffset
        ? left.projects
        : modrinth({ ...request, offset: aOffset, limit }).then((result) => result.projects),
    bOffset >= right.total
      ? []
      : bOffset === rightOffset
        ? right.projects
        : curseforge({ ...request, offset: bOffset, limit }).then((result) => result.projects),
  ]);
  const projects = [];
  for (let index = 0; index < limit && projects.length < limit; index++) {
    const candidates = request.offset % 2 === 0 ? [a[index], b[index]] : [b[index], a[index]];
    for (const item of candidates) {
      if (item && projects.length < limit) {
        projects.push(item);
      }
    }
  }
  return {
    projects,
    offset: request.offset,
    limit,
    total: Math.min(10_000, left.total + right.total),
  };
}
