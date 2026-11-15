const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { verify } = require('./verify-windows-updater.cjs');
test('release updater rejects missing, corrupt and unsigned installers', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-updater-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await assert.rejects(verify(root, '3.1.0', 'publisher'), /Missing/);
  const bytes = Buffer.from('fixture'),
    name = 'Battly-Launcher-win.exe';
  await fs.writeFile(path.join(root, name), bytes);
  await fs.writeFile(path.join(root, name + '.blockmap'), 'fixture');
  await fs.writeFile(path.join(root, 'Battly-Launcher-win-ia32.exe'), bytes);
  await fs.writeFile(path.join(root, 'Battly-Launcher-win-ia32.exe.blockmap'), 'fixture');
  await fs.writeFile(
    path.join(root, 'latest.yml'),
    yaml.dump({
      version: '3.1.0',
      files: [name, 'Battly-Launcher-win-ia32.exe'].map((url) => ({
        url,
        size: bytes.length,
        sha512: createHash('sha512').update(bytes).digest('base64'),
      })),
    }),
  );
  assert.equal((await verify(root, '3.1.0', 'publisher', async () => null)).length, 2);
  await assert.rejects(
    verify(root, '3.1.0', 'publisher', async () => 'untrusted'),
    /signature/,
  );
  await fs.appendFile(path.join(root, name), 'corrupt');
  await assert.rejects(
    verify(root, '3.1.0', 'publisher', async () => null),
    /checksum/,
  );
});
