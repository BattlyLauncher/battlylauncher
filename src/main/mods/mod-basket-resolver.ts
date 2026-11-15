import type { ModBasketIssue, ModBasketRequest } from '../../shared/mods/mod-basket';
import type { ModrinthClient, ModrinthVersion } from './modrinth-client';

export class BasketResolutionFailure extends Error {
  constructor(readonly issue: ModBasketIssue) {
    super(issue.kind);
  }
}
interface Constraint {
  projectId: string | null;
  versionId?: string | null;
  root: string;
}
interface Selection {
  version: ModrinthVersion;
  root: string;
}

/** Solve all roots together, including exact dependency pins, before downloading any JAR. */
export async function resolveModBasket(
  client: ModrinthClient,
  request: ModBasketRequest,
  signal?: AbortSignal,
  validate?: (versions: readonly ModrinthVersion[]) => ModBasketIssue | undefined,
): Promise<{ versions: ModrinthVersion[]; roots: Map<string, string[]> }> {
  const lists = new Map<string, Promise<readonly ModrinthVersion[]>>();
  const pins = new Map<string, Promise<ModrinthVersion>>();
  const environments = new Map<string, Promise<boolean>>();
  let steps = 0;
  let issue: ModBasketIssue = { kind: 'dependency', project: '', detail: '', projectIds: [] };
  const reject = (
    kind: ModBasketIssue['kind'],
    project: string,
    detail: string,
    roots: string[],
  ) => {
    issue = {
      kind,
      project,
      detail,
      projectIds: [...new Set(roots)].filter((id) => request.projectIds.includes(id)),
    };
    return undefined;
  };
  const list = (id: string) => {
    if (!lists.has(id)) {
      lists.set(id, client.projectVersions(id, request.gameVersion, request.loader, signal));
    }
    return lists.get(id)!;
  };
  const pin = (id: string) => {
    if (!pins.has(id)) {
      pins.set(id, client.version(id, signal));
    }
    return pins.get(id)!;
  };
  const compatible = (v: ModrinthVersion) =>
    v.gameVersions.includes(request.gameVersion) && v.loaders.includes(request.loader);
  const search = async (
    pending: Constraint[],
    selected: Map<string, Selection>,
  ): Promise<Map<string, Selection> | undefined> => {
    signal?.throwIfAborted();
    if (++steps > 2048) {
      throw new BasketResolutionFailure({
        kind: 'dependency',
        project: '',
        detail: 'limit',
        projectIds: [],
      });
    }
    if (!pending.length) {
      return selected;
    }
    if (pending.length > 4096 || selected.size > 128) {
      return reject('dependency', '', 'limit', []);
    }
    const [constraint, ...rest] = pending;
    const fixed = constraint.versionId ? await pin(constraint.versionId) : undefined;
    const id = constraint.projectId ?? fixed?.projectId;
    if (!id || (constraint.versionId && !fixed)) {
      return reject('dependency', constraint.root, constraint.versionId ?? '', [constraint.root]);
    }
    if (fixed && fixed.projectId !== id) {
      return reject('metadata', id, fixed.id, [constraint.root]);
    }
    if (fixed && !compatible(fixed)) {
      return reject('version', id, fixed.versionNumber, [constraint.root]);
    }
    const previous = selected.get(id);
    if (previous) {
      if (fixed && previous.version.id !== fixed.id) {
        return reject(
          'conflict',
          id,
          `${previous.version.versionNumber} / ${fixed.versionNumber}`,
          [constraint.root, previous.root],
        );
      }
      return search(rest, selected);
    }
    const candidates = fixed ? [fixed] : (await list(id)).filter(compatible).slice(0, 100);
    if (!candidates.length) {
      return reject(request.projectIds.includes(id) ? 'version' : 'dependency', id, '', [
        constraint.root,
      ]);
    }
    for (const candidate of candidates) {
      if (candidate.projectId !== id) {
        reject('metadata', id, candidate.id, [constraint.root]);
        continue;
      }
      if (request.destinationServerId) {
        if (!environments.has(id)) {
          environments.set(
            id,
            client.project(id, signal).then((p) => p.serverSide !== 'unsupported'),
          );
        }
        if (!(await environments.get(id))) {
          reject('environment', id, '', [constraint.root]);
          continue;
        }
      }
      const next = new Map(selected);
      next.set(id, { version: candidate, root: constraint.root });
      const invalid = validate?.([...next.values()].map((value) => value.version));
      if (invalid) {
        reject(invalid.kind, invalid.project, invalid.detail, [
          next.get(invalid.project)?.root ?? constraint.root,
        ]);
        continue;
      }
      let conflict = false;
      for (const entry of next.values()) {
        for (const dep of entry.version.dependencies) {
          if (dep.dependencyType !== 'incompatible') {
            continue;
          }
          const other = [...next.values()].find((v) =>
            dep.versionId ? v.version.id === dep.versionId : v.version.projectId === dep.projectId,
          );
          if (other) {
            reject('conflict', entry.version.projectId, other.version.name, [
              entry.root,
              other.root,
            ]);
            conflict = true;
          }
        }
      }
      if (conflict) {
        continue;
      }
      // Forward-check remaining roots so an exact pin in a later mod cannot cause
      // an exponential search through unrelated Fabric API/library releases.
      let supported = true;
      for (const future of rest) {
        if (!future.projectId || next.has(future.projectId) || future.versionId) {
          continue;
        }
        const options = (await list(future.projectId)).filter(compatible).slice(0, 100);
        const possible = options.some((option) =>
          option.dependencies.every((dep) => {
            const existing = dep.projectId ? next.get(dep.projectId) : undefined;
            if (!existing) {
              return true;
            }
            if (dep.dependencyType === 'required' && dep.versionId) {
              return existing.version.id === dep.versionId;
            }
            if (dep.dependencyType === 'incompatible') {
              return dep.versionId ? existing.version.id !== dep.versionId : false;
            }
            return true;
          }),
        );
        if (!possible) {
          const blockers = options.flatMap((option) =>
            option.dependencies.flatMap((dep) => {
              const existing = dep.projectId ? next.get(dep.projectId) : undefined;
              return existing &&
                ((dep.dependencyType === 'required' &&
                  dep.versionId &&
                  existing.version.id !== dep.versionId) ||
                  (dep.dependencyType === 'incompatible' &&
                    (!dep.versionId || existing.version.id === dep.versionId)))
                ? [existing.root]
                : [];
            }),
          );
          reject(
            options.length
              ? 'conflict'
              : request.projectIds.includes(future.projectId)
                ? 'version'
                : 'dependency',
            future.projectId,
            '',
            [future.root, ...blockers],
          );
          supported = false;
          break;
        }
      }
      if (!supported) {
        continue;
      }
      const dependencies = candidate.dependencies
        .filter((d) => d.dependencyType === 'required')
        .map((d) => ({ projectId: d.projectId, versionId: d.versionId, root: constraint.root }));
      const result = await search([...dependencies, ...rest], next);
      if (result) {
        return result;
      }
    }
    return undefined;
  };
  await Promise.all(request.projectIds.map(list));
  const selected = await search(
    request.projectIds.map((id) => ({ projectId: id, root: id })),
    new Map(),
  );
  if (!selected) {
    throw new BasketResolutionFailure(issue);
  }
  const ordered: ModrinthVersion[] = [],
    active = new Set<string>(),
    done = new Set<string>();
  const roots = new Map<string, string[]>();
  const walk = async (id: string, root: string): Promise<void> => {
    const entry = selected.get(id);
    if (!entry) {
      throw new BasketResolutionFailure({
        kind: 'dependency',
        project: id,
        detail: '',
        projectIds: [root],
      });
    }
    roots.set(id, [...new Set([...(roots.get(id) ?? []), root])]);
    if (active.has(id)) {
      throw new BasketResolutionFailure({
        kind: 'dependency',
        project: id,
        detail: 'cycle',
        projectIds: [root],
      });
    }
    if (done.has(`${root}:${id}`)) {
      return;
    }
    active.add(id);
    for (const dep of entry.version.dependencies.filter((d) => d.dependencyType === 'required')) {
      const dependencyId =
        dep.projectId ?? (dep.versionId ? (await pin(dep.versionId)).projectId : null);
      if (dependencyId) {
        await walk(dependencyId, root);
      }
    }
    active.delete(id);
    done.add(`${root}:${id}`);
    if (!ordered.some((v) => v.id === entry.version.id)) {
      ordered.push(entry.version);
    }
  };
  for (const id of request.projectIds) {
    await walk(id, id);
  }
  return { versions: ordered, roots };
}
