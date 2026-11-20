const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const AdmZip = require('adm-zip');
const { MrpackInstaller } = require('../dist/main/mods/mrpack-installer');
const { VerifiedDownloader } = require('../dist/main/mods/verified-download');

const mib = 1024 ** 2;
const fileSize = 400 * mib;
const override = Buffer.from('example=true');

async function fixture(t, availableBytes) {
  const root = await fs.mkdtemp(join(tmpdir(), 'battly-mrpack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.mock.method(fs, 'statfs', async () => ({ bavail: BigInt(availableBytes), bsize: 1n }));
  const archivePath = join(root, 'large.mrpack');
  const instancesRoot = join(root, 'instances');
  const files = [1, 2, 3].map((index) => ({
    path: `mods/mod-${index}.jar`,
    downloads: [`https://cdn.modrinth.com/mod-${index}.jar`],
    fileSize,
    hashes: { sha512: 'a'.repeat(128) },
  }));
  const zip = new AdmZip();
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(
      JSON.stringify({
        game: 'minecraft',
        formatVersion: 1,
        name: 'Large pack',
        dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.9' },
        files,
      }),
    ),
  );
  zip.addFile('overrides/config/example.txt', override);
  zip.writeZip(archivePath);
  return {
    archivePath,
    instancesRoot,
    installer: new MrpackInstaller(instancesRoot, () => 'large'),
  };
}

test('installs a modpack with over 1 GiB of external files when the destination has space', async (t) => {
  const { archivePath, instancesRoot, installer } = await fixture(
    t,
    3 * fileSize + override.length,
  );
  const download = t.mock.method(
    VerifiedDownloader.prototype,
    'download',
    async (descriptor, _destination, _signal, progress) => {
      assert.equal(descriptor.expectedSize, fileSize);
      assert.equal(descriptor.expectedSha512, 'a'.repeat(128));
      progress(fileSize, fileSize);
    },
  );
  const progress = [];
  const instance = await installer.install(archivePath, undefined, (event) => progress.push(event));
  assert.equal(instance.id, 'large');
  assert.equal(download.mock.callCount(), 3);
  assert.equal(
    progress.findLast((event) => event.phase === 'downloading-files').current,
    3 * fileSize,
  );
  assert.deepEqual(await fs.readFile(join(instancesRoot, 'large/config/example.txt')), override);
});

test('includes archive overrides in the disk check before downloading files', async (t) => {
  const { archivePath, instancesRoot, installer } = await fixture(t, 3 * fileSize);
  const download = t.mock.method(VerifiedDownloader.prototype, 'download', async () => {});
  await assert.rejects(installer.install(archivePath), /No queda espacio suficiente/);
  assert.equal(download.mock.callCount(), 0);
  assert.deepEqual(await fs.readdir(instancesRoot), []);
});

test('cleans up without retrying when the drive fills during download', async (t) => {
  const { archivePath, instancesRoot, installer } = await fixture(t, 2 * 1024 * mib);
  const download = t.mock.method(VerifiedDownloader.prototype, 'download', async () => {
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  });
  await assert.rejects(installer.install(archivePath), /No queda espacio suficiente/);
  assert.equal(download.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(instancesRoot), []);
});
