interface PrepareQueueMessage {
  readonly type: 'prepare-queue';
  readonly songIds: readonly string[];
}

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const source = value as Partial<PrepareQueueMessage>;
  if (
    source.type !== 'prepare-queue' ||
    !Array.isArray(source.songIds) ||
    source.songIds.length > 500
  ) {
    return;
  }
  const unique = source.songIds.filter(
    (id, index, songs) =>
      typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && songs.indexOf(id) === index,
  );
  self.postMessage({ type: 'queue-prepared', count: unique.length });
});
