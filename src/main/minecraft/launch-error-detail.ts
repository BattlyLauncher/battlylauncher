/** Bounded error evidence without serializing request/configuration objects. */
export function launchErrorDetail(value: unknown, secrets: readonly string[] = []): string {
  const seen = new Set<object>();
  const read = (item: unknown, depth: number): string => {
    if (depth > 5) {
      return '[cause truncated]';
    }
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      return String(item);
    }
    if (Buffer.isBuffer(item)) {
      return item.toString('utf8').slice(0, 8192);
    }
    if (!item || typeof item !== 'object') {
      return String(item);
    }
    if (seen.has(item)) {
      return '[circular]';
    }
    seen.add(item);
    const lines: string[] = [];
    for (const key of [
      'name',
      'message',
      'stack',
      'code',
      'errno',
      'syscall',
      'path',
      'error',
      'cause',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor && 'value' in descriptor) {
        lines.push(`${key}: ${read(descriptor.value, depth + 1)}`);
      }
    }
    return lines.join('\n') || '[error object without diagnostic fields]';
  };
  let text = read(value, 0).slice(0, 32768);
  for (const secret of secrets) {
    if (secret) {
      text = text.replaceAll(secret, '[redacted]');
    }
  }
  return text
    .replace(
      /\b(access[_-]?token|client[_-]?token|password|authorization)\s*[=:]\s*[^\s,;]+/gi,
      '$1=[redacted]',
    )
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
}
