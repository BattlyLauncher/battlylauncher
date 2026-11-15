const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRuntime, verifyEnvelope, hash } = require('../bootstrap/patch-runtime.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-patches-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const config = {
    baseBuild: 1,
    runtimeId: 'a'.repeat(64),
    platform: 'win32',
    arch: 'x64',
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    feed: 'https://updates.example.test/patches/',
  };
  const installedRoot = path.join(root, 'installed');
  const original = {
    'dist/main/index.js': 'original main',
    'dist/preload/index.js': 'preload',
    'dist/renderer/index.html': '<html>original</html>',
    'dist/renderer/removed.txt': 'removed',
  };
  for (const [name, bytes] of Object.entries(original)) {
    fs.mkdirSync(path.dirname(path.join(installedRoot, name)), { recursive: true });
    fs.writeFileSync(path.join(installedRoot, name), bytes);
  }
  let files = { ...original };
  delete files['dist/renderer/removed.txt'];
  files['dist/main/index.js'] = 'patched main';
  let envelope;
  const downloads = [];
  const sign = (m) => {
    const bytes = Buffer.from(JSON.stringify(m));
    return {
      payload: bytes.toString('base64'),
      signature: crypto.sign(null, bytes, privateKey).toString('base64'),
    };
  };
  const manifest = (build) => ({
    schema: 1,
    channel: 'stable',
    runtimeId: config.runtimeId,
    platform: config.platform,
    arch: config.arch,
    build,
    notes: 'Fixture',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    files: Object.entries(files).map(([name, data]) => ({
      path: name,
      size: Buffer.byteLength(data),
      sha256: hash(data),
    })),
  });
  envelope = sign(manifest(2));
  let corrupt = false;
  const fetcher = async (url) => {
    if (url.endsWith('.json')) return new Response(JSON.stringify(envelope));
    downloads.push(url);
    const digest = url.split('/').at(-1);
    const bytes = Object.values(files).find((data) => hash(data) === digest);
    return new Response(corrupt ? 'corrupt' : bytes);
  };
  const opts = { config, installedRoot, root: path.join(root, 'updates'), fetcher };
  return {
    config,
    opts,
    sign,
    manifest,
    downloads,
    original,
    setEnvelope: (value) => {
      envelope = value;
    },
    setCorrupt: () => {
      corrupt = true;
    },
    next: () => {
      files['dist/main/index.js'] = 'third main';
      envelope = sign(manifest(3));
    },
  };
}
test('downloads only changed files, omits removed files and boots the verified build', async (t) => {
  const f = fixture(t);
  const runtime = createRuntime(f.opts);
  runtime.boot();
  let progress;
  const candidate = await runtime.check();
  await runtime.stage(candidate, (p) => {
    progress = p;
  });
  assert.equal(f.downloads.length, 1);
  assert(progress.reused > 0);
  assert.equal(progress.percent, 100);
  assert.equal(
    fs.readFileSync(path.join(f.opts.installedRoot, 'dist/main/index.js'), 'utf8'),
    'original main',
  );
  runtime.activate();
  const restarted = createRuntime(f.opts);
  const entry = restarted.boot();
  assert.equal(fs.readFileSync(entry, 'utf8'), 'patched main');
  assert.equal(fs.existsSync(path.join(path.dirname(entry), '../renderer/removed.txt')), false);
  restarted.healthy();
  assert.equal(restarted.snapshot().build, 2);
  assert.equal(await restarted.check(), null);
  restarted.rollback();
  assert.equal(createRuntime(f.opts).boot(), path.join(f.opts.installedRoot, 'dist/main/index.js'));
});
test('an unconfirmed first boot rolls back; a subsequent good build can still be installed', async (t) => {
  const f = fixture(t);
  let runtime = createRuntime(f.opts);
  runtime.boot();
  await runtime.stage(await runtime.check(), () => {});
  runtime.activate();
  runtime = createRuntime(f.opts);
  runtime.boot(); // crash before healthy
  runtime = createRuntime(f.opts);
  assert.equal(runtime.boot(), path.join(f.opts.installedRoot, 'dist/main/index.js'));
  assert.equal(await runtime.check(), null);
  f.next();
  await runtime.stage(await runtime.check(), () => {});
  runtime.activate();
  runtime = createRuntime(f.opts);
  runtime.boot();
  runtime.healthy();
  assert.equal(runtime.snapshot().build, 3);
});
test('corruption and cancellation leave the installed build untouched', async (t) => {
  const f = fixture(t);
  const runtime = createRuntime(f.opts);
  runtime.boot();
  const candidate = await runtime.check();
  await assert.rejects(runtime.stage(candidate, () => {}, AbortSignal.abort()));
  f.setCorrupt();
  await assert.rejects(runtime.stage(candidate, () => {}));
  assert.equal(runtime.snapshot().ready, false);
  assert.equal(createRuntime(f.opts).boot(), path.join(f.opts.installedRoot, 'dist/main/index.js'));
});
test('rejects forged signatures, traversal, case collisions, expired and incompatible manifests', (t) => {
  const f = fixture(t);
  const m = f.manifest(2);
  const envelope = f.sign(m);
  assert.throws(() =>
    verifyEnvelope(
      {
        ...envelope,
        payload: Buffer.from(JSON.stringify({ ...m, build: 100 })).toString('base64'),
      },
      f.config,
    ),
  );
  for (const changes of [
    { runtimeId: 'wrong' },
    { expiresAt: '2000-01-01' },
    { build: 1 },
    { files: [...m.files, { ...m.files[0], path: 'dist/main/../../outside.js' }] },
    { files: [...m.files, { ...m.files[0], path: 'dist/main/INDEX.js' }] },
  ]) {
    assert.throws(() => verifyEnvelope(f.sign({ ...m, ...changes }), f.config));
  }
});
test('local tampering is detected again before startup', async (t) => {
  const f = fixture(t);
  const runtime = createRuntime(f.opts);
  runtime.boot();
  const id = await runtime.stage(await runtime.check(), () => {});
  runtime.activate();
  fs.writeFileSync(path.join(f.opts.root, 'builds', id, 'dist/main/extra.js'), 'untrusted');
  const restarted = createRuntime(f.opts);
  assert.equal(restarted.boot(), path.join(f.opts.installedRoot, 'dist/main/index.js'));
});

test('stable and beta feeds are isolated and a mismatched signed channel is rejected', async (t) => {
  const f = fixture(t);
  const urls = [];
  const runtime = createRuntime({
    ...f.opts,
    fetcher: async (...args) => {
      urls.push(args[0]);
      return f.opts.fetcher(...args);
    },
  });
  assert.equal((await runtime.check()).m.channel, 'stable');
  assert(urls.at(-1).endsWith('/stable-win32-x64.json'));
  await assert.rejects(runtime.check(undefined, 'beta'), /canal/);
  f.setEnvelope(f.sign({ ...f.manifest(3), channel: 'beta' }));
  await assert.rejects(runtime.check(undefined, 'stable'), /canal/);
  const candidate = await runtime.check(undefined, 'beta');
  assert(urls.at(-1).endsWith('/beta-win32-x64.json'));
  await runtime.stage(candidate, () => {});
  runtime.activate();
  const booted = createRuntime(f.opts);
  booted.boot();
  booted.healthy();
  assert.equal(booted.snapshot().build, 3);
  await assert.rejects(runtime.check(undefined, '../arbitrary'), /Canal/);
});

test('an empty configured feed reports no new patch without disabling signature checks', async (t) => {
  const f = fixture(t);
  const runtime = createRuntime({
    ...f.opts,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  assert.equal(await runtime.check(undefined, 'beta'), null);
  assert.equal(runtime.snapshot().enabled, true);
});
