const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const { installPatchCdn } = require('../dist/main/updates/patch-cdn-runtime');
const { hash } = require('../bootstrap/patch-runtime.cjs');
const { patchStorageRoot } = require('../bootstrap/runtime-config.cjs');
const SYMBOL = Symbol.for('battly.patch.runtime');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-cdn-adoption-'));
  const installedRoot = path.join(temp, 'installed'),
    userData = path.join(temp, 'profile');
  const previous = globalThis[SYMBOL];
  t.after(() => {
    globalThis[SYMBOL] = previous;
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  fs.mkdirSync(path.join(installedRoot, 'bootstrap'), { recursive: true });
  for (const file of ['patch-runtime.cjs', 'github-patch-feed.cjs', 'runtime-config.cjs'])
    fs.copyFileSync(
      path.join(__dirname, '../bootstrap', file),
      path.join(installedRoot, 'bootstrap', file),
    );
  fs.writeFileSync(path.join(installedRoot, 'package.json'), '{}');
  const keys = crypto.generateKeyPairSync('ed25519');
  const config = {
    schema: 1,
    version: '3.1.0',
    baseBuild: 1,
    runtimeId: 'a'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    githubRepository: 'BattlyLauncher/battlylauncher',
    feed: '',
  };
  fs.writeFileSync(path.join(installedRoot, 'bootstrap/config.json'), JSON.stringify(config));
  const files = {
    'dist/main/index.js': 'base',
    'dist/preload/index.js': 'preload',
    'dist/renderer/index.html': 'html',
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(installedRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  const root = patchStorageRoot(userData, config),
    bodies = new Map(),
    assets = [];
  function candidate(build) {
    const changed = { ...files, 'dist/main/index.js': 'patch ' + build };
    const m = {
      schema: 1,
      type: 'patch',
      baseVersion: '3.1.0',
      patchVersion: `3.1.0-patch${build}`,
      build,
      runtimeId: config.runtimeId,
      platform: config.platform,
      arch: config.arch,
      channel: 'stable',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      notes: 'fix',
      files: Object.entries(changed).map(([name, bytes]) => ({
        path: name,
        sha256: hash(bytes),
        size: Buffer.byteLength(bytes),
      })),
    };
    const payload = Buffer.from(JSON.stringify(m));
    const envelope = {
      payload: payload.toString('base64'),
      signature: crypto.sign(null, payload, keys.privateKey).toString('base64'),
    };
    const rows = [];
    for (const file of m.files) {
      const id = 100 + assets.length;
      const row = { id, name: file.sha256 + '.blob', size: file.size, state: 'uploaded' };
      assets.push(row);
      rows.push(row);
      bodies.set(id, Buffer.from(changed[file.path]));
    }
    const id = build;
    const manifest = {
      id: 1000 + build,
      name: `patch-${config.runtimeId}-stable-${config.platform}-${config.arch}.json`,
      size: Buffer.byteLength(JSON.stringify(envelope)),
      state: 'uploaded',
    };
    rows.unshift(manifest);
    bodies.set(manifest.id, Buffer.from(JSON.stringify(envelope)));
    return { m, envelope, id: `${build}-${hash(payload)}`, assets: rows, releaseId: id };
  }
  const api = async (url) => {
    const id = Number(new URL(url).pathname.split('/').at(-1));
    return new Response(bodies.get(id));
  };
  const createRuntime = require(
    path.join(installedRoot, 'bootstrap/patch-runtime.cjs'),
  ).createRuntime;
  return { installedRoot, userData, root, config, candidate, bodies, api, createRuntime };
}
test('a signed patch switches transport after healthy boot without modifying any installer files', async (t) => {
  const f = fixture(t);
  const c2 = f.candidate(2),
    c3 = f.candidate(3);
  const before = fs.readFileSync(path.join(f.installedRoot, 'bootstrap/github-patch-feed.cjs'));
  const setup = f.createRuntime({
    config: f.config,
    root: f.root,
    installedRoot: f.installedRoot,
    fetcher: f.api,
  });
  setup.boot();
  await setup.stage(c2, () => {});
  setup.activate();
  const old = f.createRuntime({
    config: f.config,
    root: f.root,
    installedRoot: f.installedRoot,
    fetcher: f.api,
  });
  old.boot();
  globalThis[SYMBOL] = old;
  assert.equal(installPatchCdn({ ...f, fetcher: f.api }), false, 'do not confirm an untested boot');
  assert.equal(old.snapshot().pending, true);
  old.healthy();
  let github = 0,
    cdn = 0;
  const fetcher = async (url, options) => {
    if (new URL(url).hostname === 'api.github.com') {
      github++;
      throw Error('GitHub blocked');
    }
    cdn++;
    assert.equal(options.headers.Authorization, undefined);
    const resource = new URL(url).pathname.replace('/public/updates/patches/', '');
    if (resource === 'releases-1.json')
      return Response.json([
        {
          id: 3,
          tag_name: 'battly-patch-3.1.0-patch3',
          draft: false,
          prerelease: true,
          assets: c3.assets,
        },
      ]);
    if (resource === 'releases/3/assets-1.json') return Response.json(c3.assets);
    const manifest = /^manifests\/(\d+)\.json$/.exec(resource);
    if (manifest) return new Response(f.bodies.get(Number(manifest[1])));
    const blob = /^blobs\/([a-f0-9]{64})$/.exec(resource);
    if (blob) {
      const asset = c3.assets.find((a) => a.name === blob[1] + '.blob');
      return new Response(f.bodies.get(asset.id));
    }
    throw Error(resource);
  };
  assert.equal(installPatchCdn({ ...f, fetcher }), true);
  const runtime = globalThis[SYMBOL];
  assert.equal(runtime.snapshot().build, 2);
  assert.equal(runtime.snapshot().pending, false);
  assert.equal(installPatchCdn({ ...f, fetcher }), false, 'installation is idempotent');
  const checked = await runtime.check();
  assert.equal(checked.m.build, 3);
  let reused = 0;
  await runtime.stage(checked, (p) => {
    reused = p.reused;
  });
  assert(reused > 0);
  runtime.activate();
  assert.equal(github, 0);
  assert(cdn > 0);
  const reopened = f.createRuntime({
    config: f.config,
    root: f.root,
    installedRoot: f.installedRoot,
    fetcher: f.api,
  });
  assert.equal(fs.readFileSync(reopened.boot(), 'utf8'), 'patch 3');
  reopened.healthy();
  reopened.rollback();
  const rolledBack = f.createRuntime({
    config: f.config,
    root: f.root,
    installedRoot: f.installedRoot,
    fetcher: f.api,
  });
  assert.equal(fs.readFileSync(rolledBack.boot(), 'utf8'), 'patch 2');
  assert.deepEqual(
    fs.readFileSync(path.join(f.installedRoot, 'bootstrap/github-patch-feed.cjs')),
    before,
  );
});
test('development and unconfigured runtimes keep their existing transport', (t) => {
  const f = fixture(t);
  globalThis[SYMBOL] = undefined;
  assert.equal(installPatchCdn(f), false);
});

test('the adopted runtime retains the installed signature verifier and rejects forged patches', async (t) => {
  const f = fixture(t);
  const candidate = f.candidate(3);
  const old = f.createRuntime({
    config: f.config,
    root: f.root,
    installedRoot: f.installedRoot,
    fetcher: f.api,
  });
  old.boot();
  old.healthy();
  globalThis[SYMBOL] = old;
  const manifest = candidate.assets[0];
  const envelope = JSON.parse(f.bodies.get(manifest.id));
  envelope.signature = 'A'.repeat(88);
  f.bodies.set(manifest.id, Buffer.from(JSON.stringify(envelope)));
  manifest.size = f.bodies.get(manifest.id).length;
  const fetcher = async (url) => {
    if (url.endsWith('releases-1.json'))
      return Response.json([
        {
          id: 3,
          tag_name: 'battly-patch-3.1.0-patch3',
          draft: false,
          prerelease: true,
          assets: candidate.assets,
        },
      ]);
    return new Response(f.bodies.get(manifest.id));
  };
  assert.equal(installPatchCdn({ ...f, fetcher }), true);
  await assert.rejects(globalThis[SYMBOL].check(), /Firma/);
  assert.equal(globalThis[SYMBOL].snapshot().ready, false);
  assert.equal(globalThis[SYMBOL].snapshot().build, 1);
});
