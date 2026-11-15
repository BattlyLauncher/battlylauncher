import { matchesModRange } from '../../shared/mods/version-range';
import { dependencyIntersection } from './dependency-constraint-intersection';

export const dependencyEngineVersion = 'dependency-expert-1';
export type DependencyKind =
  | 'missing'
  | 'mismatch'
  | 'unsatisfied'
  | 'runtime'
  | 'conflict'
  | 'duplicate'
  | 'environment'
  | 'language'
  | 'cycle'
  | 'linkage'
  | 'missing-class'
  | 'corrupt'
  | 'nested'
  | 'wrong-loader';
export interface DependencyFact {
  readonly rule: string;
  readonly family: 'fabric' | 'quilt' | 'fml' | 'legacy-forge' | 'jvm';
  readonly kind: DependencyKind;
  readonly owner: string | null;
  readonly dependency: string | null;
  readonly required: string | null;
  readonly installed: string | null;
  readonly evidence: string;
  readonly confidence: 'high' | 'medium';
  readonly reference: string;
  readonly sourceFile?: string;
  readonly displayOwner?: string;
}
export interface DependencyPlan {
  readonly kind: 'install' | 'isolate' | 'review';
  readonly owner: string | null;
  readonly dependency: string | null;
  readonly constraint: string | null;
  readonly reason: string;
}
const references = {
  fabric:
    'https://github.com/FabricMC/fabric-loader/blob/master/src/main/resources/net/fabricmc/loader/Messages.properties',
  quilt:
    'https://github.com/QuiltMC/quilt-loader/blob/develop/src/main/resources/lang/quilt_loader.properties',
  fml: 'https://github.com/neoforged/FancyModLoader/blob/main/loader/src/main/resources/lang/en_us.json',
  forge:
    'https://github.com/MinecraftForge/MinecraftForge/blob/master/fmlloader/src/main/java/net/minecraftforge/fml/loading/ModSorter.java',
  legacy:
    'https://github.com/MinecraftForge/FML/blob/master/src/main/java/net/minecraftforge/fml/common/Loader.java',
  jvm: 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/LinkageError.html',
};
const builtins = new Set([
  'minecraft',
  'java',
  'forge',
  'neoforge',
  'fabricloader',
  'fabric-loader',
  'quilt_loader',
]);
const cleanId = (value: string): string | null => {
  const id = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  return /^[a-z0-9_.-]{1,120}$/.test(id) ? id : null;
};

/** Translate documented requirement wording, never turn an unknown predicate into '*'. */
export function normalizeDependencyConstraint(input: string): string | null {
  const text = input.trim().replace(/[.!]$/, '');
  if (/^(?:any version|cualquier versión)$/i.test(text)) {
    return '*';
  }
  const between =
    /^(?:any version )?between (\S+) \((inclusive|exclusive)\) and (\S+) \((inclusive|exclusive)\)$/i.exec(
      text,
    );
  if (between) {
    return `${between[2] === 'inclusive' ? '>=' : '>'}${between[1]} ${between[4] === 'inclusive' ? '<=' : '<'}${between[3]}`;
  }
  const bounded = /^(\S+) or above, and below (\S+)$/i.exec(text);
  if (bounded) {
    return `>=${bounded[1]} <${bounded[2]}`;
  }
  const lower =
    /^(?:version |at least version )?(\S+) (?:or later|or above|or any newer version|o superior)$/i.exec(
      text,
    );
  if (lower) {
    return `>=${lower[1]}`;
  }
  const upper = /^(?:version )?(\S+) (?:or earlier|or any earlier version)$/i.exec(text);
  if (upper) {
    return `<=${upper[1]}`;
  }
  const strict = /^(?:any version )?(above|below) (\S+)$/i.exec(text);
  if (strict) {
    return `${strict[1].toLowerCase() === 'above' ? '>' : '<'}${strict[2]}`;
  }
  const value = text
    .replace(/^(?:any version |version |cualquier versión |a version in the range )/i, '')
    .replace(/[?∞]\s*([)\]])$/, '$1')
    .replace(/^([[(])\s*[?∞]/, '$1');
  if (value.includes(' or ')) {
    const parts = value.split(/\s+or\s+/i).map(normalizeDependencyConstraint);
    return parts.every(Boolean) ? parts.join(' || ') : null;
  }
  // The range evaluator must understand the complete expression. Snapshot and
  // prerelease equality are allowed; ordering unknown versions stays unknown.
  if (/^(?:[[(].*[\])]|(?:[<>=~^]*\s*\d[\w.+*-]*)(?:\s+[<>=~^]+\s*\d[\w.+*-]*)*|\*)$/.test(value)) {
    return value;
  }
  return null;
}

export function dependencyRuntime(content: string): {
  gameVersion: string | null;
  loader: string | null;
} {
  const standard =
    /Loading Minecraft\s+([A-Za-z0-9._+-]+)\s+with\s+(Fabric|Quilt|Forge|NeoForge)\s+Loader/i.exec(
      content,
    );
  if (standard) {
    return { gameVersion: standard[1], loader: standard[2].toLowerCase() };
  }
  for (const line of content.split('\n')) {
    const start = line.indexOf('[launch-context] ');
    if (start < 0 || line.length > 16000) {
      continue;
    }
    try {
      const value = JSON.parse(line.slice(start + 17)) as {
        minecraft?: { id?: string };
        loader?: { type?: string };
      };
      const gameVersion = value.minecraft?.id,
        loader = value.loader?.type;
      if (
        gameVersion &&
        /^[\w.+-]{1,80}$/.test(gameVersion) &&
        ['fabric', 'quilt', 'forge', 'neoforge'].includes(loader ?? '')
      ) {
        return { gameVersion, loader: loader! };
      }
    } catch {
      /* A truncated context cannot authorize a download. */
    }
  }
  const game =
    /Minecraft Version:\s*([A-Za-z0-9._+-]+)/.exec(content)?.[1] ??
    /Forge Mod Loader version [\w.]+ for Minecraft ([A-Za-z0-9._+-]+)/.exec(content)?.[1];
  if (game) {
    const loader = /net\.neoforged|NeoForge installation|Starting.*NeoForge/.test(content)
      ? 'neoforge'
      : /net\.minecraftforge|MinecraftForge|Forge Mod Loader/.test(content)
        ? 'forge'
        : null;
    if (loader) {
      return { gameVersion: game, loader };
    }
  }
  return { gameVersion: null, loader: null };
}

/** Bounded, deterministic log recognition: no network, execution, or file mutation. */
export function analyzeDependencyFacts(raw: string): readonly DependencyFact[] {
  const bounded = raw.length > 180000 ? raw.slice(0, 60000) + '\n' + raw.slice(-120000) : raw;
  // Remove ANSI escape sequences before matching loader diagnostics.
  // eslint-disable-next-line no-control-regex
  const text = bounded.replace(/§[0-9a-fk-or]/gi, '').replace(/\x1b\[[0-9;]*m/g, '');
  const lines = text.split(/\r?\n/).map((line) => line.slice(0, 4096));
  const facts: DependencyFact[] = [];
  const seen = new Map<string, number>();
  const push = (fact: DependencyFact): void => {
    const key = [
      fact.kind,
      fact.owner ?? fact.displayOwner,
      fact.dependency,
      normalizeDependencyConstraint(fact.required ?? '') ?? fact.required,
      fact.installed,
    ].join('|');
    const previous = seen.get(key);
    if (previous !== undefined) {
      if (fact.sourceFile && !facts[previous].sourceFile) {
        facts[previous] = { ...facts[previous], sourceFile: fact.sourceFile };
      }
      return;
    }
    if (facts.length >= 256) {
      return;
    }
    seen.set(key, facts.length);
    facts.push(fact);
  };
  const fatalFml =
    /ModLoadingException|Loading errors encountered|Failed to start FML|Missing or unsupported mandatory dependencies|MissingModsException/i.test(
      text,
    );
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const forge =
      /Mod ID:\s*'([^']+)',\s*Requested by:\s*'([^']+)',\s*Expected range:\s*'([^']+)',\s*Actual version:\s*'([^']+)'/i.exec(
        line,
      );
    if (forge && fatalFml) {
      const dependency = cleanId(forge[1]),
        owner = cleanId(forge[2]);
      if (dependency && owner) {
        push({
          rule: 'forge-table',
          family: 'fml',
          kind: builtins.has(dependency)
            ? 'runtime'
            : /MISSING/i.test(forge[4])
              ? 'missing'
              : 'mismatch',
          owner,
          dependency,
          required: forge[3],
          installed: forge[4],
          evidence: line,
          confidence: 'high',
          reference: references.forge,
        });
      }
      continue;
    }
    const fml =
      /\bMod\s+([a-z0-9_.-]+)\s+(requires|only supports|is incompatible with)\s+([a-z0-9_.-]+)\s+([^\r\n]+)/i.exec(
        line,
      );
    if (fml && fatalFml) {
      const owner = cleanId(fml[1]),
        dependency = cleanId(fml[3]);
      const next = lines.slice(index + 1, index + 4).join('\n');
      const current = /Currently,\s*([a-z0-9_.-]+)\s+is\s+([^\r\n]+)/i.exec(next);
      const installed = current?.[1].toLowerCase() === dependency ? current[2].trim() : null;
      if (owner && dependency) {
        push({
          rule: 'fml-readable',
          family: 'fml',
          kind: /incompatible/i.test(fml[2])
            ? 'conflict'
            : builtins.has(dependency)
              ? 'runtime'
              : installed && /not installed/i.test(installed)
                ? 'missing'
                : 'mismatch',
          owner,
          dependency,
          required: fml[4],
          installed,
          evidence: `${line}\n${current?.[0] ?? ''}`.trim(),
          confidence: 'high',
          reference: references.fml,
        });
      }
      continue;
    }
    const fabric =
      /(?:Mod|El mod)\s+['"](.+?)['"]\s+\(([a-z0-9_.-]+)\)\s+(\S+)\s+(requires|needs|necesita|is incompatible with)\s+(.+?)(?:,\s*(which|but|yet|pero|que)\s+(.+))?[!.]?$/i.exec(
        line,
      );
    if (fabric) {
      const requirement = fabric[5],
        tail = fabric[7] ?? '';
      const dep = /(?:['"].*?['"]\s*\(([a-z0-9_.-]+)\)|\b([a-z0-9_.-]+))\s*$/i.exec(requirement);
      const dependency = cleanId(dep?.[1] ?? dep?.[2] ?? ''),
        owner = cleanId(fabric[2]);
      const predicate = dep
        ? requirement
            .slice(0, dep.index)
            .replace(/\s+(?:of|of mod|de)\s*$/i, '')
            .trim()
        : '';
      if (owner && dependency) {
        push({
          rule: 'fabric-readable',
          family: 'fabric',
          kind: /incompatible/i.test(fabric[4])
            ? 'conflict'
            : /environment|entorno/i.test(tail)
              ? 'environment'
              : builtins.has(dependency)
                ? 'runtime'
                : /missing|falta|ausente/i.test(tail)
                  ? 'missing'
                  : 'mismatch',
          owner,
          dependency,
          required: predicate,
          installed: /present:\s*([^!]+)/i.exec(tail)?.[1] ?? null,
          evidence: line,
          confidence: 'high',
          reference: references.fabric,
        });
      }
      continue;
    }
    for (const match of line.matchAll(
      /HARD_DEP(?:_INCOMPATIBLE_PRESELECTED|_NO_CANDIDATE)?\s+([a-z0-9_.-]+)\s+\S+\s+\{depends ([a-z0-9_.-]+) @ \[([^\]]+)\]\}/gi,
    )) {
      const dependency = match[2].toLowerCase();
      push({
        rule: 'fabric-solver',
        family: 'fabric',
        kind: builtins.has(dependency) ? 'runtime' : 'unsatisfied',
        owner: match[1].toLowerCase(),
        dependency,
        required: match[3],
        installed: null,
        evidence: line,
        confidence: 'high',
        reference: references.fabric,
      });
    }
    const legacy =
      /The mod ([a-z0-9_.-]+) \(.+?\) requires mod(?:s| versions) \[([^\]]+)\] to be available/i.exec(
        line,
      );
    if (legacy && /MissingModsException|requires mod/i.test(text)) {
      for (const requirement of legacy[2].split(/,\s*(?=[a-z_][a-z0-9_.-]*(?:@|,|$))/i)) {
        const [id, range] = requirement.split('@');
        const dependency = cleanId(id);
        if (dependency) {
          push({
            rule: 'forge-legacy',
            family: 'legacy-forge',
            kind: builtins.has(dependency) ? 'runtime' : 'missing',
            owner: legacy[1].toLowerCase(),
            dependency,
            required: range ?? '*',
            installed: null,
            evidence: line,
            confidence: 'high',
            reference: references.legacy,
          });
        }
      }
    }
    const legacyRanges = /\bMod ([a-z0-9_.-]+) \(.+?\) requires \[([^\r\n]+)\]/i.exec(line);
    if (legacyRanges) {
      for (const item of legacyRanges[2].split(/,\s*(?=[a-z_][a-z0-9_.-]*@)/i)) {
        const at = item.indexOf('@'),
          dependency = cleanId(item.slice(0, at));
        if (at < 1 || !dependency) {
          continue;
        }
        push({
          rule: 'forge-legacy-range',
          family: 'legacy-forge',
          kind: builtins.has(dependency) ? 'runtime' : 'unsatisfied',
          owner: legacyRanges[1].toLowerCase(),
          dependency,
          required: item.slice(at + 1),
          installed: null,
          evidence: line,
          confidence: 'high',
          reference: references.legacy,
        });
      }
    }
    // Quilt titles may contain display names rather than IDs. Preserve the
    // evidence but do not guess an install slug or removable file from a name.
    if (
      /quilt/i.test(text) &&
      /(?:transitively )?requires (?:any version|version|at least version|a version in the range)/i.test(
        line,
      ) &&
      !fabric
    ) {
      const requirement = /requires\s+(.+?)\s+of\s+([a-z0-9_.-]+),\s*which is missing/i.exec(line);
      const hint = /^\s*-\s*<mods>\/([^/\\]+\.jar)\s*$/i.exec(lines[index + 1] ?? '')?.[1];
      push({
        rule: 'quilt-solver',
        family: 'quilt',
        kind: requirement ? 'missing' : 'mismatch',
        owner: null,
        dependency: requirement ? cleanId(requirement[2]) : null,
        required: requirement?.[1] ?? null,
        installed: null,
        evidence: line,
        confidence: 'high',
        reference: references.quilt,
        displayOwner: line.slice(0, line.indexOf('requires')).trim(),
        ...(hint ? { sourceFile: hint } : {}),
      });
    }
    for (const rule of structuralRules) {
      if (
        rule.kind !== 'wrong-loader' &&
        /\bWARN(?:ING)?\b/i.test(line) &&
        !/Caused by:|Exception in thread/.test(line)
      ) {
        continue;
      }
      if (rule.pattern.test(line)) {
        push({
          rule: rule.id,
          family: rule.family,
          kind: rule.kind,
          owner: null,
          dependency: null,
          required: null,
          installed: null,
          evidence: line,
          confidence: rule.confidence,
          reference:
            rule.family === 'jvm'
              ? references.jvm
              : rule.family === 'quilt'
                ? references.quilt
                : references.fml,
        });
      }
    }
  }
  return facts;
}

const structuralRules: readonly {
  id: string;
  family: DependencyFact['family'];
  kind: DependencyKind;
  confidence: DependencyFact['confidence'];
  pattern: RegExp;
}[] = [
  {
    id: 'duplicate-id',
    family: 'fml',
    kind: 'duplicate',
    confidence: 'high',
    pattern:
      /Duplicate mandatory mod ids\s*\[|DuplicateModsFoundException|Found (?:a )?duplicate mod|Duplicate mod(?:s| ID|:)|Mod \S+ is present in multiple files/i,
  },
  {
    id: 'language-provider',
    family: 'fml',
    kind: 'language',
    confidence: 'high',
    pattern:
      /needs language provider|Missing language (?:provider|loader)|Language Loading Provider.*not found/i,
  },
  {
    id: 'dependency-cycle',
    family: 'fml',
    kind: 'cycle',
    confidence: 'high',
    pattern:
      /dependency cycle was detected|CyclicDependencyException|CyclePresentException|cyclic mod dependencies/i,
  },
  {
    id: 'wrong-side',
    family: 'jvm',
    kind: 'environment',
    confidence: 'high',
    pattern:
      /Attempted to load class .* for invalid dist|Cannot load class .* in environment type (?:SERVER|CLIENT)/i,
  },
  {
    id: 'binary-api',
    family: 'jvm',
    kind: 'linkage',
    confidence: 'high',
    pattern:
      /NoSuchMethodError:|NoSuchFieldError:|AbstractMethodError:|IncompatibleClassChangeError:/,
  },
  {
    id: 'mixin-target',
    family: 'jvm',
    kind: 'linkage',
    confidence: 'medium',
    pattern:
      /MixinApplyError|InvalidInjectionException|InjectionError:|MixinTransformerError|IllegalAccessError:.*(?:module|loader|cannot access)/,
  },
  {
    id: 'missing-class',
    family: 'jvm',
    kind: 'missing-class',
    confidence: 'medium',
    pattern:
      /(?:NoClassDefFoundError|ClassNotFoundException):\s*(?!Could not initialize class)[\w.$/]+/,
  },
  {
    id: 'archive-corrupt',
    family: 'jvm',
    kind: 'corrupt',
    confidence: 'high',
    pattern: /ZipException:|zip END header not found|invalid LOC header/i,
  },
  {
    id: 'nested-constraints',
    family: 'fml',
    kind: 'nested',
    confidence: 'high',
    pattern:
      /requested conflicting versions of:|no jar was provided which matched the range|JarInJar.*(?:conflict|Failed to select)/i,
  },
  {
    id: 'mixin-config-conflict',
    family: 'fml',
    kind: 'nested',
    confidence: 'high',
    pattern: /A mixin config named .* is provided by both /i,
  },
  {
    id: 'loader-installation',
    family: 'fml',
    kind: 'runtime',
    confidence: 'high',
    pattern:
      /Your (?:NeoForge|Forge) installation is corrupted|patched Minecraft jar is missing|The NeoForge jar is missing/i,
  },
  {
    id: 'ignored-wrong-loader',
    family: 'fml',
    kind: 'wrong-loader',
    confidence: 'high',
    pattern:
      /is a (?:Fabric|Quilt|NeoForge|Forge) mod and cannot be loaded|is for an old version of Minecraft Forge and cannot be loaded/i,
  },
];

/** A fact explains failure; a plan is allowed only when its target is unambiguous. */
export function planDependencySolutions(
  facts: readonly DependencyFact[],
): readonly DependencyPlan[] {
  const plans: DependencyPlan[] = [];
  const blockedOwners = new Set(
    facts
      .filter(
        (fact) =>
          fact.kind === 'runtime' || fact.kind === 'environment' || fact.kind === 'conflict',
      )
      .map((fact) => fact.owner),
  );
  const grouped = new Map<string, DependencyFact[]>();
  for (const fact of facts) {
    if (
      fact.owner &&
      ['runtime', 'mismatch', 'unsatisfied', 'conflict', 'environment', 'missing'].includes(
        fact.kind,
      )
    ) {
      plans.push({
        kind: 'isolate',
        owner: fact.owner,
        dependency: null,
        constraint: null,
        reason: fact.rule,
      });
    } else {
      plans.push({
        kind: 'review',
        owner: fact.owner,
        dependency: fact.dependency,
        constraint: null,
        reason: fact.rule,
      });
    }
    if (fact.kind !== 'missing' || !fact.dependency || builtins.has(fact.dependency)) {
      continue;
    }
    const entries = grouped.get(fact.dependency) ?? [];
    entries.push(fact);
    grouped.set(fact.dependency, entries);
  }
  for (const [id, owners] of grouped) {
    // Other facts for the same dependency may require a different version. A
    // missing-dependency install must respect all constraints, not just one line.
    const related = facts.filter(
      (fact) =>
        fact.dependency === id &&
        ['missing', 'mismatch', 'unsatisfied'].includes(fact.kind) &&
        !(
          fact.rule === 'fabric-readable' &&
          facts.some(
            (other) =>
              other.rule === 'fabric-solver' &&
              other.owner === fact.owner &&
              other.dependency === id,
          )
        ),
    );
    const ranges = [
      ...new Set(related.map((fact) => normalizeDependencyConstraint(fact.required ?? ''))),
    ];
    if (
      facts.some((fact) => fact.rule === 'loader-installation') ||
      owners.some((fact) => !fact.owner || blockedOwners.has(fact.owner)) ||
      ranges.includes(null) ||
      related.some(
        (fact) =>
          fact.kind === 'mismatch' &&
          fact.installed &&
          !/not installed|MISSING/i.test(fact.installed),
      )
    ) {
      continue;
    }
    const constraint = (ranges as string[]).map((range) => `(${range})`).join(' && ');
    if (dependencyIntersection(ranges as string[]) === false) {
      plans.push({
        kind: 'review',
        owner: null,
        dependency: id,
        constraint,
        reason: 'empty-intersection',
      });
      continue;
    }
    plans.push({
      kind: 'install',
      owner: null,
      dependency: id === 'fabric' ? 'fabric-api' : id,
      constraint,
      reason: 'all-declared-constraints',
    });
  }
  return plans.filter(
    (plan, index) =>
      plans.findIndex((other) => JSON.stringify(other) === JSON.stringify(plan)) === index,
  );
}

/** Unknown predicates fail closed; each AND group may contain OR alternatives. */
export function matchesDependencyPlan(version: string, expression: string): boolean {
  return expression.split(/\s*&&\s*/).every((part) => {
    const value = part.trim();
    const range = /^[[(][^,()[\]]*,[^,()[\]]*[)\]]$/.test(value)
      ? value
      : value.replace(/^\((.*)\)$/s, '$1');
    return matchesModRange(version, [range.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1')]) === true;
  });
}
