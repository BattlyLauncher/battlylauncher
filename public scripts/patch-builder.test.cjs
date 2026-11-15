const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { spawnSync } = require('node:child_process');
test('real patch builder matches saved installer, signs all targets and rejects runtime changes', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-builder-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const put = (name, value) => {
    const file = path.join(temp, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  for (const name of [
    'public scripts/build-patches.cjs',
    'public scripts/patch-release-config.cjs',
    'bootstrap/entry.cjs',
    'bootstrap/patch-runtime.cjs',
    'bootstrap/runtime-config.cjs',
    'bootstrap/github-patch-feed.cjs',
  ])
    put(name, fs.readFileSync(path.resolve(name)));
  put('build-resources/immutable.txt', 'native resources\n');
  put('build-resources/immutable.bin', Buffer.from([0, 13, 10, 255]));
  put('package-lock.json', '{}');
  const pkg = {
    version: '3.1.0',
    battlyBuild: 1,
    main: 'bootstrap/entry.cjs',
    build: { asar: true },
    dependencies: {},
    battlyUpdate: { type: 'full', channel: 'stable', repository: '1ly4s0/BattlyRemake' },
  };
  put('package.json', JSON.stringify(pkg));
  for (const name of ['dist/main/index.js', 'dist/preload/index.js', 'dist/renderer/index.html'])
    put(name, 'original ' + name);
  const keys = crypto.generateKeyPairSync('ed25519');
  // GitHub secrets can omit the final newline without changing the key.
  put('public.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }).trimEnd());
  put('private.pem', keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const env = {
    ...process.env,
    BATTLY_PATCH_PUBLIC_KEY_FILE: path.join(temp, 'public.pem'),
    BATTLY_PATCH_PRIVATE_KEY_FILE: path.join(temp, 'private.pem'),
    BATTLY_PATCH_BASE_CONFIG_FILE: '',
    BATTLY_PATCH_PLATFORM: 'win32',
    BATTLY_PATCH_ARCH: 'x64',
  };
  function run(args, pass = true) {
    const result = spawnSync(process.execPath, ['public scripts/build-patches.cjs', ...args], {
      cwd: temp,
      env,
      encoding: 'utf8',
    });
    if (pass) assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0);
    return result;
  }
  run(['config']);
  put('baseline.json', fs.readFileSync(path.join(temp, 'bootstrap/config.json')));
  const originalRuntimeId = JSON.parse(fs.readFileSync(path.join(temp, 'baseline.json'))).runtimeId;
  put('build-resources/local/README.md', 'Local build notes, excluded from Git');
  put('build-resources/worlds-overlay/WindowTracker.exe', 'Retired local helper');
  put('build-resources/battly-tunnel/win-x64/battly-tunnel-client.exe', 'Retired local client');
  run(['config']);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(temp, 'bootstrap/config.json'))).runtimeId,
    originalRuntimeId,
    'Ignored local notes and retired components must not change the identity produced by CI',
  );
  put('public.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }).replace(/\n/g, '\r\n'));
  for (const name of [
    'bootstrap/entry.cjs',
    'bootstrap/patch-runtime.cjs',
    'bootstrap/runtime-config.cjs',
    'bootstrap/github-patch-feed.cjs',
    'build-resources/immutable.txt',
  ]) {
    put(name, fs.readFileSync(path.join(temp, name), 'utf8').replace(/\r?\n/g, '\r\n'));
  }
  run(['config']);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(temp, 'bootstrap/config.json'))).runtimeId,
    originalRuntimeId,
    'A checkout using CRLF must keep the same patch identity as LF',
  );
  pkg.battlyUpdate = {
    ...pkg.battlyUpdate,
    type: 'patch',
    patchVersion: '3.1.0-patch3',
    baseTag: 'v3.1.0',
    build: 3,
  };
  put('package.json', JSON.stringify(pkg));
  env.BATTLY_PATCH_BASE_CONFIG_FILE = path.join(temp, 'baseline.json');
  run(['config']);
  put('dist/main/index.js', 'changed launcher code');
  run(['release', '--out', path.join(temp, 'out')]);
  const config = JSON.parse(fs.readFileSync(path.join(temp, 'baseline.json'))),
    asset = `patch-${config.runtimeId}-stable-win32-x64.json`,
    envelope = JSON.parse(fs.readFileSync(path.join(temp, 'out/github-assets', asset)));
  const m = require('../bootstrap/patch-runtime.cjs').verifyEnvelope(envelope, config);
  assert.equal(m.patchVersion, '3.1.0-patch3');
  assert.equal(m.files.length, 3);
  assert(fs.existsSync(path.join(temp, 'out/github-assets', m.files[0].sha256 + '.blob')));
  put('package-lock.json', '{"changed":true}');
  assert.match(run(['config'], false).stderr, /Base installer mismatch/);
  assert.match(
    run(['release', '--out', path.join(temp, 'bad')], false).stderr,
    /runtime ha cambiado/,
  );
  put('package-lock.json', '{}');
  put('build-resources/immutable.txt', 'changed native');
  assert.match(run(['config'], false).stderr, /Base installer mismatch/);
  put('build-resources/immutable.txt', 'native resources\r\n');
  put('build-resources/immutable.bin', Buffer.from([0, 10, 255]));
  assert.match(run(['config'], false).stderr, /Base installer mismatch/);
});
test('installed electron-updater skips patch tags in a beta Atom feed', async () => {
  const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
  const provider = new GitHubProvider(
    { provider: 'github', owner: '1ly4s0', repo: 'BattlyRemake' },
    {
      channel: 'beta',
      allowPrerelease: true,
      currentVersion: require('semver').parse('3.1.0-beta.7'),
      isAddNoCacheQuery: false,
      fullChangelog: false,
    },
    {
      executor: {
        request: async () =>
          'version: 3.1.0-beta.8\nfiles:\n  - url: installer.exe\n    sha512: ZmFrZQ==\n    size: 4\n',
      },
    },
  );
  const urls = [];
  provider.httpRequest = async (url) => {
    urls.push(String(url));
    return `<?xml version="1.0"?><feed><entry><link href="https://github.com/1ly4s0/BattlyRemake/releases/tag/battly-patch-3.1.0-patch999"/><title>Patch</title><content>Patch only</content></entry><entry><link href="https://github.com/1ly4s0/BattlyRemake/releases/tag/v3.1.0-beta.8"/><title>Full</title><content>Full update</content></entry></feed>`;
  };
  const info = await provider.getLatestVersion();
  assert.equal(info.tag, 'v3.1.0-beta.8');
  assert(!urls.some((u) => u.includes('patch999')));
});
