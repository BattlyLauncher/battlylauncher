const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { packagePlan, packageBase } = require('./package-update-base.cjs');
const pkg = {
  version: '3.1.0-beta.7',
  battlyBuild: 1,
  battlyUpdate: { type: 'full', channel: 'beta', repository: '1ly4s0/BattlyRemake' },
  build: { win: { signtoolOptions: { publisherName: 'Pinned fixture publisher' } } },
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-base-packaging-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const directory = path.join(root, 'packages'),
    destination = path.join(root, 'export');
  fs.mkdirSync(directory);
  const prefix = 'Battly-Launcher-' + pkg.version;
  for (const name of [
    `${prefix}-x64.zip`,
    `${prefix}-ia32.zip`,
    'Battly-Launcher-win.exe',
    'Battly-Launcher-win.exe.blockmap',
    'Battly-Launcher-win-x64.exe',
    'Battly-Launcher-win-x64.exe.blockmap',
    'Battly-Launcher-win-ia32.exe',
    'Battly-Launcher-win-ia32.exe.blockmap',
    'official-installers.json',
    'Battly-Launcher-linux-x86_64.AppImage',
    'Battly-Launcher-linux-amd64.deb',
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
    `Battly-Launcher-mac-x64.tar.gz`,
    `Battly-Launcher-mac-arm64.tar.gz`,
    `Battly-Launcher-mac-x64.zip`,
    `Battly-Launcher-mac-arm64.zip`,
    `Battly-Launcher-mac-x64.zip.blockmap`,
    `Battly-Launcher-mac-arm64.zip.blockmap`,
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-x64.dmg.blockmap',
    'Battly-Launcher-mac-arm64.dmg',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
    'beta.yml',
    'beta-linux.yml',
    'beta-mac.yml',
    'secret.pem',
    'latest.yml',
  ])
    fs.writeFileSync(path.join(directory, name), 'fixture ' + name);
  fs.writeFileSync(
    path.join(directory, 'beta-mac.yml'),
    require('js-yaml').dump({
      version: pkg.version,
      files: ['x64', 'arm64'].map((arch) => ({
        url: `Battly-Launcher-mac-${arch}.zip`,
        size: 1,
        sha512: 'fixture',
      })),
    }),
  );
  const calls = [];
  const execute = (_command, args) => {
    calls.push(args);
    if (
      args[0] === 'public scripts/verify-release.cjs' ||
      args[0] === 'public scripts/verify-mac-release.cjs'
    )
      fs.writeFileSync(
        path.join(directory, 'verification.json'),
        JSON.stringify({ verified: args.at(-1) }),
      );
    if (args[0] === 'public scripts/verify-windows-updater.cjs')
      fs.writeFileSync(
        path.join(directory, 'updater-verification.json'),
        JSON.stringify({ artifacts: [] }),
      );
    if (args[0] === 'public scripts/verify-mac-updater.cjs')
      fs.writeFileSync(
        path.join(directory, 'updater-verification-mac.json'),
        JSON.stringify({ artifacts: [] }),
      );
  };
  return { directory, destination, calls, execute };
}
test('Windows x64 builds both Windows ZIPs before copying official installers with publishing disabled', () => {
  const plan = packagePlan(pkg, 'win32', 'x64');
  assert.deepEqual(plan.builderArguments.slice(3), [
    '--win',
    'zip',
    '--x64',
    '--ia32',
    '--publish',
    'never',
  ]);
  assert.equal(plan.universal, true);
  assert.deepEqual(packagePlan(pkg, 'win32', 'ia32').builderArguments.slice(3), [
    '--win',
    'zip',
    '--ia32',
    '--publish',
    'never',
  ]);
  assert.throws(() =>
    packagePlan({ ...pkg, battlyUpdate: { ...pkg.battlyUpdate, type: 'patch' } }, 'win32', 'x64'),
  );
  assert.throws(() => packagePlan(pkg, 'win32', 'arm64'), /Unsupported/);
});
test('Windows jobs export disjoint files and verify both architectures before copying signed updater data', (t) => {
  const f = fixture(t);
  const names = packageBase({ pkg, platform: 'win32', arch: 'x64', ...f });
  assert(names.includes('beta.yml'));
  assert(names.includes('Battly-Launcher-win.exe'));
  assert(!names.some((n) => n.endsWith('-ia32.zip') || n === 'latest.yml' || n === 'secret.pem'));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.destination, 'verification-win32-x64.json'), 'utf8')),
    { verified: '--arch=x64' },
  );
  assert.deepEqual(
    f.calls.filter((a) => a[0] === 'public scripts/verify-release.cjs').map((a) => a.at(-1)),
    ['--arch=x64', '--arch=ia32'],
  );
  assert(f.calls.some((a) => a[0] === 'public scripts/verify-windows-updater.cjs'));
  const second = path.join(path.dirname(f.destination), 'ia32-export');
  const ia32 = packageBase({ pkg, platform: 'win32', arch: 'ia32', ...f, destination: second });
  assert.deepEqual(
    ia32.sort(),
    ['Battly-Launcher-win-ia32.zip', 'verification-win32-ia32.json'].sort(),
  );
  assert(names.every((n) => !ia32.includes(n)));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.destination, 'verification-updater-win32-x64.json')))
      .publisherName,
    pkg.build.win.signtoolOptions.publisherName,
  );
});
test('verification failure or missing official EXE leaves no exported partial installer set', (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      packageBase({
        pkg,
        platform: 'win32',
        arch: 'x64',
        ...f,
        execute: () => {
          throw Error('Bad signature');
        },
      }),
    /Bad signature/,
  );
  assert.equal(fs.existsSync(f.destination), false);
  fs.unlinkSync(path.join(f.directory, 'Battly-Launcher-win.exe'));
  assert.throws(() => packageBase({ pkg, platform: 'win32', arch: 'x64', ...f }), /ENOENT/);
  assert.equal(fs.existsSync(f.destination), false);
});
test('macOS combined ZIP feed has one producer, while arm64 publishes only its verified manual archive', (t) => {
  const f = fixture(t);
  assert.deepEqual(packagePlan(pkg, 'darwin', 'x64').builderArguments.slice(3), [
    '--mac',
    'zip',
    'tar.gz',
    'dmg',
    '--x64',
    '--arm64',
    '--publish',
    'never',
  ]);
  const x64 = packageBase({ pkg, platform: 'darwin', arch: 'x64', ...f });
  assert(x64.includes('beta-mac.yml'));
  assert(x64.includes('Battly-Launcher-mac-arm64.zip'));
  for (const arch of ['x64', 'arm64'])
    assert(
      x64.includes(`Battly-Launcher-mac-${arch}.dmg`) &&
        x64.includes(`Battly-Launcher-mac-${arch}.dmg.blockmap`),
    );
  const feed = require('js-yaml').load(
    fs.readFileSync(path.join(f.destination, 'beta-mac.yml'), 'utf8'),
  );
  assert.equal(feed.files.length, 2);
  assert(feed.files.every((e) => e.url.endsWith('.zip')));
  assert.equal(feed.path, 'Battly-Launcher-mac-x64.zip');
  assert(!x64.includes('Battly-Launcher-mac-arm64.tar.gz'));
  assert(f.calls.some((args) => args[0] === 'public scripts/verify-mac-updater.cjs'));
  const arm64 = packageBase({
    pkg,
    platform: 'darwin',
    arch: 'arm64',
    ...f,
    destination: f.destination + '-arm64',
  });
  assert.deepEqual(
    arm64.sort(),
    ['Battly-Launcher-mac-arm64.tar.gz', 'verification-darwin-arm64.json'].sort(),
  );
  assert(x64.every((name) => !arm64.includes(name)));
});
test('Linux preserves AppImage/deb and its actual update channel feed, never foreign packages or secrets', (t) => {
  const f = fixture(t);
  const names = packageBase({ pkg, platform: 'linux', arch: 'x64', ...f });
  assert.deepEqual(
    names.sort(),
    [
      'Battly-Launcher-linux-x86_64.AppImage',
      'Battly-Launcher-linux-amd64.deb',
      'Battly-Launcher-linux-x86_64.rpm',
      'Battly-Launcher-linux-x64.tar.gz',
      'beta-linux.yml',
      'verification-linux-x64.json',
    ].sort(),
  );
});
