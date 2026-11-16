const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { BattlyDataRootService } = require('../dist/main/settings/battly-data-root-service');

test('migration inventories 190,000 instance entries without exceeding the argument limit', async () => {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'battly-large-migration-')),
  );
  const source = path.join(root, 'source');
  const instances = path.join(source, 'instances');
  const target = path.join(root, 'target');
  const config = path.join(root, 'config.json');
  await fs.mkdir(instances, { recursive: true });
  const original = { readdir: fs.readdir, lstat: fs.lstat, statfs: fs.statfs };
  let inspected = 0;
  try {
    fs.readdir = async (directory, ...args) =>
      path.resolve(directory) === instances
        ? Array.from({ length: 190000 }, (_, index) => `${index}.dat`)
        : original.readdir(directory, ...args);
    fs.lstat = async (file, ...args) => {
      if (path.dirname(path.resolve(file)) !== instances) return original.lstat(file, ...args);
      inspected++;
      return {
        isSymbolicLink: () => false,
        isDirectory: () => false,
        isFile: () => true,
        size: 1024,
        mtimeMs: 1,
        mode: 0o600,
      };
    };
    // Stop after the real inventory and before any destination writes.
    fs.statfs = async () => ({ bavail: 0, bsize: 4096 });
    await assert.rejects(
      new BattlyDataRootService(config, source).migrate(target),
      /Insufficient free disk space/,
    );
    assert.equal(inspected, 190000);
    await assert.rejects(original.lstat(target), { code: 'ENOENT' });
    await assert.rejects(original.lstat(`${config}.migration.json`), { code: 'ENOENT' });
  } finally {
    Object.assign(fs, original);
    await fs.rm(root, { recursive: true, force: true });
  }
});
