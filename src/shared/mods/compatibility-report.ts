import type {
  LocalModCompatibilityIssue,
  LocalModCompatibilityReport,
  LocalModInspection,
  LocalModTarget,
} from './mod-contract';
import { matchesModRange } from './version-range';

const platformIds = new Set([
  'minecraft',
  'java',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
  'forge',
  'neoforge',
]);

export function createCompatibilityReport(
  mods: readonly LocalModInspection[],
  target: LocalModTarget = {},
): LocalModCompatibilityReport {
  const enabled = mods.filter((mod) => mod.enabled);
  const issues: LocalModCompatibilityIssue[] = [];
  const providers = new Map<string, { mod: LocalModInspection; version: string | null }[]>();
  const add = (
    mod: LocalModInspection,
    kind: LocalModCompatibilityIssue['kind'],
    detected: string | null,
    expected: string | null,
    severity: 'error' | 'warning' = 'error',
  ) =>
    issues.push({ filename: mod.filename, modName: mod.name, kind, detected, expected, severity });
  for (const mod of enabled) {
    if (!mod.readable) {
      add(mod, 'unreadable', null, null);
      continue;
    }
    if (!mod.id) {
      add(mod, 'unknown-metadata', null, null, 'warning');
      continue;
    }
    if (mod.environment === 'server') {
      continue;
    }
    for (const provider of [{ id: mod.id, version: mod.version }, ...(mod.provides ?? [])]) {
      const entries = providers.get(provider.id) ?? [];
      if (!entries.some((entry) => entry.mod === mod)) {
        entries.push({ mod, version: provider.version });
      }
      providers.set(provider.id, entries);
    }
  }
  // Aliases and nested libraries may be shared legitimately; only root IDs are duplicates.
  const rootIds = new Map<string, LocalModInspection[]>();
  for (const mod of enabled) {
    if (mod.id) {
      rootIds.set(mod.id, [...(rootIds.get(mod.id) ?? []), mod]);
    }
  }
  for (const [id, entries] of rootIds) {
    if (entries.length > 1) {
      for (const mod of entries) {
        add(
          mod,
          'duplicate-id',
          id,
          entries
            .filter((other) => other !== mod)
            .map((other) => other.filename)
            .join(', '),
        );
      }
    }
  }
  for (const mod of enabled) {
    if (!mod.readable || !mod.id) {
      continue;
    }
    for (const warning of mod.metadataWarnings ?? []) {
      add(mod, 'unverified', warning, null, 'warning');
    }
    if (mod.environment === 'server') {
      add(mod, 'environment', 'server', 'client', 'warning');
      continue;
    }
    if (
      target.loader &&
      mod.loader !== 'unknown' &&
      mod.loader !== target.loader &&
      !(target.loader === 'quilt' && mod.loader === 'fabric')
    ) {
      add(mod, 'loader-mismatch', mod.loader, target.loader);
    }
    const requirements = [
      ...(mod.requirements ??
        mod.dependencies.map((id) => ({ id, ranges: ['*'], kind: 'required' as const }))),
    ];
    if (!mod.requirements && mod.gameVersion) {
      requirements.push({ id: 'minecraft', ranges: [mod.gameVersion], kind: 'required' });
    }
    for (const requirement of requirements) {
      const { id, ranges, kind } = requirement;
      const expected = `${id} ${ranges.join(' | ') || '?'}`;
      if (platformIds.has(id)) {
        const version =
          id === 'minecraft'
            ? target.gameVersion
            : id === 'java'
              ? target.javaVersion
              : id.replace('-loader', 'loader') === `${target.loader}loader` ||
                  id === target.loader ||
                  (id === 'quilt_loader' && target.loader === 'quilt')
                ? target.loaderVersion
                : undefined;
        if (!version) {
          add(mod, 'unverified', null, expected, 'warning');
          continue;
        }
        const match = matchesModRange(version, ranges);
        if (match === null) {
          add(mod, 'unverified', version, expected, 'warning');
        } else if (kind === 'conflict' ? match : !match) {
          add(
            mod,
            id === 'minecraft' ? 'game-version-mismatch' : 'dependency-version',
            version,
            expected,
          );
        }
        continue;
      }
      const installed = providers.get(id) ?? [];
      if (!installed.length) {
        if (kind !== 'required') {
          continue;
        }
        const disabled = mods.find(
          (other) =>
            !other.enabled && (other.id === id || other.provides?.some((p) => p.id === id)),
        );
        add(
          mod,
          disabled ? 'disabled-dependency' : 'missing-dependency',
          disabled?.filename ?? null,
          expected,
        );
        continue;
      }
      const results = installed.map((provider) => matchesModRange(provider.version, ranges));
      if (kind === 'conflict') {
        if (results.includes(true)) {
          add(mod, 'conflict', installed.map((p) => p.mod.name).join(', '), expected);
        } else if (results.includes(null)) {
          add(mod, 'unverified', null, expected, 'warning');
        }
      } else if (!results.includes(true)) {
        add(
          mod,
          results.includes(null) ? 'unverified' : 'dependency-version',
          installed.map((p) => p.version ?? '?').join(', '),
          expected,
          results.includes(null) ? 'warning' : 'error',
        );
      }
    }
  }
  issues.sort(
    (a, b) =>
      Number(a.severity === 'warning') - Number(b.severity === 'warning') ||
      a.modName.localeCompare(b.modName),
  );
  return {
    mods,
    issues,
    primaryLoader: target.loader ?? null,
    primaryGameVersion: target.gameVersion ?? null,
  };
}

export interface LocalModIssueGroup {
  readonly kind: LocalModCompatibilityIssue['kind'];
  readonly severity: 'error' | 'warning';
  readonly issues: readonly LocalModCompatibilityIssue[];
}

/** A duplicate ID is one problem with several files, not one problem per copy. */
export function groupCompatibilityIssues(
  issues: readonly LocalModCompatibilityIssue[],
): LocalModIssueGroup[] {
  const groups = new Map<string, LocalModCompatibilityIssue[]>();
  for (const issue of issues) {
    const key =
      issue.kind === 'duplicate-id'
        ? JSON.stringify([issue.kind, issue.detected])
        : JSON.stringify([issue.filename, issue.severity]);
    const entries = groups.get(key) ?? [];
    if (
      !entries.some(
        (entry) =>
          entry.filename === issue.filename &&
          entry.kind === issue.kind &&
          entry.detected === issue.detected &&
          entry.expected === issue.expected,
      )
    ) {
      entries.push(issue);
    }
    groups.set(key, entries);
  }
  return [...groups.values()].map((entries) => ({
    kind: entries[0].kind,
    severity: entries.every((entry) => entry.severity === 'warning') ? 'warning' : 'error',
    issues: entries,
  }));
}
