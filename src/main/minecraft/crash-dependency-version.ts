import { matchesDependencyPlan } from './dependency-intelligence';

/** Every installed mod's requirement must hold; unknown predicates remain rejected. */
export function matchesCrashDependencyVersion(version: string, constraints: string): boolean {
  // The loader can accept prereleases in a wildcard, but automatic repairs
  // must not introduce one when the request only names a stable release line.
  const stableWildcard = /^\d+(?:\.\d+)*\.[x*]$/i.test(constraints.trim());
  if (stableWildcard && /^\d+(?:\.\d+)*-[^+]+/.test(version)) {
    return false;
  }
  return matchesDependencyPlan(version, constraints);
}
