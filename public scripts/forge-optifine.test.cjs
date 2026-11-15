const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const AdmZip = require('adm-zip');
const { ensureForgeOptiFine } = require('../dist/main/minecraft/optifine-installer');

test('Forge N/A is rejected before the core installer starts, with a specific diagnosis', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-optifine-unavailable-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(
        "<tr><td>preview_OptiFine_26.2_HD_U_K2_pre5.jar</td><td class='colForge'>Forge N/A</td></tr>",
      ),
  );
  const descriptor = {
    version: 'fixture',
    sha256: 'a'.repeat(64),
    url: 'https://fixture.test/core.zip',
  };
  let loaded = false;
  const {
    MinecraftJavaCoreAdapter,
    publicCoreError,
  } = require('../dist/main/minecraft/minecraft-java-core-adapter');
  const adapter = new MinecraftJavaCoreAdapter(
    {
      load: async () => {
        loaded = true;
        throw Error('Core must not load');
      },
    },
    descriptor,
  );
  let failure;
  await assert.rejects(
    adapter.launch(
      {
        engine: 'minecraft-java-core',
        installOptiForge: true,
        root,
        gameDirectory: root,
        version: { id: '26.2' },
        core: { descriptor },
      },
      () => {},
    ),
    (error) => {
      failure = error;
      return /OptiFine no tiene una edición compatible con Forge para Minecraft 26\.2/.test(
        error.message,
      );
    },
  );
  assert.equal(loaded, false);
  const detail = publicCoreError(failure, { authorization: {} });
  assert.match(detail, /Forge para Minecraft 26\.2/);
  const { additionalDiagnostics } = require('../dist/main/minecraft/local-crash-diagnostics');
  assert.equal(
    additionalDiagnostics([{ name: 'launch.log', content: detail }])[0].id,
    'optifine-forge-unavailable',
  );
});

test('OptiFine service failure with two installed editions offers reversible file choices', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-optifine-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(root, 'mods'));
  const files = ['OptiFine_1.20.1_HD_U_I6.jar', 'OptiFine_1.21.11_HD_U_J9.jar'];
  for (const filename of [...files, 'unrelated.jar']) {
    const zip = new AdmZip();
    zip.addFile(
      'META-INF/mods.toml',
      Buffer.from(
        `modLoader="javafml"\nloaderVersion="[47,)"\nlicense="fixture"\n[[mods]]\nmodId="${filename === 'unrelated.jar' ? 'unrelated' : 'optifine'}"\nversion="1.0"\ndisplayName="OptiFine"\n`,
      ),
    );
    await fs.writeFile(path.join(root, 'mods', filename), zip.toBuffer());
  }
  const log = path.join(root, 'launch.log');
  await fs.writeFile(
    log,
    'Error loading OptiFine ZIP file: jar:file:///mods/OptiFine_1.20.1_HD_U_I6.jar!/\njava.lang.IllegalArgumentException: URI is not hierarchical\nCaused by: cpw.mods.modlauncher.InvalidLauncherSetupException: Invalid Services found OptiFine',
  );
  const { CrashAnalysisService } = require('../dist/main/minecraft/crash-analysis-service');
  const service = new CrashAnalysisService(
    { snapshot: async () => ({ runtime: { ramMaxGb: 4 } }) },
    {},
  );
  const report = await service.analyze({
    exit: { code: 1, signal: null },
    gameDirectory: root,
    instanceId: null,
    launchLogPath: log,
    launchStartedAt: Date.now() - 1000,
  });
  assert(report);
  const issue = report.issues.find((x) => x.id === 'duplicate-mods');
  assert(issue);
  assert.equal(issue.repairs.length, 2);
  assert(!report.issues.some((x) => x.id === 'unclassified-exception'));
  assert(!report.issues.some((x) => x.id === 'optifine-service-load'));
  const action = issue.repairs.find((x) => x.label.includes(files[0]));
  assert(action);
  const before = await fs.readFile(path.join(root, 'mods', files[0]));
  const applied = await service.apply(report.id, action.id);
  await assert.rejects(fs.stat(path.join(root, 'mods', files[0])), { code: 'ENOENT' });
  await fs.stat(path.join(root, 'mods', files[1]));
  await fs.stat(path.join(root, 'mods', 'unrelated.jar'));
  await service.rollback(applied.repairId);
  assert.deepEqual(await fs.readFile(path.join(root, 'mods', files[0])), before);
});

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
