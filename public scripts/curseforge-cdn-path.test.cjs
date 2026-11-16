const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Zip = require('adm-zip');
const { CurseForgeModpackInstaller } = require('../dist/main/mods/curseforge-modpack-installer');

test('CurseForge fallback paths use numeric file ID components without leading zeroes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-cf-cdn-'));
  try {
    for (const [fileID, expected] of [
      [8287097, '8287/97'],
      [1234000, '1234/0'],
      [3456, '3/456'],
    ]) {
      const zip = new Zip();
      zip.addFile(
        'manifest.json',
        Buffer.from(
          JSON.stringify({
            manifestType: 'minecraftModpack',
            name: 'Pack',
            author: 'QA',
            version: '1',
            minecraft: { version: '1.21.1', modLoaders: [] },
            files: [{ projectID: 1, fileID }],
            overrides: 'overrides',
          }),
        ),
      );
      const archive = path.join(root, `${fileID}.zip`);
      zip.writeZip(archive);
      const bytes = Buffer.from('verified mod');
      const digest = crypto.createHash('sha1').update(bytes).digest('hex');
      let downloads = 0;
      const installer = new CurseForgeModpackInstaller(path.join(root, 'instances'), {
        createId: () => `id${fileID}`,
        fetchImplementation: async (url, options) => {
          assert.equal(options.redirect, 'error');
          if (new URL(url).hostname === 'api.battlylauncher.com')
            return Response.json({
              data: {
                id: fileID,
                modId: 1,
                fileName: 'test.jar',
                fileLength: bytes.length,
                hashes: [{ algo: 1, value: digest }],
                downloadUrl: null,
              },
            });
          assert.equal(String(url), `https://mediafilez.forgecdn.net/files/${expected}/test.jar`);
          downloads++;
          return new Response(bytes);
        },
      });
      await installer.install(archive);
      assert.equal(downloads, 1);
      assert.deepEqual(
        await fs.readFile(path.join(root, `instances/id${fileID}/mods/test.jar`)),
        bytes,
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('CurseForge CDN rejection does not blame the Battly account', async () => {
  const ts = require('typescript');
  const source = await fs.readFile(
    path.join(__dirname, '../src/renderer/ui/user-error.ts'),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', code)(exports);
  const message = exports.userErrorMessage(
    new Error(
      "Error invoking remote method 'mods:import-mrpack': Error: CurseForge download failed (403): entityculling.jar",
    ),
  );
  assert.match(message, /CurseForge/);
  assert.doesNotMatch(message, /sesión|cuenta/);
});
