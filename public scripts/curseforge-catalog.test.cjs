const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { CurseForgeCatalog } = require('../dist/main/mods/curseforge-catalog');

const request = {
  projectId: 'curseforge-123',
  projectType: 'mod',
  gameVersion: '1.20.1',
  loader: 'forge',
  versionId: '100',
};

function fixture(overrides = {}, download = (filename) => new Response(filename)) {
  const files = [
    {
      id: 100,
      modId: 123,
      fileName: 'main.jar',
      dependencies: [{ relationType: 3, modId: 124 }],
      ...overrides,
    },
    { id: 101, modId: 124, fileName: 'dependency.jar' },
  ].map((file) => ({
    gameId: 432,
    gameVersions: ['1.20.1', 'Forge'],
    isAvailable: true,
    fileLength: Buffer.byteLength(file.fileName),
    hashes: [{ algo: 1, value: createHash('sha1').update(file.fileName).digest('hex') }],
    downloadUrl: `https://mediafilez.forgecdn.net/${file.fileName}`,
    ...file,
  }));
  const calls = [];
  const catalog = new CurseForgeCatalog('https://example.test/curseforge/', async (url) => {
    calls.push(url.href);
    const envelope = (data) => Response.json({ success: true, data: { data } });
    if (url.hostname === 'mediafilez.forgecdn.net') {
      return download(url.pathname.slice(1));
    }
    if (url.pathname.endsWith('/mod/123/file/100')) {
      return envelope(files[0]);
    }
    if (url.pathname.endsWith('/mod/124/files')) {
      return envelope([files[1]]);
    }
    const id = Number(url.pathname.split('/').at(-1));
    assert.ok(id === 123 || id === 124);
    return envelope({ id, name: id === 123 ? 'Main' : 'Dependency', gameId: 432, classId: 6 });
  });
  return { catalog, calls };
}

async function directory(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'battly-curseforge-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('searches by loader without requiring a Minecraft version', async () => {
  const catalog = new CurseForgeCatalog('https://example.test/curseforge/', async (url) => {
    assert.equal(url.pathname, '/curseforge/search');
    assert.equal(url.searchParams.get('modLoaderType'), '4');
    assert.equal(url.searchParams.has('gameVersion'), false);
    assert.equal(url.searchParams.has('gameVersions'), false);
    return Response.json({ data: { data: [], pagination: { totalCount: 0 } } });
  });

  await catalog.search({
    query: '',
    sort: 'relevance',
    loader: 'fabric',
    category: null,
    projectType: 'mod',
    gameVersions: [],
    offset: 0,
    limit: 20,
  });
});

test('uses the original CurseForge logo when the thumbnail is missing', async () => {
  const original = 'https://media.forgecdn.net/avatars/1497/387/logo.webp';
  const catalog = new CurseForgeCatalog('https://example.test/curseforge/', async () =>
    Response.json({
      data: {
        data: [{ id: 1360926, name: 'Cobblemon SMP', gameId: 432, classId: 4471, logo: { thumbnailUrl: '', url: original } }],
        pagination: { totalCount: 1 },
      },
    }),
  );
  const result = await catalog.search({
    query: 'Cobblemon SMP',
    sort: 'relevance',
    loader: null,
    category: null,
    projectType: 'modpack',
    gameVersions: [],
    offset: 0,
    limit: 20,
  });
  assert.equal(result.projects[0].iconUrl, original);
});

test('installs the selected CurseForge file and the required dependency', async (t) => {
  const root = await directory(t);
  const { catalog } = fixture();
  assert.deepEqual((await catalog.install(request, root)).installed, [
    'dependency.jar',
    'main.jar',
  ]);
  assert.equal(await fs.readFile(join(root, 'mods/dependency.jar'), 'utf8'), 'dependency.jar');
  assert.equal(await fs.readFile(join(root, 'mods/main.jar'), 'utf8'), 'main.jar');
});

test('rejects a corrupted archive without modifying the installed mods', async (t) => {
  const root = await directory(t);
  await fs.mkdir(join(root, 'mods'));
  await fs.writeFile(join(root, 'mods/main.jar'), 'old');
  const { catalog } = fixture({}, (name) => new Response(name === 'main.jar' ? 'invalid!' : name));
  await assert.rejects(catalog.install(request, root), /hash mismatch/);
  assert.deepEqual(await fs.readdir(join(root, 'mods')), ['main.jar']);
  assert.equal(await fs.readFile(join(root, 'mods/main.jar'), 'utf8'), 'old');
  assert.ok((await fs.readdir(root)).every((name) => !name.startsWith('.battly-curseforge-')));
});

test('does not download restricted files or versions for a different loader', async (t) => {
  const root = await directory(t);
  for (const [overrides, message] of [
    [{ downloadUrl: null }, /restringe/],
    [{ gameVersions: ['1.20.1', 'Fabric'] }, /compatible/],
  ]) {
    const { catalog, calls } = fixture(overrides);
    await assert.rejects(catalog.install(request, root), message);
    assert.ok(calls.every((url) => new URL(url).hostname === 'example.test'));
  }
  assert.deepEqual(await fs.readdir(root), []);
});
