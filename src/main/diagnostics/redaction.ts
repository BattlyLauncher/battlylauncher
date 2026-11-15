const sensitiveKeyPattern =
  /(?:authorization|cookie|credential|password|passwd|pinHash|refreshToken|secret|session|token)/i;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?\b/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const windowsPathPattern = /\b[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const maximumDepth = 8;
const maximumItems = 100;

function redactText(value: string): string {
  return value
    .slice(0, 4_000)
    .replace(/(?:https?|mongodb(?:\+srv)?):\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/\/(?:home|Users)\/[^\s]+/g, '[REDACTED_PATH]')
    .replace(bearerPattern, 'Bearer [REDACTED]')
    .replace(jwtPattern, '[REDACTED_TOKEN]')
    .replace(emailPattern, '[REDACTED_EMAIL]')
    .replace(windowsPathPattern, '[REDACTED_PATH]')
    .replace(uuidPattern, '[REDACTED_ID]');
}

function sanitize(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  budget: { left: number },
): unknown {
  if (--budget.left < 0) {
    return '[TRUNCATED]';
  }
  if (depth > maximumDepth) {
    return '[TRUNCATED]';
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[INVALID_NUMBER]';
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value instanceof Error) {
    return {
      name: redactText(value.name),
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
    };
  }
  if (!value || typeof value !== 'object') {
    return `[${typeof value}]`;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, maximumItems).map((item) => sanitize(item, depth + 1, seen, budget));
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).slice(0, maximumItems)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      continue;
    }
    result[key] = sensitiveKeyPattern.test(key)
      ? '[REDACTED]'
      : sanitize(Object.getOwnPropertyDescriptor(value, key)?.value, depth + 1, seen, budget);
  }
  return result;
}

export function sanitizeDiagnosticValue(value: unknown): unknown {
  return sanitize(value, 0, new WeakSet<object>(), { left: 500 });
}
