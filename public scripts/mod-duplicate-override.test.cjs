const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { LauncherService } = require('../dist/main/minecraft/launcher-service');
const { LaunchModDuplicatesError } = require('../dist/main/minecraft/launch-mod-preflight');
const { normalizeInstanceLaunchRequest } = require('../dist/shared/minecraft/launch-contract');
const {
  normalizePlayVersionLaunchRequest,
} = require('../dist/shared/minecraft/play-version-contract');

test('duplicate override is validated explicitly in both launch request contracts', () => {
  for (const [normalize, request] of [
    [normalizeInstanceLaunchRequest, { safeMode: false }],
    [normalizePlayVersionLaunchRequest, { version: '1.21.1' }],
  ]) {
    assert.equal(normalize(request).allowDuplicateMods, undefined);
    assert.equal(normalize({ ...request, allowDuplicateMods: true }).allowDuplicateMods, true);
    assert.equal(
      normalize({ ...request, allowDuplicateMods: false }).allowDuplicateMods,
      undefined,
    );
    assert.throws(
      () => normalize({ ...request, allowDuplicateMods: 'true' }),
      /Invalid duplicate mod override/,
    );
  }
});

for (const engine of ['minecraft-java-core', 'minecraft-launcher-core']) {
  test(`${engine}: override applies once, retains preparation and leaves JARs unchanged`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-duplicate-override-'));
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
    await fs.mkdir(path.join(root, 'mods'));
    const files = ['first.jar', 'second.jar'].map((name) => path.join(root, 'mods', name));
    for (const file of files) {
      const zip = new AdmZip();
      zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'example' })));
      await fs.writeFile(file, zip.toBuffer());
    }
    const originals = await Promise.all(files.map((file) => fs.readFile(file)));
    let starts = 0,
      preparations = 0;
    const service = new LauncherService(
      [
        {
          engine,
          launch: async () => {
            starts++;
            return { completion: Promise.resolve({ code: 0, signal: null }), cancel: () => true };
          },
        },
      ],
      async (options) => {
        preparations++;
        return options;
      },
    );
    const options = {
      engine,
      root,
      gameDirectory: root,
      version: { id: '1.21.1' },
      core: { loader: { enabled: true, type: 'fabric' } },
    };
    await assert.rejects(
      service.start(options, () => {}),
      LaunchModDuplicatesError,
    );
    assert.equal(starts, 0);
    assert.equal(preparations, 0);
    const events = [];
    await service.start(options, (event) => events.push(event), undefined, Symbol(), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 1);
    assert.equal(preparations, 1);
    assert(
      events.some((event) => event.type === 'log' && event.message.includes('duplicate-mod-check')),
    );
    assert.deepEqual(await Promise.all(files.map((file) => fs.readFile(file))), originals);
    await assert.rejects(
      service.start(options, () => {}),
      LaunchModDuplicatesError,
    );
  });
}
