const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ts = require('typescript');
const { desktopChannels } = require('../dist/shared/desktop-api');
const { blocksDataRootMigration } = require('../dist/main/settings/data-root-operation-policy');
const { BattlyDataRootService } = require('../dist/main/settings/battly-data-root-service');

async function mainSource() {
  const source = await fs.readFile(path.join(__dirname, '../src/main/index.ts'), 'utf8');
  return ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
}
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

test('pending online snapshots do not block a verified migration; installs remain tracked', async (t) => {
  const ast = await mainSource();
  const register = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'registerDesktopIpc',
  );
  const wrapper = register.body.statements.find(
    (node) => ts.isExpressionStatement(node) && node.getText(ast).startsWith('ipcMain.handle ='),
  );
  assert(wrapper);
  const harness = new Function(
    'blocksDataRootMigration',
    'desktopChannels',
    compile(`
    const handlers=new Map();const ipcMain={};const handle=(channel,listener)=>handlers.set(channel,listener);
    const remoteHandlers=new Map(),remoteOperations={},accessMonitor=undefined;
    const process={env:{}},normalizeServerId=()=> 'owned';
    let releaseOwnership;
    const resolveServerStore=()=>({list:()=>new Promise(resolve=>{releaseOwnership=resolve})});
    let rootMigrationActive=false,activeIpcOperations=0;
    ${wrapper.getText(ast)}
    return {register:(channel,listener)=>ipcMain.handle(channel,listener),invoke:channel=>handlers.get(channel)({}),active:()=>activeIpcOperations,denyOwnership:()=>releaseOwnership([])};
  `),
  )(blocksDataRootMigration, desktopChannels);
  let finishNetwork, finishInstall;
  harness.register(
    desktopChannels.getHome,
    () =>
      new Promise((resolve) => {
        finishNetwork = resolve;
      }),
  );
  harness.register(
    desktopChannels.installMod,
    () =>
      new Promise((resolve) => {
        finishInstall = resolve;
      }),
  );
  const network = harness.invoke(desktopChannels.getHome);
  assert.equal(harness.active(), 0);
  const install = harness.invoke(desktopChannels.installMod);
  assert.equal(harness.active(), 1);
  finishInstall();
  await install;
  assert.equal(harness.active(), 0);
  let wroteServerFile = false;
  harness.register(desktopChannels.writeServerFile, () => {
    wroteServerFile = true;
  });
  const serverWrite = harness.invoke(desktopChannels.writeServerFile);
  assert.equal(harness.active(), 1);
  harness.denyOwnership();
  await assert.rejects(serverWrite, /no pertenece/);
  assert.equal(harness.active(), 0);
  assert.equal(wroteServerFile, false);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-root-online-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const source = path.join(root, 'old'),
    target = path.join(root, 'new'),
    config = path.join(root, 'data-root.json');
  await fs.mkdir(path.join(source, 'instances'), { recursive: true });
  await fs.writeFile(path.join(source, 'instances/world.dat'), 'preserved');
  try {
    const service = new BattlyDataRootService(config, source);
    assert.equal((await service.migrate(target)).currentPath, target);
    assert.equal(await fs.readFile(path.join(source, 'instances/world.dat'), 'utf8'), 'preserved');
    assert.equal(await fs.readFile(path.join(target, 'instances/world.dat'), 'utf8'), 'preserved');
    assert.equal((await new BattlyDataRootService(config, source).snapshot()).currentPath, target);
  } finally {
    finishNetwork();
    await network;
  }
});

test('root-dependent services resolve the configured location after restarting', async (t) => {
  const ast = await mainSource();
  const names = ['instancesPath', 'resolveMinecraftCoreRuntime', 'resolveYtDlpResolver'];
  const functions = names.map((name) =>
    ast.statements
      .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
      .getText(ast),
  );
  const target = path.join(os.tmpdir(), 'custom-battly-data');
  const paths = new Function(
    'join',
    'process',
    'app',
    'contentRootPath',
    compile(`
    let minecraftCoreRuntime,ytDlpResolver;
    class MinecraftCoreInstaller{constructor(options){this.options=options}}
    class MinecraftCoreRuntime{constructor(installer){this.installer=installer}}
    class YtDlpResolver{constructor(directory){this.directory=directory}}
    ${functions.join('\n')}
    return {instances:instancesPath(),core:resolveMinecraftCoreRuntime().installer.options.libraryPath,music:resolveYtDlpResolver().directory};
  `),
  )(path.join, { env: {} }, { getPath: () => path.join(os.tmpdir(), 'old-appdata') }, () => target);
  assert.equal(paths.instances, path.join(target, 'instances'));
  assert.equal(paths.core, path.join(target, 'battly', 'launcher', 'mc'));
  assert.equal(paths.music, path.join(target, 'battly', 'launcher', 'music', 'bin'));
});

test('file mutations and unclassified requests keep blocking migration', () => {
  for (const channel of [
    desktopChannels.installMod,
    desktopChannels.installModBasket,
    desktopChannels.installManagedJava,
    desktopChannels.importMrpack,
    desktopChannels.updateInstance,
    desktopChannels.createServer,
    desktopChannels.writeServerFile,
    desktopChannels.resolveMusicSource,
    'future:write-content',
  ])
    assert.equal(blocksDataRootMigration(channel), true, channel);
  for (const channel of [
    desktopChannels.getSocial,
    desktopChannels.getHome,
    desktopChannels.getMusicInvites,
    desktopChannels.getDownloadCatalog,
    desktopChannels.getPlayVersions,
  ])
    assert.equal(blocksDataRootMigration(channel), false, channel);
});

test('migration handler reports both paths before rejecting an active file operation', async () => {
  const ast = await mainSource();
  const register = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'registerDesktopIpc',
  );
  const statement = register.body.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.arguments[0]?.getText(ast) === 'desktopChannels.migrateBattlyDataRoot',
  );
  assert(statement);
  const handler = statement.expression.arguments[1].getText(ast);
  const source = path.join(os.tmpdir(), 'battly-old'),
    target = path.join(os.tmpdir(), 'battly-new');
  const fixture = new Function(
    'desktopChannels',
    'source',
    'target',
    compile(`
    const process={env:{}},assertTrustedSender=()=>{};
    let rootMigrationPicking=false,rootMigrationActive=false;
    const BrowserWindow={fromWebContents:()=>({})},dialog={showOpenDialog:async()=>({filePaths:[target],canceled:false})};
    const runningMinecraftGames=new Set(),installingServerRuntimes=new Set();
    const launcherService=undefined,serverRuntimeService=undefined,launchRequestPreparing=false,labyUpdateInProgress=false,battlyClientUpdateInProgress=false,battlyClientUpdates={active:false};
    const activeIpcOperations=1,battlyDataRootSnapshot=async()=>({currentPath:source});
    const listener=${handler};const progress=[];
    return {run:()=>listener({senderFrame:{url:'fixture'},sender:{send:(channel,value)=>progress.push(value)}}),progress};
  `),
  )(desktopChannels, source, target);
  await assert.rejects(fixture.run(), /Close Minecraft/);
  assert.equal(fixture.progress.length, 1);
  assert.equal(fixture.progress[0].source, source);
  assert.equal(fixture.progress[0].target, target);
});
