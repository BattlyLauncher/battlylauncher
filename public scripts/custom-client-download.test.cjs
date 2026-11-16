const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Zip = require('adm-zip');
const { CustomClientInstaller } = require('../dist/main/minecraft/custom-client-installer');

const client = {
  id: 'testclient',
  name: 'Test Client',
  folderName: 'Test Client',
  downloadUrl: 'https://example.test/client.zip',
  requiredJavaVersion: null,
};

for (const prefix of ['', 'versions/Test Client/', 'versions/Test Client/Test Client/']) {
  test(`client archive layout ${prefix || 'root'} installs into the version directory`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-client-layout-'));
    try {
      const zip = new Zip();
      zip.addFile(`${prefix}Test Client.json`, Buffer.from('{"id":"Test Client"}'));
      zip.addFile(`${prefix}Test Client.jar`, Buffer.from('client-binary'));
      zip.addFile('libraries/test/library.jar', Buffer.from('shared-library'));
      await new CustomClientInstaller({
        fetchImplementation: async () => new Response(zip.toBuffer()),
      }).install(client, root);
      assert.equal(
        await fs.readFile(path.join(root, 'versions/Test Client/Test Client.jar'), 'utf8'),
        'client-binary',
      );
      assert.equal(
        await fs.readFile(path.join(root, 'libraries/test/library.jar'), 'utf8'),
        'shared-library',
      );
      assert.deepEqual((await fs.readdir(root)).sort(), ['libraries', 'versions']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test('ambiguous version paths fail before replacing installed files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-client-collision-'));
  try {
    await fs.writeFile(path.join(root, 'preserved.txt'), 'keep');
    const zip = new Zip();
    zip.addFile('Test Client.json', Buffer.from('{}'));
    zip.addFile('Test Client.jar', Buffer.from('one'));
    zip.addFile('versions/Test Client/Test Client.jar', Buffer.from('two'));
    await assert.rejects(
      new CustomClientInstaller({
        fetchImplementation: async () => new Response(zip.toBuffer()),
      }).install(client, root),
      /duplicados/,
    );
    assert.deepEqual(await fs.readdir(root), ['preserved.txt']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('missing server archive reports the client and status and removes staging', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-client-missing-'));
  try {
    await assert.rejects(
      new CustomClientInstaller({
        fetchImplementation: async () => new Response('', { status: 404 }),
      }).install(client, root),
      /Test Client.*HTTP 404/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
