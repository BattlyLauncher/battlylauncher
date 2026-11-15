/** null means unknown, never compatible. Handles numeric Fabric predicates and Maven intervals. */
export function matchesModRange(version: string | null, ranges: readonly string[]): boolean | null {
  if (!version || !ranges.length) {
    return null;
  }
  const numeric = (value: string): number[] | null =>
    !/-snapshot-\d+/i.test(value) && /^\d+(?:\.\d+)*(?:-[\w.-]*)?(?:\+[^\s]+)?$/.test(value)
      ? value.split('+')[0].split('-')[0].split('.').map(Number)
      : null;
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] ?? 0) - (b[i] ?? 0);
      if (delta) {
        return Math.sign(delta);
      }
    }
    return 0;
  };
  const actual = numeric(version);
  const compareActual = (expected: number[], raw: string): number => {
    const delta = compare(actual!, expected);
    if (delta) {
      return delta;
    }
    const pre = (value: string) => value.split('+')[0].match(/-(.*)$/)?.[1];
    const a = pre(version),
      b = pre(raw);
    if (a === b) {
      return 0;
    }
    if (a === undefined) {
      return 1;
    }
    if (b === undefined) {
      return -1;
    }
    if (!a) {
      return -1;
    }
    if (!b) {
      return 1;
    }
    const left = a.split('.'),
      right = b.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i] === right[i]) {
        continue;
      }
      if (left[i] === undefined) {
        return -1;
      }
      if (right[i] === undefined) {
        return 1;
      }
      const an = /^\d+$/.test(left[i]),
        bn = /^\d+$/.test(right[i]);
      if (an && bn) {
        return Math.sign(Number(left[i]) - Number(right[i]));
      }
      if (an !== bn) {
        return an ? -1 : 1;
      }
      return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  };
  const single = (raw: string): boolean | null => {
    const range = raw.trim();
    if (range === '*') {
      return true;
    }
    if (range === version || range === `=${version}`) {
      return true;
    }
    // Every pre-release (including Fabric's empty one) precedes its stable numeric version.
    // Unnormalized Minecraft snapshot labels remain unknown rather than guessing their ordering.
    const earliest = range.match(/^(>=|<=|>|<|=)?(\d+(?:\.\d+)*)-[\w.-]*$/);
    if (earliest) {
      if (!actual) {
        return null;
      }
      const delta = compareActual(numeric(earliest[2])!, range.replace(/^(>=|<=|>|<|=)/, ''));
      switch (earliest[1]) {
        case '>=':
          return delta >= 0;
        case '>':
          return delta > 0;
        case '<=':
          return delta <= 0;
        case '<':
          return delta < 0;
        default:
          return delta === 0;
      }
    }
    const intervals = range.match(/[[(][^\][()]*[\])]/g);
    if (intervals && intervals.length > 1 && intervals.join(',') === range) {
      const results = intervals.map(single);
      return results.includes(true) ? true : results.includes(null) ? null : false;
    }
    const exact = range.match(/^\[([^,]+)\]$/);
    if (exact) {
      return single(`=${exact[1]}`);
    }
    const interval = range.match(/^([[(])([^,]*),([^\])]*)([\])])$/);
    if (interval) {
      if (!actual) {
        return null;
      }
      const low = interval[2].trim(),
        high = interval[3].trim();
      const bound = (value: string) =>
        numeric(value) ??
        (/^\d+(?:\.\d+)*-[\w.-]*$/.test(value) ? numeric(value.split('-')[0]) : null);
      const a = low ? bound(low) : null,
        b = high ? bound(high) : null;
      if ((low && !a) || (high && !b)) {
        return null;
      }
      const delta = (value: number[], raw: string) => compareActual(value, raw);
      return (
        (!a || delta(a, low) >= (interval[1] === '[' ? 0 : 1)) &&
        (!b || delta(b, high) <= (interval[4] === ']' ? 0 : -1))
      );
    }
    const terms = range.replace(/(>=|<=|>|<|=|~|\^)\s+/g, '$1').split(/\s+/);
    if (terms.length > 1) {
      const results = terms.map(single);
      return results.includes(false) ? false : results.includes(null) ? null : true;
    }
    const wildcard = range.match(/^(\d+(?:\.\d+)*)\.[x*]$/i);
    if (wildcard) {
      return actual
        ? wildcard[1]
            .split('.')
            .map(Number)
            .every((n, i) => n === actual[i])
        : null;
    }
    const term = range.match(/^(>=|<=|>|<|=|~|\^)?(\d+(?:\.\d+)*(?:-[\w.-]*)?(?:\+[^\s]+)?)$/);
    if (!term || !actual) {
      return null;
    }
    const expected = numeric(term[2])!;
    const delta = compareActual(expected, term[2]);
    switch (term[1]) {
      case '>=':
        return delta >= 0;
      case '<=':
        return delta <= 0;
      case '>':
        return delta > 0;
      case '<':
        return delta < 0;
      case '~':
      case '^': {
        const upper = [...expected];
        const nonzero = upper.findIndex((n) => n !== 0);
        const index =
          term[1] === '~'
            ? Math.min(1, upper.length - 1)
            : nonzero < 0
              ? upper.length - 1
              : nonzero;
        upper[index] = upper[index] + 1;
        for (let i = index + 1; i < upper.length; i++) {
          upper[i] = 0;
        }
        return delta >= 0 && compare(actual, upper) < 0;
      }
      default:
        return delta === 0;
    }
  };
  const results = ranges.flatMap((range) => range.split('||')).map(single);
  return results.includes(true) ? true : results.includes(null) ? null : false;
}
