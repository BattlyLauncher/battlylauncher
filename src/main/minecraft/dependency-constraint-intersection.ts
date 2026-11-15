type Version = readonly number[];
type Bound = { value: Version; inclusive: boolean };
type Interval = { low: Bound | null; high: Bound | null };
const compare = (a: Version, b: Version): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) - (b[i] ?? 0);
    }
  }
  return 0;
};
const numeric = (value: string): Version | null => {
  if (!/^\d+(?:\.\d+)*(?:\+[^\s]+)?$/.test(value)) {
    return null;
  }
  const parts = value.split('+')[0].split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
};
function intersect(a: Interval, b: Interval): Interval | null {
  let low = a.low,
    high = a.high;
  if (b.low && (!low || compare(b.low.value, low.value) > 0)) {
    low = b.low;
  } else if (low && b.low && compare(low.value, b.low.value) === 0) {
    low = { value: low.value, inclusive: low.inclusive && b.low.inclusive };
  }
  if (b.high && (!high || compare(b.high.value, high.value) < 0)) {
    high = b.high;
  } else if (high && b.high && compare(high.value, b.high.value) === 0) {
    high = { value: high.value, inclusive: high.inclusive && b.high.inclusive };
  }
  if (
    low &&
    high &&
    (compare(low.value, high.value) > 0 ||
      (compare(low.value, high.value) === 0 && (!low.inclusive || !high.inclusive)))
  ) {
    return null;
  }
  return { low, high };
}
function term(source: string): Interval | null {
  const range = source.trim();
  if (range === '*') {
    return { low: null, high: null };
  }
  const maven = /^([[(])([^,]*),([^,]*)([)\]])$/.exec(range);
  if (maven) {
    const low = maven[2].trim(),
      high = maven[3].trim(),
      a = low ? numeric(low) : null,
      b = high ? numeric(high) : null;
    if ((low && !a) || (high && !b)) {
      return null;
    }
    return {
      low: a ? { value: a, inclusive: maven[1] === '[' } : null,
      high: b ? { value: b, inclusive: maven[4] === ']' } : null,
    };
  }
  const exact = /^\[([^,]+)\]$/.exec(range);
  if (exact) {
    return term(exact[1]);
  }
  const wildcard = /^(\d+(?:\.\d+)*)\.[x*]$/i.exec(range);
  if (wildcard) {
    const low = wildcard[1].split('.').map(Number),
      high = [...low];
    high[high.length - 1]++;
    return { low: { value: low, inclusive: true }, high: { value: high, inclusive: false } };
  }
  const predicate = /^(>=|>|<=|<|=)?(.+)$/.exec(range),
    version = predicate ? numeric(predicate[2]) : null;
  if (!predicate || !version) {
    return null;
  }
  switch (predicate[1]) {
    case '>=':
    case '>':
      return { low: { value: version, inclusive: predicate[1] === '>=' }, high: null };
    case '<=':
    case '<':
      return { low: null, high: { value: version, inclusive: predicate[1] === '<=' } };
    default:
      return {
        low: { value: version, inclusive: true },
        high: { value: version, inclusive: true },
      };
  }
}
/** false proves an empty numeric intersection; null means the grammar is unknown. */
export function dependencyIntersection(ranges: readonly string[]): boolean | null {
  let candidates: Interval[] = [{ low: null, high: null }];
  for (const expression of ranges) {
    const alternatives: Interval[] = [];
    for (const raw of expression.split(/\s*\|\|\s*/)) {
      const value = raw.trim().replace(/(>=|<=|>|<|=)\s+/g, '$1');
      const terms = /^[[(].*[)\]]$/.test(value) ? [value] : value.split(/\s+/);
      let combined: Interval | null = { low: null, high: null };
      for (const item of terms) {
        const parsed = term(item);
        if (!parsed) {
          return null;
        }
        if (combined) {
          combined = intersect(combined, parsed);
        }
      }
      if (combined) {
        alternatives.push(combined);
      }
    }
    const next: Interval[] = [];
    for (const a of candidates) {
      for (const b of alternatives) {
        const merged = intersect(a, b);
        if (merged) {
          next.push(merged);
        }
        if (next.length > 64) {
          return null;
        }
      }
    }
    candidates = next;
    if (!candidates.length) {
      return false;
    }
  }
  return candidates.length > 0;
}
