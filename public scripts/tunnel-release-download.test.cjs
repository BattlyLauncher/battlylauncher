const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { createHash } = require('node:crypto');
const {
  tunnelReleaseClient,
  tunnelReleaseVersion,
} = require('../dist/main/servers/battly-tunnel-release');
const bytes = Buffer.from('dummy-tunnel-binary');
const manifest = () => ({
  version: tunnelReleaseVersion,
  entries: [
    {
      target: 'win32-x64',
      role: 'client',
      file: 'battly-tunnel-client-win32-x64.exe',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  ],
});
test('release download verifies, coalesces and reuses an offline cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-release-'));
  const calls = [];
  try {
    const client = tunnelReleaseClient(root, 'win32-x64', async (url) => {
      calls.push(url);
      return url.endsWith('manifest.json') ? Response.json(manifest()) : new Response(bytes);
    });
    await Promise.all([client.prepare(), client.prepare()]);
    assert.equal(calls.length, 2);
    assert.deepEqual(await readFile(client.executable), bytes);
    await tunnelReleaseClient(root, 'win32-x64', async () => {
      throw Error('Offline');
    }).prepare();
    await writeFile(client.executable, 'tampered');
    await assert.rejects(client.prepare(), /dañado/);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('bad checksum never publishes the downloaded executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-release-'));
  try {
    const client = tunnelReleaseClient(root, 'win32-x64', async (url) =>
      url.endsWith('manifest.json') ? Response.json(manifest()) : new Response('wrong'),
    );
    await assert.rejects(client.prepare(), /dañado/);
    await assert.rejects(readFile(client.executable), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('redirect cannot leave approved GitHub asset hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-release-'));
  let calls = 0;
  try {
    const client = tunnelReleaseClient(root, 'win32-x64', async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/manifest.json' },
      });
    });
    await assert.rejects(client.prepare(), /Unsafe/);
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('manifest path traversal, wrong version and duplicate targets are rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-release-'));
  try {
    for (const change of [
      (m) => {
        m.entries[0].file = '../evil.exe';
      },
      (m) => {
        m.version = '9.9.9';
      },
      (m) => {
        m.entries.push(m.entries[0]);
      },
    ]) {
      const value = manifest();
      change(value);
      await assert.rejects(
        tunnelReleaseClient(root, 'win32-x64', async () => Response.json(value)).prepare(),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('streamed manifest size is bounded without content-length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-release-'));
  try {
    await assert.rejects(
      tunnelReleaseClient(
        root,
        'win32-x64',
        async () => new Response(Buffer.alloc(1024 * 1024 + 1)),
      ).prepare(),
      /size limit/,
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
