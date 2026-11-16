const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { InstanceStore } = require('../dist/main/minecraft/instance-store');
const { InstanceContentService } = require('../dist/main/minecraft/instance-content-service');

const legacy = {
  id: 'old123',
  name: 'Legacy Forge',
  description: 'Original',
  version: '1.20.1-forge',
  loader: 'forge',
  loaderVersion: '47.2.18',
  image: 'old/icon.png',
  extraLegacyValue: 'preserve',
};

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-legacy-instances-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, 'custom', 'instances');
  const previous = path.join(root, 'original', 'instances');
  const directory = path.join(previous, 'old123');
  await fs.mkdir(path.join(directory, 'mods'), { recursive: true });
  await fs.mkdir(path.join(directory, 'saves', 'World'), { recursive: true });
  await fs.writeFile(path.join(directory, 'instance.json'), JSON.stringify(legacy));
  await fs.writeFile(path.join(directory, 'mods', 'original.jar'), 'original-mod');
  await fs.writeFile(path.join(directory, 'saves', 'World', 'level.dat'), 'original-world');
  const store = new InstanceStore(current, path.join(root, 'archive'), undefined, undefined, [
    previous,
  ]);
  return { root, current, previous, directory, store };
}

test('3.0.1 instances remain visible and usable after the configured data root changes', async (t) => {
  const f = await fixture(t);
  const before = await fs.readFile(path.join(f.directory, 'instance.json'));
  const summaries = await f.store.list();
  assert.deepEqual(
    summaries.map((item) => item.id),
    ['old123'],
  );
  assert.equal(summaries[0].loaderVersion, '47.2.18');
  assert.equal(await f.store.directoryPathInternal('old123'), f.directory);
  assert.deepEqual(await f.store.readInternal('old123'), legacy);
  const mods = await new InstanceContentService(f.store).list('old123', 'mods');
  assert.equal(mods[0].name, 'original.jar');
  assert.deepEqual(await fs.readFile(path.join(f.directory, 'instance.json')), before);
  assert.equal(
    await fs.readFile(path.join(f.directory, 'saves/World/level.dat'), 'utf8'),
    'original-world',
  );
  assert.equal((await fs.readdir(f.current)).length, 0);
  const edited = { ...legacy, name: 'Updated name' };
  await f.store.update('old123', edited);
  assert.equal((await f.store.readInternal('old123')).extraLegacyValue, 'preserve');
  assert.equal((await f.store.list())[0].name, 'Updated name');
});

test('current instances take priority; creation cannot overwrite a legacy ID', async (t) => {
  const f = await fixture(t);
  const current = path.join(f.current, 'old123');
  await fs.mkdir(current, { recursive: true });
  await fs.writeFile(
    path.join(current, 'instance.json'),
    JSON.stringify({ ...legacy, name: 'Current' }),
  );
  assert.deepEqual(
    (await f.store.list()).map((item) => item.name),
    ['Current'],
  );
  assert.equal(await f.store.directoryPathInternal('old123'), current);
  const conflicting = new InstanceStore(
    f.current,
    path.join(f.root, 'archive'),
    () => 'old123',
    undefined,
    [f.previous],
  );
  await assert.rejects(conflicting.create(legacy), /already exists/);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(f.directory, 'instance.json'))).name,
    legacy.name,
  );
});

test('missing legacy roots and explicit isolated stores do not import unrelated instances', async (t) => {
  const f = await fixture(t);
  const isolated = new InstanceStore(f.current, path.join(f.root, 'archive'));
  assert.deepEqual(await isolated.list(), []);
  const missing = new InstanceStore(f.current, path.join(f.root, 'archive'), undefined, undefined, [
    path.join(f.root, 'missing'),
  ]);
  assert.deepEqual(await missing.list(), []);
  await assert.rejects(f.store.directoryPathInternal('../old123'), /Invalid instance id/);
});
