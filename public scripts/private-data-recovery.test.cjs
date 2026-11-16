const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  configureProtectedData,
  privateDataPolicy,
  encodePrivateData,
  decodePrivateData,
  PrivateDataDecryptionError,
} = require('../dist/main/storage/protected-data');
const {
  restorePrivateFile,
  resetPrivateFile,
  recoverDisposablePrivateFile,
  canResetPrivateFile,
} = require('../dist/main/storage/private-data-recovery');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-private-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'battly-data.json');
  configureProtectedData(Buffer.alloc(32, 7), privateDataPolicy(root, [file]));
  const original = encodePrivateData(file, '{"accounts":[],"lang":"es"}');
  const bad = Buffer.from(original);
  bad[bad.length - 8] = bad[bad.length - 8] === 65 ? 66 : 65;
  await fs.writeFile(file, bad);
  return { root, file, original, bad, error: new PrivateDataDecryptionError(file) };
}

test('decrypt failures identify their file and CRLF record boundaries remain readable', async (t) => {
  const f = await fixture(t);
  assert.throws(
    () => decodePrivateData(f.file, f.bad),
    (error) => error instanceof PrivateDataDecryptionError && error.filePath === f.file,
  );
  const joined = Buffer.concat([f.original, f.original]).toString().replaceAll('\n', '\r\n');
  assert.equal(
    decodePrivateData(f.file, Buffer.from(joined)).toString(),
    '{"accounts":[],"lang":"es"}{"accounts":[],"lang":"es"}',
  );
});

test('a verified previous copy restores only its file and preserves unreadable bytes', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.file + '.previous', f.original);
  assert.equal(await restorePrivateFile(f.root, f.error), true);
  assert.deepEqual(JSON.parse(decodePrivateData(f.file, await fs.readFile(f.file))), {
    accounts: [],
    lang: 'es',
  });
  const backups = await fs.readdir(path.join(f.root, 'private-recovery'));
  assert.equal(backups.length, 1);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'private-recovery', backups[0])), f.bad);
});

test('missing, corrupted and plaintext previous copies never replace the affected file', async (t) => {
  const f = await fixture(t);
  for (const previous of [undefined, f.bad, Buffer.from('{"accounts":[]}')]) {
    if (previous) await fs.writeFile(f.file + '.previous', previous);
    assert.equal(await restorePrivateFile(f.root, f.error), false);
    assert.deepEqual(await fs.readFile(f.file), f.bad);
  }
});

test('only explicit profile repair resets account settings; game content and keys stay untouched', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.root, 'private-storage.key'), 'protected-key');
  await fs.mkdir(path.join(f.root, 'content'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'content/level.dat'), 'world');
  assert.equal(await recoverDisposablePrivateFile(f.root, f.error), false);
  const directory = await resetPrivateFile(f.root, f.error);
  assert.deepEqual(
    await fs.readFile(path.join(directory, (await fs.readdir(directory))[0])),
    f.bad,
  );
  await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
  assert.equal(
    await fs.readFile(path.join(f.root, 'private-storage.key'), 'utf8'),
    'protected-key',
  );
  assert.equal(await fs.readFile(path.join(f.root, 'content/level.dat'), 'utf8'), 'world');
  for (const file of [
    path.join(f.root, 'private-storage.key'),
    path.join(f.root, 'instances/id/instance.json'),
    path.join(f.root, '../other-profile.json'),
  ]) {
    const error = new PrivateDataDecryptionError(file);
    assert.equal(canResetPrivateFile(f.root, error), false);
    await assert.rejects(resetPrivateFile(f.root, error));
  }
});

test('damaged notification history is retained without touching the healthy profile', async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, 'notifications.json');
  await fs.writeFile(file, f.bad);
  assert.equal(
    await recoverDisposablePrivateFile(f.root, new PrivateDataDecryptionError(file)),
    true,
  );
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(f.file), f.bad);
});

test('recovery refuses a linked backup directory', async (t) => {
  const f = await fixture(t);
  const other = path.join(f.root, 'other');
  await fs.mkdir(other);
  await fs.symlink(
    other,
    path.join(f.root, 'private-recovery'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(resetPrivateFile(f.root, f.error), /recovery directory/);
  assert.deepEqual(await fs.readFile(f.file), f.bad);
  assert.deepEqual(await fs.readdir(other), []);
});
