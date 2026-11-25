const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialVersionMetadata } = require('../dist/main/minecraft/official-version-metadata');

const version = '26.3';
const initial = JSON.stringify({
  id: version,
  libraries: [{ name: 'org.lwjgl:lwjgl-freetype:3.4.3' }],
});
const patched = JSON.stringify({
  id: version,
  libraries: [{ name: 'org.lwjgl:lwjgl-freetype:3.4.3-mojang-2.15.0' }],
});

function officialEntry(body) {
  const sha1 = createHash('sha1').update(body).digest('hex');
  return {
    id: version,
    sha1,
    url: `https://piston-meta.mojang.com/v1/packages/${sha1}/${version}.json`,
  };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-version-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadata = path.join(root, 'versions', version, `${version}.json`);
  await fs.mkdir(path.dirname(metadata), { recursive: true });
  await fs.writeFile(metadata, initial);
  return { root, metadata };
}

test('every online launch checks Mojang and replaces outdated metadata for the same version', async (t) => {
  const { root, metadata } = await fixture(t);
  const custom = path.join(root, 'versions', '26.3-custom', '26.3-custom.json');
  const customProfile = JSON.stringify({ id: '26.3-custom', inheritsFrom: version, libraries: [] });
  await fs.mkdir(path.dirname(custom), { recursive: true });
  await fs.writeFile(custom, customProfile);
  let advertised = initial;
  let checks = 0;
  let downloads = 0;
  const service = new OfficialVersionMetadata(async (url, options) => {
    assert.equal(options.cache, 'no-store');
    const entry = officialEntry(advertised);
    if (url.endsWith('version_manifest_v2.json')) {
      checks++;
      return Response.json({ versions: [entry] });
    }
    assert.equal(url, entry.url);
    downloads++;
    return new Response(advertised);
  });

  assert.equal(await service.refresh(root, version), false);
  advertised = patched;
  assert.deepEqual(
    await Promise.all([service.refresh(root, version), service.refresh(root, version)]),
    [true, true],
  );
  assert.equal(await service.refresh(root, version), false);
  assert.equal(await service.refresh(root, '26.3-custom'), false);
  assert.equal(checks, 4);
  assert.equal(downloads, 1);
  assert.equal(await fs.readFile(metadata, 'utf8'), patched);
  assert.equal(await fs.readFile(custom, 'utf8'), customProfile);
});

test('an unavailable manifest leaves a working offline cache intact', async (t) => {
  const { root, metadata } = await fixture(t);
  const service = new OfficialVersionMetadata(async () => {
    throw new TypeError('fetch failed');
  });
  assert.equal(await service.refresh(root, version), false);
  assert.equal(await fs.readFile(metadata, 'utf8'), initial);
});

test('a known update with a bad hash fails without replacing the local metadata', async (t) => {
  const { root, metadata } = await fixture(t);
  const service = new OfficialVersionMetadata(async (url) =>
    url.endsWith('version_manifest_v2.json')
      ? Response.json({ versions: [officialEntry(patched)] })
      : new Response(initial),
  );
  await assert.rejects(service.refresh(root, version), /integrity verification/);
  assert.equal(await fs.readFile(metadata, 'utf8'), initial);
});
