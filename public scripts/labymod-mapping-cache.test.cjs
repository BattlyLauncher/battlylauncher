const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Zip = require('adm-zip');
const { repairLabyMappingCache } = require('../dist/main/minecraft/labymod-mapping-cache');
const mapping =
  'tsrg2 obf srg\nbib net/minecraft/client/Minecraft\nbib$2 net/minecraft/client/Minecraft$10\n';
const classes = ['bib', 'bib$2', 'bib$10'];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-laby-mappings-'));
  const directory = path.join(root, 'labymod-neo', 'mappings');
  await fs.mkdir(directory, { recursive: true });
  const cache = path.join(directory, '1.8.9-mcp.tsrg2');
  await fs.writeFile(cache, mapping);
  return { root, directory, cache, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
async function jar(file) {
  const archive = new Zip();
  for (const name of classes) archive.addFile(name + '.class', Buffer.from('fixture'));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, archive.toBuffer());
}

test('a missing vanilla JAR cannot turn optional mapping repair into a launch failure', async () => {
  const f = await fixture();
  try {
    assert.equal(await repairLabyMappingCache(f.root, f.root, '1.8.9'), false);
    assert.equal(await fs.readFile(f.cache, 'utf8'), mapping);
    await jar(path.join(f.root, 'versions/1.8.9/1.8.9.jar'));
    assert.equal(await repairLabyMappingCache(f.root, f.root, '1.8.9'), true);
    const backup = (await fs.readdir(f.directory)).find((name) => name.endsWith('.bak'));
    assert.equal(await fs.readFile(path.join(f.directory, backup), 'utf8'), mapping);
  } finally {
    await f.cleanup();
  }
});

test('mapping inspection ignores a damaged or empty game JAR without modifying caches', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'versions/1.8.9/1.8.9.jar');
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (const value of [Buffer.alloc(0), Buffer.from('interrupted download')]) {
      await fs.writeFile(file, value);
      assert.equal(await repairLabyMappingCache(f.root, f.root, '1.8.9'), false);
      assert.equal(await fs.readFile(f.cache, 'utf8'), mapping);
    }
  } finally {
    await f.cleanup();
  }
});

test('LabyMod can repair mappings using its actual launch JAR without a separate vanilla installation', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'versions/LabyMod-1.8.9/LabyMod-1.8.9.jar');
    await jar(file);
    assert.equal(await repairLabyMappingCache(f.root, f.root, '1.8.9', file), true);
    assert.equal(await repairLabyMappingCache(f.root, f.root, '1.8.9', file), false);
    assert.equal(
      await fs.readFile(file).then((buffer) => new Zip(buffer).getEntries().length),
      classes.length,
    );
  } finally {
    await f.cleanup();
  }
});

test('the launcher repairs mappings after the game JAR is prepared and before starting the process', async (t) => {
  const { Client } = require('minecraft-launcher-core');
  const Handler = require('minecraft-launcher-core/components/handler');
  const { spawn } = require('node:child_process');
  const {
    MinecraftLauncherCoreAdapter,
  } = require('../dist/main/minecraft/minecraft-launcher-core-adapter');
  const f = await fixture();
  const original = Client.prototype.launch;
  t.after(() => {
    Client.prototype.launch = original;
  });
  let prepared = false;
  try {
    const id = 'LabyMod-1.8.9';
    const versionDirectory = path.join(f.root, 'versions', id);
    await fs.mkdir(versionDirectory, { recursive: true });
    const profile = {
      id,
      inheritsFrom: '1.8.9',
      mainClass: 'test.Main',
      libraries: [],
      minecraftArguments: '--username fixture --gameDir ${game_directory}',
    };
    await fs.writeFile(path.join(versionDirectory, id + '.json'), JSON.stringify(profile));
    Client.prototype.launch = async function (options) {
      assert.equal(
        await fs.readFile(f.cache, 'utf8'),
        mapping,
        'inspection cannot run before preparation',
      );
      this.options = { ...options, mcPath: path.join(versionDirectory, id + '.jar') };
      await jar(this.options.mcPath);
      const handler = new Handler(this);
      handler.version = { ...profile, assets: '1.8' };
      await handler.getLaunchOptions(profile);
      await assert.rejects(fs.readFile(f.cache), { code: 'ENOENT' });
      assert((await fs.readdir(f.directory)).some((name) => name.endsWith('.bak')));
      prepared = true;
      return spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(0),20)']);
    };
    const handle = await new MinecraftLauncherCoreAdapter().launch(
      {
        engine: 'minecraft-launcher-core',
        root: f.root,
        gameDirectory: f.root,
        javaPath: process.execPath,
        version: { id: '1.8.9', type: 'release', customId: id },
        memory: { minimumMiB: 512, maximumMiB: 1024 },
        javaArguments: [],
        gameArguments: [],
        authorization: {
          type: 'offline',
          name: 'CacheQA',
          uuid: '0'.repeat(32),
          accessToken: 'fixture',
          clientToken: 'fixture',
        },
        window: { width: 854, height: 480, fullscreen: false },
      },
      () => {},
    );
    assert.equal((await handle.completion).code, 0);
    assert(prepared);
  } finally {
    await f.cleanup();
  }
});
