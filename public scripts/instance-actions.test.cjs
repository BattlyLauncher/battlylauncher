const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { test } = require('node:test');
const AdmZip = require('adm-zip');
const { BypackService } = require('../dist/main/minecraft/bypack-service');
const { InstanceStore } = require('../dist/main/minecraft/instance-store');
const { MrpackInstaller } = require('../dist/main/mods/mrpack-installer');

async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'battly-instance-actions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const instances = join(root, 'instances');
  const store = new InstanceStore(instances, join(root, 'archive'));
  const instance = await store.create({
    name: 'Example',
    version: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.10',
  });
  const folder = await store.directoryPathInternal(instance.id);
  for (const [file, data] of Object.entries({
    'config/custom.txt': 'options=true',
    'config/.env': 'private',
    'saves/Example/level.dat': 'original world',
    'saves/Example/session.lock': 'transient',
    'screenshots/screenshot.png': 'image',
    'servers.dat': 'private server list',
  })) {
    const path = join(folder, file);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, data);
  }
  return { root, instances, store, instance, folder };
}

test('duplicates selected content into a separate instance and discards a failed copy', async (t) => {
  const { root, store, instance, folder } = await fixture(t);
  const metadata = await fs.readFile(join(folder, 'instance.json'));
  const copy = await store.duplicate(instance.id, { name: 'Copy', parts: ['worlds'] }, () => {});
  assert.notEqual(copy.id, instance.id);
  assert.equal(copy.loaderVersion, instance.loaderVersion);
  const copyFolder = await store.directoryPathInternal(copy.id);
  assert.deepEqual((await fs.readdir(copyFolder)).sort(), ['instance.json', 'saves']);
  assert.deepEqual(await fs.readdir(join(copyFolder, 'saves/Example')), ['level.dat']);
  await fs.writeFile(join(copyFolder, 'saves/Example/level.dat'), 'edited copy');
  assert.equal(
    await fs.readFile(join(folder, 'saves/Example/level.dat'), 'utf8'),
    'original world',
  );
  assert.deepEqual(await fs.readFile(join(folder, 'instance.json')), metadata);

  await fs.symlink(
    root,
    join(folder, 'saves/link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    store.duplicate(instance.id, { name: 'Rejected', parts: ['worlds'] }, () => {}),
    /enlace/,
  );
  assert.deepEqual((await fs.readdir(dirname(folder))).sort(), [instance.id, copy.id].sort());
});

test('exports and reimports a .mrpack, preserving portable content and dependencies', async (t) => {
  const { root, instances, store, instance, folder } = await fixture(t);
  const exporter = new BypackService(store, instances);
  const archive = join(root, 'example.mrpack');
  await exporter.exportMrpack(instance.id, archive);
  const zip = new AdmZip(archive);
  assert.deepEqual(
    zip
      .getEntries()
      .map((entry) => entry.entryName)
      .sort(),
    ['modrinth.index.json', 'overrides/config/custom.txt'],
  );
  const importedRoot = join(root, 'imported');
  const imported = await new MrpackInstaller(importedRoot, () => 'testpack').install(archive);
  assert.equal(imported.version, instance.version);
  assert.equal(imported.loader, instance.loader);
  assert.equal(imported.loaderVersion, instance.loaderVersion);
  assert.equal(
    await fs.readFile(join(importedRoot, imported.id, 'config/custom.txt'), 'utf8'),
    'options=true',
  );
  await assert.rejects(exporter.exportMrpack(instance.id, join(folder, 'inside.mrpack')), /fuera/);
  const bypack = join(root, 'example.bypack');
  await exporter.export(instance.id, bypack);
  assert.equal((await exporter.inspect(bypack)).instance.name, instance.name);
});
