const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const {
  checkModernAssets,
  reusableMojangObject,
} = require('../dist/main/minecraft/launcher-file-reuse');
test('installed assets perform zero downloads and repair only a missing or truncated file', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'battly-reuse-'));
  const content = Buffer.from('verified resource');
  const hash = createHash('sha1').update(content).digest('hex');
  const dir = join(root, 'assets', 'objects', hash.slice(0, 2));
  const file = join(dir, hash);
  let downloads = 0;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(join(root, 'assets', 'indexes'), { recursive: true });
    await fs.writeFile(file, content);
    await fs.writeFile(
      join(root, 'assets', 'indexes', '1.21.json'),
      JSON.stringify({ objects: { test: { hash, size: content.length } } }),
    );
    const handler = {
      options: {
        root,
        version: { number: '1.21' },
        overrides: { url: { resource: 'https://resources.download.minecraft.net' } },
      },
      version: { assetIndex: { url: 'unused' } },
      client: { emit() {} },
      downloadAsync: async () => {
        downloads++;
        await fs.writeFile(file, content);
      },
    };
    await checkModernAssets.call(handler);
    assert.equal(downloads, 0);
    await fs.unlink(file);
    await checkModernAssets.call(handler);
    assert.equal(downloads, 1);
    await fs.writeFile(file, 'broken');
    await checkModernAssets.call(handler);
    assert.equal(downloads, 2);
    await checkModernAssets.call(handler);
    assert.equal(downloads, 2);
    assert.equal(
      await reusableMojangObject(`https://launcher.mojang.com/v1/objects/${hash}/config.xml`, file),
      true,
    );
    await fs.writeFile(file, 'bad');
    assert.equal(
      await reusableMojangObject(`https://launcher.mojang.com/v1/objects/${hash}/config.xml`, file),
      false,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
