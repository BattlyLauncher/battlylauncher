const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { updateConfigPath } = require('../dist/main/updates/update-config');
test('legacy ZIP fallback still pins the Windows signing publisher', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-update-publisher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = updateConfigPath(path.join(root, 'resources'), path.join(root, 'user'));
  const config = require('js-yaml').load(await fs.readFile(file, 'utf8'));
  assert.deepEqual(config.publisherName, [
    require('../package.json').build.win.signtoolOptions.publisherName,
  ]);
});
test('missing bundled updater config uses writable user data and the pinned official provider', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-update-config-'));
  try {
    const resources = path.join(root, 'readonly-resources'),
      user = path.join(root, 'user');
    const result = updateConfigPath(resources, user);
    assert.equal(result, path.join(user, 'app-update-fallback.yml'));
    const text = await fs.readFile(result, 'utf8');
    assert.match(text, /provider: github/);
    assert.match(text, /repo: battlylauncher/);
    await assert.rejects(fs.stat(resources));
    await fs.mkdir(resources);
    await fs.writeFile(path.join(resources, 'app-update.yml'), 'bundled');
    assert.equal(updateConfigPath(resources, user), path.join(resources, 'app-update.yml'));
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
