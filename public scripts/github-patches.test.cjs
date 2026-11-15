const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { createRuntime, hash } = require('../bootstrap/patch-runtime.cjs');
const { createGitHubFeed } = require('../bootstrap/github-patch-feed.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-github-patch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const keys = crypto.generateKeyPairSync('ed25519'),
    config = {
      baseBuild: 1,
      version: '3.1.0',
      runtimeId: 'c'.repeat(64),
      platform: 'win32',
      arch: 'x64',
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      githubRepository: '1ly4s0/BattlyRemake',
    };
  const original = {
    'dist/main/index.js': 'base',
    'dist/preload/index.js': 'preload',
    'dist/renderer/index.html': '<body>original</body>',
  };
  const files = { ...original, 'dist/main/index.js': 'patch' };
  for (const [p, b] of Object.entries(original)) {
    const dest = path.join(dir, 'installed', p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, b);
  }
  let releases = [],
    assets = new Map(),
    bodies = new Map(),
    next = 20,
    requests = [],
    corrupt = false;
  function add(build, channel = 'stable', changes = {}) {
    const m = {
      schema: 1,
      type: 'patch',
      baseVersion: config.version,
      patchVersion: `3.1.0-patch${build}`,
      channel,
      runtimeId: config.runtimeId,
      platform: config.platform,
      arch: config.arch,
      build,
      notes: 'fix',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      files: Object.entries(files).map(([p, b]) => ({
        path: p,
        size: Buffer.byteLength(b),
        sha256: hash(b),
      })),
      ...changes,
    };
    const bytes = Buffer.from(JSON.stringify(m)),
      envelope = {
        payload: bytes.toString('base64'),
        signature: crypto.sign(null, bytes, keys.privateKey).toString('base64'),
      },
      id = next++,
      rows = [];
    const put = (name, data) => {
      const asset = { id: next++, name, size: Buffer.byteLength(data), state: 'uploaded' };
      rows.push(asset);
      bodies.set(asset.id, data);
    };
    put(
      `patch-${config.runtimeId}-${channel}-${config.platform}-${config.arch}.json`,
      JSON.stringify(envelope),
    );
    for (const b of Object.values(files)) put(`${hash(b)}.blob`, b);
    assets.set(id, rows);
    releases.push({
      id,
      tag_name: `battly-patch-${m.patchVersion}`,
      prerelease: true,
      draft: false,
    });
    return id;
  }
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    const u = new URL(url),
      p = u.pathname;
    if (p.endsWith('/releases')) return Response.json(releases);
    const list = p.match(/\/releases\/(\d+)\/assets$/);
    if (list) return Response.json(assets.get(Number(list[1])) || []);
    const file = p.match(/\/releases\/assets\/(\d+)$/);
    if (file) {
      const b = bodies.get(Number(file[1]));
      return new Response(corrupt && !String(b).startsWith('{') ? 'broken' : b);
    }
    throw Error('Unexpected request ' + url);
  };
  return {
    config,
    dir,
    add,
    requests,
    releases,
    assets,
    bodies,
    opts: {
      config,
      installedRoot: path.join(dir, 'installed'),
      root: path.join(dir, 'updates'),
      fetcher,
    },
    corrupt: () => {
      corrupt = true;
    },
  };
}

test('patch progress follows download, file installation and final disk verification', async (t) => {
  const f = fixture(t);
  f.add(2);
  const runtime = createRuntime(f.opts);
  const phases = [];
  await runtime.stage(await runtime.check(), (progress) => {
    if (phases.at(-1) !== progress.phase) phases.push(progress.phase);
    assert(progress.percent >= 0 && progress.percent <= 100);
  });
  assert.deepEqual(phases, ['downloading', 'installing', 'verifying']);
  runtime.activate();
  assert.equal(fs.readFileSync(createRuntime(f.opts).boot(), 'utf8'), 'patch');
});

test('disk corruption during installation never publishes the staged patch', async (t) => {
  const f = fixture(t);
  f.add(2);
  const runtime = createRuntime(f.opts);
  await assert.rejects(
    runtime.stage(await runtime.check(), (progress) => {
      if (progress.phase !== 'installing' || progress.percent !== 100) return;
      const staging = fs.readdirSync(f.opts.root).find((name) => name.startsWith('staging-'));
      fs.writeFileSync(path.join(f.opts.root, staging, 'build/dist/main/index.js'), 'tampered');
    }),
    /integridad/,
  );
  assert.equal(runtime.snapshot().ready, false);
  assert.throws(() => runtime.activate());
  assert.equal(fs.readFileSync(createRuntime(f.opts).boot(), 'utf8'), 'base');
});
test('GitHub prerelease patch: highest signed compatible build, incremental download, restart, healthy and rollback', async (t) => {
  const f = fixture(t);
  f.add(3);
  f.add(2);
  f.add(99, 'stable', { expiresAt: '2000-01-01' });
  f.releases.push({ id: 999, tag_name: 'v99.0.0', prerelease: false, draft: false });
  let runtime = createRuntime(f.opts);
  runtime.boot();
  const candidate = await runtime.check();
  assert.equal(candidate.m.build, 3);
  let progress;
  await runtime.stage(candidate, (p) => {
    progress = p;
  });
  assert.equal(progress.downloaded, 5);
  assert(progress.reused > 0);
  runtime.activate();
  runtime = createRuntime(f.opts);
  assert.equal(fs.readFileSync(runtime.boot(), 'utf8'), 'patch');
  runtime.healthy();
  assert.equal(await runtime.check(), null);
  runtime.rollback();
  assert.equal(fs.readFileSync(createRuntime(f.opts).boot(), 'utf8'), 'base');
  assert(f.requests.every((r) => r.options.redirect === 'manual'));
});
test('beta/stable isolation and signed metadata, not release body, decide eligibility', async (t) => {
  const f = fixture(t);
  f.add(4, 'beta');
  const runtime = createRuntime(f.opts);
  assert.equal(await runtime.check(undefined, 'stable'), null);
  assert.equal((await runtime.check(undefined, 'beta')).m.build, 4);
  f.add(5, 'stable', { channel: 'beta' });
  await assert.rejects(runtime.check(undefined, 'stable'), /canal/);
});
test('GitHub corruption, missing blobs and signature tampering never activate', async (t) => {
  const f = fixture(t),
    id = f.add(2),
    r = createRuntime(f.opts);
  const candidate = await r.check();
  f.corrupt();
  await assert.rejects(r.stage(candidate, () => {}));
  assert.equal(r.snapshot().ready, false);
  await assert.rejects(r.stage({ ...candidate, assets: [] }, () => {}));
  const manifest = f.assets.get(id)[0],
    body = JSON.parse(f.bodies.get(manifest.id));
  body.signature = 'A'.repeat(88);
  f.bodies.set(manifest.id, JSON.stringify(body));
  await assert.rejects(r.check(), /Firma/);
});
test('GitHub credentials stay on the selected API repository; HTTPS asset redirects are constrained', async () => {
  const calls = [],
    feed = createGitHubFeed({
      repository: '1ly4s0/BattlyRemake',
      token: 'fixture-only',
      fetcher: async (url, options) => {
        calls.push({ url, options });
        return calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://release-assets.githubusercontent.com/fixture' },
            })
          : new Response('blob');
      },
    });
  assert.equal((await feed.asset({ id: 1, size: 4, state: 'uploaded' }, 4)).toString(), 'blob');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-only');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  for (const location of [
    'http://github.com/file',
    'https://evil.example/file',
    'https://user:password@github.com/file',
  ]) {
    const bad = createGitHubFeed({
      repository: '1ly4s0/BattlyRemake',
      fetcher: async () => new Response(null, { status: 302, headers: { location } }),
    });
    await assert.rejects(bad.asset({ id: 1, size: 1, state: 'uploaded' }, 1), /URL/);
  }
});
test('GitHub pagination, unpublished drafts and incompatible platform are respected', async (t) => {
  const f = fixture(t);
  const id = f.add(2);
  f.releases[0].draft = true;
  assert.equal(await createRuntime(f.opts).check(), null);
  f.releases[0].draft = false;
  f.assets.get(id)[0].name = f.assets.get(id)[0].name.replace('win32', 'linux');
  assert.equal(await createRuntime(f.opts).check(), null);
  const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      tag_name: 'v1',
      draft: false,
      prerelease: false,
    })),
    urls = [];
  const feed = createGitHubFeed({
    repository: f.config.githubRepository,
    fetcher: async (url) => {
      urls.push(url);
      return Response.json(new URL(url).searchParams.get('page') === '1' ? rows : []);
    },
  });
  assert.deepEqual(await feed.candidates(f.config, 'stable'), []);
  assert.equal(urls.length, 2);
});
test('GitHub private access failure and cancellation leave local state untouched', async (t) => {
  const f = fixture(t);
  f.add(2);
  const runtime = createRuntime({
    ...f.opts,
    fetcher: async () => new Response('denied', { status: 404 }),
  });
  await assert.rejects(runtime.check(), /404/);
  assert.equal(runtime.snapshot().ready, false);
  const r = createRuntime(f.opts);
  const candidate = await r.check();
  await assert.rejects(r.stage(candidate, () => {}, AbortSignal.abort()));
  assert.equal(r.snapshot().ready, false);
});
