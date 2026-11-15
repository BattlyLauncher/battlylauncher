const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
(async () => {
  const root = path.resolve('build-resources/terracotta');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const target = path.join(root, 'terracotta-battly.exe');
  const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
  if (hash(await fs.readFile(target).catch(() => Buffer.alloc(0))) === manifest.sha256) {
    console.log('Terracotta release binary verified.');
    return;
  }
  const url = new URL(manifest.downloadUrl);
  if (
    url.origin !== 'https://github.com' ||
    !url.pathname.startsWith('/BattlyLauncher/Terracotta/releases/download/')
  )
    throw Error('Invalid Terracotta release URL');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('Terracotta release download failed');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw Error('Terracotta release too large');
    chunks.push(chunk);
  }
  const binary = Buffer.concat(chunks);
  if (hash(binary) !== manifest.sha256) throw Error('Terracotta release checksum mismatch');
  const temp = target + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, binary, { flag: 'wx' });
  try {
    await fs.rename(temp, target);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  console.log('Terracotta installed from verified GitHub release.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
