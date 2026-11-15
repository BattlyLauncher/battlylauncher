const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { releaseConfig, publicationWindow } = require('./patch-release-config.cjs');
const { publicationPlan, publish, targets } = require('./publish-battly-update.cjs');
test('the launch date opens at midnight Madrid and rejects dates without a timezone', () => {
  const start = '2026-11-15T00:00:00+01:00';
  assert.equal(publicationWindow(start, Date.parse('2026-11-14T22:59:59Z')), false);
  assert.equal(publicationWindow(start, Date.parse('2026-11-14T23:00:00Z')), true);
  assert.equal(publicationWindow('', 0), true);
  assert.throws(() => publicationWindow('2026-11-15'));
  assert.throws(() => publicationWindow('2026-13-15T00:00:00Z'));
});
test('a held release skips before querying GitHub or creating anything', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-launch-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'outputs');
  require('node:child_process').execFileSync(
    process.execPath,
    ['public scripts/patch-release-config.cjs'],
    {
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GH_TOKEN: 'fixture-must-not-be-used',
        BATTLY_CI_DRY_RUN: 'false',
        BATTLY_RELEASE_NOT_BEFORE: '2099-11-15T00:00:00+01:00',
      },
      timeout: 5000,
    },
  );
  assert(fs.readFileSync(output, 'utf8').includes('skip=true'));
});
test('the publisher also refuses every network operation before the launch date', async () => {
  let calls = 0;
  await assert.rejects(
    publish(
      {},
      {
        token: 'fixture-only',
        sha: 'a'.repeat(40),
        notBefore: '2026-11-15T00:00:00+01:00',
        now: Date.parse('2026-11-14T22:59:59Z'),
        fetcher: async () => {
          calls++;
          throw Error('Must not contact GitHub');
        },
      },
    ),
    /launch date/,
  );
  assert.equal(calls, 0);
});
const pkg = {
  version: '3.1.0',
  battlyBuild: 1,
  battlyUpdate: {
    type: 'patch',
    channel: 'stable',
    repository: '1ly4s0/BattlyRemake',
    baseTag: 'v3.1.0',
    patchVersion: '3.1.0-patch3',
    build: 3,
  },
};
test('existing published versions are skipped before building; access errors are not treated as missing tags', async () => {
  const { alreadyPublished } = require('./patch-release-config.cjs'),
    value = releaseConfig(pkg);
  assert.equal(
    await alreadyPublished(value, 'fixture', async () => Response.json({ draft: false })),
    true,
  );
  assert.equal(
    await alreadyPublished(value, 'fixture', async () => Response.json({ draft: true })),
    false,
  );
  assert.equal(
    await alreadyPublished(value, 'fixture', async () => new Response(null, { status: 404 })),
    false,
  );
  await assert.rejects(
    alreadyPublished(value, 'fixture', async () => new Response(null, { status: 403 })),
    /403/,
  );
});
test('package metadata generates non-semver isolated patch tags and validates both channels', () => {
  assert.equal(releaseConfig(pkg).tag, 'battly-patch-3.1.0-patch3');
  assert.equal(
    releaseConfig({ ...pkg, battlyUpdate: { ...pkg.battlyUpdate, type: 'full' } }).tag,
    'v3.1.0',
  );
  for (const changes of [
    { channel: 'other' },
    { repository: '../bad' },
    { build: 1 },
    { build: 2 },
    { patchVersion: '3.1.0-beta.8' },
    { baseTag: 'v3.0.0' },
  ])
    assert.throws(() =>
      releaseConfig({ ...pkg, battlyUpdate: { ...pkg.battlyUpdate, ...changes } }),
    );
  assert.throws(() => releaseConfig({ ...pkg, version: '3.1.0-beta.7' }), /prerelease/);
});
function assets(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-publication-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const keys = crypto.generateKeyPairSync('ed25519'),
    publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }),
    hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
  for (const [platform, arch] of targets) {
    const config = {
      schema: 1,
      runtimeId: 'd'.repeat(64),
      version: '3.1.0',
      baseBuild: 1,
      platform,
      arch,
      publicKey,
      githubRepository: pkg.battlyUpdate.repository,
    };
    fs.writeFileSync(path.join(dir, `patch-base-${platform}-${arch}.json`), JSON.stringify(config));
    const files = ['dist/main/index.js', 'dist/preload/index.js', 'dist/renderer/index.html'].map(
      (p) => {
        const bytes = Buffer.from(p);
        fs.writeFileSync(path.join(dir, hash(bytes) + '.blob'), bytes);
        return { path: p, sha256: hash(bytes), size: bytes.length };
      },
    );
    const m = {
        schema: 1,
        type: 'patch',
        baseVersion: '3.1.0',
        patchVersion: '3.1.0-patch3',
        build: 3,
        channel: 'stable',
        runtimeId: config.runtimeId,
        platform,
        arch,
        notes: 'test',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        files,
      },
      bytes = Buffer.from(JSON.stringify(m));
    fs.writeFileSync(
      path.join(dir, `patch-${config.runtimeId}-stable-${platform}-${arch}.json`),
      JSON.stringify({
        payload: bytes.toString('base64'),
        signature: crypto.sign(null, bytes, keys.privateKey).toString('base64'),
      }),
    );
  }
  return dir;
}
test('complete patch publication plan verifies all five target signatures and forbids installer/YAML extras', (t) => {
  const dir = assets(t);
  assert.equal(publicationPlan(pkg, dir).prerelease, true);
  for (const name of [
    'beta.yml',
    'latest-mac.yml',
    'Battly-Launcher-3.1.0-Setup.exe',
    'Battly-Launcher-3.1.0-Setup.exe.blockmap',
  ]) {
    fs.writeFileSync(path.join(dir, name), 'fixture');
    assert.throws(() => publicationPlan(pkg, dir), /Unexpected/);
    fs.unlinkSync(path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'patch-base-linux-x64.json'), '{}');
  assert.throws(() => publicationPlan(pkg, dir), /baseline/);
});
test('publication uploads only to draft, checks hashes, then publishes prerelease; published tags cannot be overwritten', async (t) => {
  const plan = publicationPlan(pkg, assets(t)),
    sha = 'a'.repeat(40),
    calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET' && url.includes('/assets?')) return Response.json([]);
    if (options.method === 'GET') return new Response(null, { status: 404 });
    if (options.method === 'POST' && url.endsWith('/releases')) {
      assert.equal(JSON.parse(options.body).draft, true);
      return Response.json({ id: 11 });
    }
    if (url.includes('uploads.github.com'))
      return Response.json({
        state: 'uploaded',
        digest: 'sha256:' + crypto.createHash('sha256').update(options.body).digest('hex'),
      });
    assert.equal(options.method, 'PATCH');
    const body = JSON.parse(options.body);
    assert.equal(body.draft, false);
    assert.equal(body.prerelease, true);
    assert.equal(body.make_latest, 'false');
    return Response.json({ html_url: 'https://github.com/fixture' });
  };
  await publish(plan, { token: 'fixture-only', sha, fetcher });
  assert.equal(calls.at(-1).options.method, 'PATCH');
  let writes = 0;
  await assert.rejects(
    publish(plan, {
      token: 'fixture-only',
      sha,
      fetcher: async (_u, o) => {
        if (o.method !== 'GET') writes++;
        return Response.json({ draft: false, target_commitish: sha });
      },
    }),
    /already published/,
  );
  assert.equal(writes, 0);
});
test('failed upload never publishes and mismatched existing draft assets cannot be clobbered', async (t) => {
  const plan = publicationPlan(pkg, assets(t)),
    sha = 'b'.repeat(40),
    methods = [];
  await assert.rejects(
    publish(plan, {
      token: 'fixture-only',
      sha,
      fetcher: async (url, o) => {
        methods.push(o.method);
        if (o.method === 'GET' && url.includes('/assets?')) return Response.json([]);
        if (o.method === 'GET')
          return Response.json({ id: 11, draft: true, target_commitish: sha });
        return new Response('failed', { status: 500 });
      },
    }),
    /500/,
  );
  assert(!methods.includes('PATCH'));
  await assert.rejects(
    publish(plan, {
      token: 'fixture-only',
      sha,
      fetcher: async (url) =>
        Response.json(
          url.includes('/assets?')
            ? [{ name: plan.files[0].name, digest: 'wrong', state: 'uploaded' }]
            : { id: 11, draft: true, target_commitish: sha },
        ),
    }),
    /differs/,
  );
});
