const test = require('node:test'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { mirrorRelease, CDN } = require('./mirror-patch-release.cjs');
function fixture(status = 200) {
  const body = Buffer.from('signed patch data'),
    hash = crypto.createHash('sha256').update(body).digest('hex');
  const names = [`${hash}.blob`, `patch-${'a'.repeat(64)}-stable-win32-x64.json`];
  const assets = names.map((name, i) => ({
    id: i + 10,
    name,
    size: body.length,
    digest: `sha256:${hash}`,
    state: 'uploaded',
    browser_download_url: `https://github.com/BattlyLauncher/battlylauncher/releases/download/battly-patch-3.1.0-patch6/${name}`,
  }));
  const writes = [];
  const fetcher = async (url, options) => {
    if (url.startsWith(CDN)) {
      assert.equal(options.headers, undefined);
      return new Response(null, { status: 404 });
    }
    if (url.startsWith('https://api.github.com/')) {
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      if (url.includes('/assets?')) return Response.json(assets);
      return Response.json({
        id: 5,
        tag_name: 'battly-patch-3.1.0-patch6',
        draft: false,
        prerelease: true,
      });
    }
    assert.equal(options.headers, undefined);
    return new Response(body, { status });
  };
  return {
    assets,
    writes,
    options: {
      token: 'fixture',
      fetcher,
      put: async (key, bytes, options) => writes.push({ key, bytes, options }),
    },
  };
}
test('mirror publishes verified files first and discovery last, without leaking API credentials', async () => {
  const f = fixture();
  const result = await mirrorRelease('battly-patch-3.1.0-patch6', f.options);
  assert.equal(result.assets, 2);
  assert.match(f.writes[0].key, /blobs\//);
  assert.match(f.writes.at(-1).key, /releases-1.json$/);
  assert.equal(JSON.parse(f.writes.at(-1).bytes)[0].id, 5);
  assert.equal(f.writes[0].options.CacheControl, 'public, max-age=31536000, immutable');
});
test('corrupt files never publish a discovery index', async () => {
  const f = fixture();
  f.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(mirrorRelease('battly-patch-3.1.0-patch6', f.options), /integrity/);
  assert(f.writes.every((w) => !w.key.includes('/releases-')));
});
test('a failed upload leaves the previous discovery index intact', async () => {
  const f = fixture();
  f.options.put = async () => {
    throw Error('storage unavailable');
  };
  await assert.rejects(mirrorRelease('battly-patch-3.1.0-patch6', f.options), /storage/);
  assert.equal(f.writes.length, 0);
});
test('draft and arbitrary asset URLs cannot be mirrored', async () => {
  const f = fixture();
  f.assets[0].browser_download_url = 'https://evil.example/file';
  await assert.rejects(mirrorRelease('battly-patch-3.1.0-patch6', f.options), /URL/);
  await assert.rejects(mirrorRelease('v3.1.0', f.options), /tag/);
});

test('real release baseline descriptors are included without being mistaken for signed manifests', async () => {
  const f = fixture();
  const extra = { ...f.assets[1], id: 12, name: 'patch-base-win32-x64.json' };
  extra.browser_download_url = extra.browser_download_url.replace(f.assets[1].name, extra.name);
  f.assets.push(extra);
  const result = await mirrorRelease('battly-patch-3.1.0-patch6', f.options);
  assert.equal(result.assets, 3);
  assert(f.writes.some((w) => w.key.endsWith('/manifests/12.json')));
  assert.equal(JSON.parse(f.writes.at(-1).bytes)[0].assets.length, 2);
});
