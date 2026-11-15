const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { prepare, machine } = require('./prepare-official-windows.cjs');
const { verify } = require('./verify-windows-updater.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-official-installer-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }));
  const payloads = new Map();
  const protocol = { schema: 1, protocol: 2, qa: false, installers: [] };
  for (const [name, arch, cpu] of [
    ['Battly-Launcher-Windows.exe', 'x64', 0x8664],
    ['Battly-Launcher-win-ia32.exe', 'ia32', 0x014c],
  ]) {
    const b = Buffer.alloc(128);
    b.write('MZ');
    b.writeUInt32LE(64, 60);
    b.write('PE\0\0', 64);
    b.writeUInt16LE(cpu, 68);
    payloads.set(name, b);
    protocol.installers.push({
      file: name,
      arch,
      size: b.length,
      sha512: crypto.createHash('sha512').update(b).digest('base64'),
    });
  }
  const release = { tag_name: 'rust_v4.2.0', draft: false, prerelease: false, assets: [] };
  function refresh() {
    payloads.set('installer-protocol.json', Buffer.from(JSON.stringify(protocol)));
    release.assets = [...payloads].map(([name, b]) => ({
      name,
      size: b.length,
      digest: 'sha256:' + crypto.createHash('sha256').update(b).digest('hex'),
      browser_download_url: `https://github.com/BattlyLauncher/battlyinstaller/releases/download/rust_v4.2.0/${name}`,
    }));
  }
  refresh();
  const options = {
    directory,
    pkg: {
      version: '3.1.0',
      battlyUpdate: { channel: 'stable' },
      build: { win: { signtoolOptions: { publisherName: 'Pinned publisher' } } },
    },
    fetchImpl: async (url) =>
      new Response(
        url.includes('/repos/') ? JSON.stringify(release) : payloads.get(url.split('/').at(-1)),
      ),
    signature: async () => null,
    execution: () => true,
    blockmap: (file) => fs.writeFile(file + '.blockmap', 'test blockmap'),
  };
  return { directory, protocol, payloads, release, refresh, options };
}

test('copies exact official bytes to legacy names and feeds both architectures without NSIS', async (t) => {
  const f = await fixture(t);
  const proof = await prepare(f.options);
  const names = await fs.readdir(f.directory);
  assert(names.includes('Battly-Launcher-win.exe'));
  assert(!names.some((name) => name.endsWith('-Setup.exe')));
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, 'Battly-Launcher-win.exe')),
    f.payloads.get('Battly-Launcher-Windows.exe'),
  );
  assert.equal(
    machine(await fs.readFile(path.join(f.directory, 'Battly-Launcher-win-ia32.exe'))),
    0x014c,
  );
  const feed = yaml.load(await fs.readFile(path.join(f.directory, 'latest.yml'), 'utf8'));
  assert.deepEqual(
    feed.files.map((entry) => entry.url),
    ['Battly-Launcher-win.exe', 'Battly-Launcher-win-ia32.exe'],
  );
  assert.equal(proof.repository, 'BattlyLauncher/battlyinstaller');
  assert.equal(proof.installers.length, 2);
  for (const suffix of ['', '.blockmap']) {
    assert.deepEqual(
      await fs.readFile(path.join(f.directory, 'Battly-Launcher-win-x64.exe' + suffix)),
      await fs.readFile(path.join(f.directory, 'Battly-Launcher-win.exe' + suffix)),
    );
  }
  assert.equal(
    (await verify(f.directory, '3.1.0', 'Pinned publisher', async () => null)).length,
    2,
  );
});

test('uses the CI token for GitHub metadata without forwarding it to executable downloads', async (t) => {
  const f = await fixture(t);
  const transport = f.options.fetchImpl;
  const requests = [];
  f.options.token = 'local-fixture-only';
  f.options.fetchImpl = (url, options) => {
    requests.push({ url, authorization: options.headers?.Authorization });
    return transport(url, options);
  };
  await prepare(f.options);
  assert.equal(requests[0].authorization, 'Bearer local-fixture-only');
  assert(requests[0].url.startsWith('https://api.github.com/'));
  assert(requests.slice(1).every((request) => request.authorization === undefined));
});

test('rejects the old protocol, test builds, a disguised x64 as ia32 and untrusted signatures before exporting', async (t) => {
  for (const kind of ['old', 'qa', 'cpu', 'signature', 'hash', 'url', 'elevation']) {
    const f = await fixture(t);
    if (kind === 'old') f.protocol.protocol = 1;
    if (kind === 'qa') f.protocol.qa = true;
    if (kind === 'cpu')
      f.payloads.set('Battly-Launcher-win-ia32.exe', f.payloads.get('Battly-Launcher-Windows.exe'));
    f.refresh();
    if (kind === 'elevation') f.options.execution = () => false;
    if (kind === 'signature') f.options.signature = async () => 'Untrusted publisher';
    if (kind === 'hash') f.release.assets[0].digest = 'sha256:' + '0'.repeat(64);
    if (kind === 'url')
      f.release.assets[0].browser_download_url = 'https://evil.example/installer.exe';
    await assert.rejects(prepare(f.options));
    assert.deepEqual(await fs.readdir(f.directory), [], kind);
  }
});

test('the x64 download alias rejects changed bytes, changed blockmaps and incomplete pairs', async (t) => {
  for (const kind of ['executable', 'blockmap', 'missing-map']) {
    const f = await fixture(t);
    await prepare(f.options);
    const alias = path.join(f.directory, 'Battly-Launcher-win-x64.exe');
    if (kind === 'executable') await fs.appendFile(alias, 'changed');
    if (kind === 'blockmap') await fs.appendFile(alias + '.blockmap', 'changed');
    if (kind === 'missing-map') await fs.unlink(alias + '.blockmap');
    await assert.rejects(
      verify(f.directory, '3.1.0', 'Pinned publisher', async () => null),
      /alias/,
    );
  }
});
