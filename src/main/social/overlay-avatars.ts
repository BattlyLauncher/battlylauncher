const cache = new Map<string, { value: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

export function overlayAvatar(username: unknown): Promise<string> {
  if (typeof username !== 'string' || !/^[\w.+-]{1,64}$/.test(username)) {
    throw new TypeError('Invalid avatar username');
  }
  const saved = cache.get(username);
  if (saved && saved.expires > Date.now()) {
    return Promise.resolve(saved.value);
  }
  const running = pending.get(username);
  if (running) {
    return running;
  }
  if (pending.size >= 8) {
    return Promise.resolve('');
  }
  const task = (async () => {
    const response = await fetch(
      `https://api.battlylauncher.com/api/face/${encodeURIComponent(username)}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return '';
    }
    const reader = response.body.getReader(),
      chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        size += chunk.value.byteLength;
        if (size > 256 * 1024) {
          throw new Error('Avatar exceeds limit');
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return '';
    }
    const value = `data:image/png;base64,${bytes.toString('base64')}`;
    if (cache.size >= 128) {
      cache.delete(cache.keys().next().value!);
    }
    cache.set(username, { value, expires: Date.now() + 10 * 60_000 });
    return value;
  })().finally(() => pending.delete(username));
  pending.set(username, task);
  return task;
}
