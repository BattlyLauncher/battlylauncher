const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { BattlyDataRootService } = require('../dist/main/settings/battly-data-root-service');

test('migration must not recreate an existing destination parent that rejects mkdir', async () => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'battly-migration-parent-'));
  const source = path.join(root, 'old');
  const config = path.join(root, 'config/data-root.json');
  await fs.mkdir(source);
  await fs.mkdir(path.dirname(config));
  await fs.writeFile(path.join(source, 'options.txt'), 'lang:es_es\n');
  const mkdir = fs.mkdir;
  let attemptedRootCreation = false;
  fs.mkdir = async (directory, ...args) => {
    if (path.resolve(directory) === root) {
      attemptedRootCreation = true;
      throw Object.assign(new Error('EPERM: operation not permitted, mkdir'), { code: 'EPERM' });
    }
    return mkdir(directory, ...args);
  };
  try {
    const destination = path.join(root, 'new');
    const snapshot = await new BattlyDataRootService(config, source).migrate(destination);
    assert.equal(snapshot.currentPath, destination);
    assert.equal(attemptedRootCreation, false);
    assert.equal(await fs.readFile(path.join(destination, 'options.txt'), 'utf8'), 'lang:es_es\n');
  } finally {
    fs.mkdir = mkdir;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test(
  'Windows migrates a verified copy from C: directly into a new folder on D:',
  { skip: process.platform !== 'win32' },
  async (t) => {
    try {
      if (!(await fs.stat('D:\\')).isDirectory()) return t.skip('D: is unavailable');
    } catch {
      return t.skip('D: is unavailable');
    }
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-cross-drive-'));
    const source = path.join(root, 'source');
    const name = `battly-migration-qa-${randomUUID()}`;
    const destination = path.join('D:\\', name);
    const config = path.join(root, 'config/data-root.json');
    const entries = {
      'instances/test/world/level.dat': Buffer.from('isolated migration test world'),
      'instances/test/instance.json': Buffer.from('{"name":"Migration QA"}'),
      'versions/test/test.jar': Buffer.from('isolated test version'),
      'options.txt': Buffer.from('lang:es_es\n'),
    };
    try {
      await assert.rejects(fs.lstat(destination), { code: 'ENOENT' });
      for (const [name, data] of Object.entries(entries)) {
        await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
        await fs.writeFile(path.join(source, name), data);
      }
      const snapshot = await new BattlyDataRootService(config, source).migrate(destination);
      assert.equal(snapshot.currentPath, destination);
      for (const [name, data] of Object.entries(entries)) {
        const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
        assert.equal(digest(await fs.readFile(path.join(source, name))), digest(data));
        assert.equal(digest(await fs.readFile(path.join(destination, name))), digest(data));
      }
      assert.equal(
        (await new BattlyDataRootService(config, source).snapshot()).currentPath,
        destination,
      );
    } finally {
      assert.equal(path.resolve(destination), path.join('D:\\', name));
      assert.match(name, /^battly-migration-qa-[a-f0-9-]+$/);
      await fs.rm(destination, { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
