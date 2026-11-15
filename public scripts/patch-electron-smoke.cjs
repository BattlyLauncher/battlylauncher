const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  crypto = require('crypto'),
  assert = require('assert/strict'),
  { spawnSync } = require('child_process');
const { createRuntime, hash } = require('../bootstrap/patch-runtime.cjs');
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-patch-electron-')),
    base = path.join(temp, 'app'),
    user = path.join(temp, 'profile');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const config = {
    baseBuild: 1,
    version: '1.0.0',
    runtimeId: 'b'.repeat(64),
    platform: process.platform,
    arch: process.arch,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    githubRepository: 'fixture/battly',
  };
  const put = (p, data) => {
    fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true });
    fs.writeFileSync(path.join(base, p), data);
  };
  put(
    'package.json',
    JSON.stringify({ name: 'battly-patch-smoke', version: '1.0.0', main: 'test-entry.cjs' }),
  );
  put(
    'test-entry.cjs',
    `Object.defineProperty(require('electron').app,'isPackaged',{value:true});require('./bootstrap/entry.cjs');`,
  );
  for (const p of ['entry.cjs', 'runtime-config.cjs', 'patch-runtime.cjs', 'github-patch-feed.cjs'])
    put('bootstrap/' + p, fs.readFileSync(path.join(__dirname, '../bootstrap', p)));
  put('bootstrap/config.json', JSON.stringify(config));
  put('node_modules/fixture-dependency/index.js', `module.exports='bundled-dependency';`);
  fs.cpSync(
    path.dirname(require.resolve('adm-zip/package.json')),
    path.join(base, 'node_modules/adm-zip'),
    { recursive: true },
  );
  const main = (label) =>
    `const {app,BrowserWindow}=require('electron');const path=require('path');const dep=require('fixture-dependency');app.whenReady().then(async()=>{const workerDep=await new Promise((resolve,reject)=>{const worker=new(require('node:worker_threads').Worker)(path.join(__dirname,'minecraft/core-worker-bootstrap.js'));worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('Worker exited '+code))})});const w=new BrowserWindow({show:false,webPreferences:{offscreen:true,preload:path.join(__dirname,'../preload/index.js')}});await w.loadFile(path.join(__dirname,'../renderer/index.html'));const ui=await w.webContents.executeJavaScript('({text:document.body.textContent,bridge:window.fixture})');globalThis[Symbol.for('battly.patch.runtime')].healthy();console.log(JSON.stringify({label:${JSON.stringify(label)},dep,workerDep,ui,build:globalThis[Symbol.for('battly.patch.runtime')].snapshot().build}));app.exit(0)}).catch(e=>{console.error(e);app.exit(2)});`;
  let tree = {
    'dist/main/index.js': main('base'),
    'dist/main/minecraft/core-worker-bootstrap.js': fs.readFileSync(
      path.join(__dirname, '../dist/main/minecraft/core-worker-bootstrap.js'),
      'utf8',
    ),
    'dist/main/minecraft/core-launch-worker.js': `const zip=new(require('adm-zip'))();zip.addFile('worker.txt',Buffer.from('ready'));require('node:worker_threads').parentPort.postMessage({dependency:require('fixture-dependency'),zip:zip.getEntries()[0].entryName});`,
    'dist/preload/index.js': `require('electron').contextBridge.exposeInMainWorld('fixture','preload-ready');`,
    'dist/renderer/index.html':
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><body>Renderer ready</body>',
  };
  for (const [p, data] of Object.entries(tree)) put(p, data);
  const asar = path.join(temp, 'app.asar');
  await (await import('@electron/asar')).createPackage(base, asar);
  let envelope,
    requests = [];
  const opts = {
    config,
    installedRoot: base,
    root: require('../bootstrap/runtime-config.cjs').patchStorageRoot(user, config),
    fetcher: async (url) => {
      const p = new URL(url).pathname,
        m = JSON.parse(Buffer.from(envelope.payload, 'base64'));
      const assets = [
        {
          id: 1,
          name: `patch-${config.runtimeId}-stable-${config.platform}-${config.arch}.json`,
          size: Buffer.byteLength(JSON.stringify(envelope)),
          state: 'uploaded',
        },
        ...Object.values(tree).map((bytes, i) => ({
          id: i + 2,
          name: `${hash(bytes)}.blob`,
          size: Buffer.byteLength(bytes),
          state: 'uploaded',
        })),
      ];
      if (p.endsWith('/releases'))
        return Response.json([
          {
            id: 10,
            tag_name: `battly-patch-${m.patchVersion}`,
            draft: false,
            prerelease: true,
            assets,
          },
        ]);
      if (p.endsWith('/releases/10/assets')) return Response.json(assets);
      const id = Number(p.split('/').at(-1));
      if (id === 1) return Response.json(envelope);
      requests.push(url);
      return new Response(Object.values(tree)[id - 2]);
    },
  };
  async function stage(build) {
    const bytes = Buffer.from(
      JSON.stringify({
        schema: 1,
        type: 'patch',
        baseVersion: config.version,
        patchVersion: `1.0.0-patch${build}`,
        channel: 'stable',
        runtimeId: config.runtimeId,
        platform: config.platform,
        arch: config.arch,
        build,
        notes: 'fixture',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        files: Object.entries(tree).map(([p, v]) => ({
          path: p,
          sha256: hash(v),
          size: Buffer.byteLength(v),
        })),
      }),
    );
    envelope = {
      payload: bytes.toString('base64'),
      signature: crypto.sign(null, bytes, privateKey).toString('base64'),
    };
    const r = createRuntime(opts);
    r.boot();
    await r.stage(await r.check(), () => {});
    r.activate();
  }
  function launch() {
    const env = { ...process.env, BATTLY_USER_DATA_PATH: user };
    delete env.ELECTRON_RUN_AS_NODE;
    const r = spawnSync(require('electron'), [asar], {
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 20000,
    });
    if (r.error) throw r.error;
    return r;
  }
  tree['dist/main/index.js'] = main('patch');
  await stage(2);
  let r = launch();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"label":"patch"/);
  assert.match(r.stdout, /"build":2/);
  assert.match(r.stdout, /bundled-dependency/);
  assert.match(r.stdout, /"workerDep":\{"dependency":"bundled-dependency","zip":"worker.txt"\}/);
  assert.match(r.stdout, /preload-ready/);
  console.log(
    'Signed patch loaded main, preload and renderer from a separate build, resolving installed ASAR dependencies.',
  );
  tree['dist/main/index.js'] = `require('electron').app.exit(3);`;
  await stage(3);
  r = launch();
  assert.equal(r.status, 3, r.stderr);
  r = launch();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"label":"patch"/);
  assert.match(r.stdout, /"build":2/);
  console.log(
    'Failed first boot rolled back to the previous working build. Downloaded blobs: ' +
      requests.length,
  );
  console.log('Fixture: ' + temp);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
