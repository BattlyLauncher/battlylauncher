const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { InstanceStore } = require('../dist/main/minecraft/instance-store');
const { InstanceContentService } = require('../dist/main/minecraft/instance-content-service');
const { buildInstanceLaunchOptions } = require('../dist/main/minecraft/instance-launch-profile');

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

test('an empty migrated copy does not shadow the matching instance with worlds', async (t) => {
  const f = await fixture(t);
  const current = path.join(f.current, 'old123');
  await fs.mkdir(path.join(current, 'saves'), { recursive: true });
  const metadataPath = path.join(current, 'instance.json');
  const migrated = JSON.stringify({ ...legacy, description: 'Migrated' });
  await fs.writeFile(metadataPath, migrated);
  assert.equal((await f.store.list())[0].description, legacy.description);
  assert.equal((await f.store.readInternal('old123')).description, legacy.description);
  const instanceDirectory = await f.store.directoryPathInternal('old123');
  assert.equal(instanceDirectory, f.directory);
  const launch = buildInstanceLaunchOptions({
    account: { type: 'offline', uuid: '123456781234123412341234567890ab', name: 'QA' },
    config: {
      gameArguments: [],
      raw: {
        libraries: {
          package_mimbpyzw_s52o: {
            version: 'qa',
            sha256: 'a'.repeat(64),
            url: 'https://cdn.battlylauncher.com/qa.zip',
          },
        },
      },
    },
    instanceDirectory,
    instanceId: 'old123',
    instanceMetadata: await f.store.readInternal('old123'),
    profileValues: {},
  });
  assert.equal(
    await fs.readFile(path.join(launch.gameDirectory, 'saves', 'World', 'level.dat'), 'utf8'),
    'original-world',
  );
  assert.equal(await fs.readFile(metadataPath, 'utf8'), migrated);
  const world = path.join(current, 'saves', 'New World');
  await fs.mkdir(world);
  await fs.writeFile(path.join(world, 'level.dat'), 'new world');
  assert.equal(await f.store.directoryPathInternal('old123'), current);
  assert.equal((await f.store.list())[0].description, 'Migrated');
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

test('named encrypted instance folders remain visible without renaming or rewriting their files', async (t) => {
  const f = await fixture(t);
  const name = 'pimp. og server';
  const directory = path.join(f.previous, name);
  await fs.rename(f.directory, directory);
  const {
    configureProtectedData,
    registerPrivateMetadataRoot,
    encodePrivateData,
    isEncryptedData,
  } = require('../dist/main/storage/protected-data');
  configureProtectedData(Buffer.alloc(32, 23), () => false);
  registerPrivateMetadataRoot(f.previous, ['instance.json']);
  const metadata = { ...legacy, name };
  const file = path.join(directory, 'instance.json');
  await fs.writeFile(file, encodePrivateData(file, JSON.stringify(metadata)));
  const before = await fs.readFile(file);
  assert(isEncryptedData(before));
  const rows = await f.store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, name);
  assert.match(rows[0].id, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
  assert.notEqual(rows[0].id, name);
  const reopened = new InstanceStore(
    f.current,
    path.join(f.root, 'archive'),
    undefined,
    undefined,
    [f.previous],
  );
  assert.equal(await reopened.directoryPathInternal(rows[0].id), directory);
  assert.equal((await reopened.readInternal(rows[0].id)).version, metadata.version);
  assert.equal(
    (await new InstanceContentService(reopened).list(rows[0].id, 'mods'))[0].name,
    'original.jar',
  );
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal(
    await fs.readFile(path.join(directory, 'saves/World/level.dat'), 'utf8'),
    'original-world',
  );
  await reopened.update(rows[0].id, { ...metadata, name: 'Renamed display name' });
  assert.equal((await reopened.list())[0].id, rows[0].id);
  assert.equal((await reopened.readInternal(rows[0].id)).extraLegacyValue, 'preserve');
  assert(isEncryptedData(await fs.readFile(file)));
  const archive = await reopened.archive(rows[0].id);
  assert.equal(await fs.readFile(path.join(archive, 'mods/original.jar'), 'utf8'), 'original-mod');
  assert.equal(
    await fs.readFile(path.join(archive, 'saves/World/level.dat'), 'utf8'),
    'original-world',
  );
  assert.deepEqual(await reopened.list(), []);
});
test('legacy folder identifiers survive data-root relocation and support Unicode names', async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.current, 'Mi mundo 日本 1.20.1');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'instance.json'),
    JSON.stringify({ ...legacy, name: 'Mi mundo 日本' }),
  );
  const isolated = new InstanceStore(f.current, path.join(f.root, 'archive'));
  const first = (await isolated.list())[0];
  assert(first);
  const next = path.join(f.root, 'moved', 'instances');
  await fs.mkdir(path.dirname(next), { recursive: true });
  await fs.rename(f.current, next);
  const relocated = new InstanceStore(next, path.join(f.root, 'archive'));
  assert.equal((await relocated.list())[0].id, first.id);
  assert.equal(
    await relocated.directoryPathInternal(first.id),
    path.join(next, 'Mi mundo 日本 1.20.1'),
  );
});
test('invalid current metadata does not hide a valid legacy instance with the same folder name', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.current, 'old123'), { recursive: true });
  await fs.writeFile(path.join(f.current, 'old123/instance.json'), 'interrupted write');
  assert.equal((await f.store.list()).length, 1);
  assert.equal(await f.store.directoryPathInternal('old123'), f.directory);
  assert.equal((await f.store.readInternal('old123')).name, legacy.name);
  assert.equal(
    await fs.readFile(path.join(f.current, 'old123/instance.json'), 'utf8'),
    'interrupted write',
  );
});
test('staging directories and symlinks are excluded even when they contain valid metadata', async (t) => {
  const f = await fixture(t);
  const stage = path.join(f.current, '.creating-pending');
  await fs.mkdir(stage, { recursive: true });
  await fs.writeFile(path.join(stage, 'instance.json'), JSON.stringify(legacy));
  await fs.symlink(
    f.directory,
    path.join(f.current, 'Linked world'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  assert.deepEqual(
    (await f.store.list()).map((x) => x.id),
    ['old123'],
  );
  await assert.rejects(f.store.directoryPathInternal('../old123'), /Invalid instance id/);
});
test('a decryption failure is reported instead of claiming the instance folder is empty', async (t) => {
  const f = await fixture(t);
  const {
    configureProtectedData,
    registerPrivateMetadataRoot,
    encodePrivateData,
  } = require('../dist/main/storage/protected-data');
  configureProtectedData(Buffer.alloc(32, 42), () => false);
  registerPrivateMetadataRoot(f.previous, ['instance.json']);
  const file = path.join(f.directory, 'instance.json');
  const bytes = encodePrivateData(file, JSON.stringify(legacy));
  await fs.writeFile(file, bytes);
  configureProtectedData(Buffer.alloc(32, 43), () => false);
  await assert.rejects(f.store.list(), (error) => error.code === 'BATTLY_PRIVATE_DATA_UNREADABLE');
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('encrypted named folders in the selected root are discovered with the same protected-data policy', async (t) => {
  const f = await fixture(t);
  const {
    configureProtectedData,
    registerPrivateMetadataRoot,
    encodePrivateData,
  } = require('../dist/main/storage/protected-data');
  configureProtectedData(Buffer.alloc(32, 18), () => false);
  registerPrivateMetadataRoot(f.current, ['instance.json']);
  const folder = path.join(f.current, 'pimp. og server');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'instance.json');
  const bytes = encodePrivateData(
    file,
    JSON.stringify({ ...legacy, name: 'Current encrypted pack' }),
  );
  await fs.writeFile(file, bytes);
  const row = (await f.store.list()).find((x) => x.name === 'Current encrypted pack');
  assert(row);
  assert.equal(await f.store.directoryPathInternal(row.id), folder);
  assert.deepEqual(await fs.readFile(file), bytes);
});
test('generated legacy identifiers cannot shadow real directory IDs or be reused by creation', async (t) => {
  const f = await fixture(t);
  const folder = path.join(f.previous, 'Named. pack');
  await fs.rename(f.directory, folder);
  const first = (await f.store.list())[0];
  assert(first);
  const factory = new InstanceStore(
    f.current,
    path.join(f.root, 'archive'),
    () => first.id,
    undefined,
    [f.previous],
  );
  await assert.rejects(factory.create(legacy), /already exists/);
  const modern = path.join(f.current, first.id);
  await fs.mkdir(modern, { recursive: true });
  await fs.writeFile(
    path.join(modern, 'instance.json'),
    JSON.stringify({ ...legacy, name: 'Modern instance' }),
  );
  const rows = await f.store.list();
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((x) => x.id)).size, 2);
  const historical = rows.find((x) => x.name === legacy.name);
  assert(historical);
  assert.equal(await f.store.directoryPathInternal(historical.id), folder);
  assert.equal(await f.store.directoryPathInternal(first.id), modern);
});
