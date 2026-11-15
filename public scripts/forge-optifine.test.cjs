const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { ensureForgeOptiFine } = require('../dist/main/minecraft/optifine-installer');

test('ForgeOptiFine installs the official Forge-compatible JAR in the game directory and reuses it offline', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-forge-optifine-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const filename = 'OptiFine_1.20.1_HD_U_I6.jar';
  const jar = new AdmZip();
  jar.addFile('optifine/OptiFineTweaker.class', Buffer.from('fixture'));
  const bytes = jar.toBuffer();
  const urls = [];
  t.mock.method(global, 'fetch', async (url) => {
    urls.push(String(url));
    if (String(url).endsWith('/downloads'))
      return new Response(
        `<tr><td>preview_OptiFine_1.20.1_HD_U_I7_pre1.jar</td><td class='colForge'>Forge N/A</td></tr><tr><td>${filename}</td><td class='colForge'>Forge 47.2.18</td></tr>`,
      );
    if (String(url).includes('/adloadx?'))
      return new Response(`<a href='/downloadx?f=${filename}&amp;x=fixture'>Download</a>`);
    if (String(url).includes('/downloadx?')) return new Response(bytes);
    throw Error('Unexpected request');
  });
  const descriptor = {
    version: 'fixture',
    sha256: 'a'.repeat(64),
    url: 'https://fixture.test/core.zip',
  };
  const options = {
    root,
    gameDirectory: path.join(root, 'instance'),
    installOnly: true,
    installOptiForge: true,
    version: { id: '1.20.1' },
    engine: 'minecraft-java-core',
    authorization: {
      name: 'Fixture',
      uuid: 'fixture',
      accessToken: 'fixture',
      clientToken: 'fixture',
      type: 'offline',
    },
    core: {
      descriptor,
      resourceUrl: null,
      loader: { enabled: true, type: 'forge', build: '47.2.18' },
      timeoutMs: 10000,
      downloadConcurrency: 2,
      ignored: [],
      verify: false,
      beforeLaunch: null,
    },
    memory: { minimumMiB: 512, maximumMiB: 1024 },
    javaArguments: [],
    gameArguments: [],
    window: { fullscreen: false, width: 800, height: 600 },
  };
  const events = [];
  const {
    MinecraftJavaCoreAdapter,
  } = require('../dist/main/minecraft/minecraft-java-core-adapter');
  class Launch extends require('node:events').EventEmitter {
    async Launch() {
      return this.start();
    }
    async DownloadGame() {
      return {};
    }
  }
  const adapter = new MinecraftJavaCoreAdapter({ load: async () => ({ Launch }) }, descriptor);
  const handle = await adapter.launch(options, (event) => events.push(event));
  assert.deepEqual(await handle.completion, { code: null, signal: null });
  const installed = path.join(options.gameDirectory, 'mods', filename);
  assert.deepEqual(await fs.readFile(installed), bytes);
  assert.equal(urls.length, 3);
  assert(urls.every((url) => url.startsWith('https://optifine.net/')));
  assert(events.some((event) => event.type === 'file-complete' && event.item === filename));
  t.mock.method(global, 'fetch', async () => {
    throw Error('Offline');
  });
  await ensureForgeOptiFine(options, () => {});
  assert.deepEqual(await fs.readFile(installed), bytes);
  await ensureForgeOptiFine(
    { ...options, installOptiForge: false, gameDirectory: path.join(root, 'other') },
    () => {},
  );
  await assert.rejects(fs.stat(path.join(root, 'other')), { code: 'ENOENT' });
});

test('ForgeOptiFine rejects an HTML download without leaving a fake mod', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-forge-optifine-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const filename = 'OptiFine_1.20.1_HD_U_I6.jar';
  t.mock.method(
    global,
    'fetch',
    async (url) =>
      new Response(
        String(url).endsWith('/downloads')
          ? `<tr><td>${filename}</td><td class='colForge'>Forge 47.2.18</td></tr>`
          : String(url).includes('/adloadx?')
            ? `<a href='/downloadx?f=${filename}'>Download</a>`
            : '<html>Download failed</html>',
      ),
  );
  await assert.rejects(
    ensureForgeOptiFine(
      { root, gameDirectory: root, installOptiForge: true, version: { id: '1.20.1' } },
      () => {},
    ),
    /JAR/,
  );
  await assert.rejects(fs.stat(path.join(root, 'mods', filename)), { code: 'ENOENT' });
});
