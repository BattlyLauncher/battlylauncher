const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  yaml = require('js-yaml'),
  AdmZip = require('adm-zip');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
const { gunzipSync, gzipSync } = require('node:zlib');
const { verify, inspectArchive } = require('./verify-mac-updater.cjs');
const config = { version: '3.1.0-beta.7', channel: 'beta', productName: 'Battly Launcher' };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-mac-updater-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const entries = [];
  for (const arch of ['x64', 'arm64']) {
    const zip = new AdmZip();
    for (const name of [
      'Contents/Info.plist',
      'Contents/MacOS/Battly Launcher',
      'Contents/Resources/app.asar',
    ])
      zip.addFile('Battly Launcher.app/' + name, Buffer.from('fixture ' + arch));
    const bytes = zip.toBuffer(),
      name = `Battly-Launcher-mac-${arch}.zip`;
    await fs.writeFile(path.join(root, name), bytes);
    const dmg = path.join(root, 'Battly-Launcher-mac-' + arch + '.dmg');
    await fs.writeFile(dmg, Buffer.alloc(8192, arch === 'x64' ? 7 : 8));
    await buildBlockMap(dmg, 'gzip', dmg + '.blockmap');
    entries.push({
      url: name,
      size: bytes.length,
      sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
    });
  }
  await fs.writeFile(
    path.join(root, 'beta-mac.yml'),
    yaml.dump({ version: config.version, files: entries }),
  );
  return { root, entries };
}
test('macOS updater validates both ZIP hashes and calls native architecture/signature verification for each bundle', async (t) => {
  const f = await fixture(t),
    checked = [];
  const result = await verify(f.root, config, {
    platform: 'darwin',
    extract: async () => {},
    verifyApp: async (app, arch) => {
      assert(app.endsWith('Battly Launcher.app'));
      checked.push(arch);
      return { codeSignature: true, packageIntegrity: true };
    },
  });
  assert.deepEqual(checked, ['x64', 'arm64']);
  assert.equal(result.artifacts.length, 2);
  assert.equal(result.version, config.version);
  assert.deepEqual(
    result.dmgs.map((entry) => entry.file),
    ['Battly-Launcher-mac-x64.dmg', 'Battly-Launcher-mac-arm64.dmg'],
  );
  for (const entry of result.dmgs) {
    const dmg = await fs.readFile(path.join(f.root, entry.file));
    const blockmap = await fs.readFile(path.join(f.root, entry.blockmap.file));
    assert.equal(entry.bytes, dmg.length);
    assert.equal(entry.sha512, crypto.createHash('sha512').update(dmg).digest('base64'));
    assert.equal(entry.blockmap.bytes, blockmap.length);
    assert.equal(
      entry.blockmap.sha512,
      crypto.createHash('sha512').update(blockmap).digest('base64'),
    );
  }
});
test('macOS updater rejects missing ARM ZIP feed metadata, wrong hashes and native signature errors', async (t) => {
  const f = await fixture(t),
    options = {
      platform: 'darwin',
      extract: async () => {},
      verifyApp: async () => ({ codeSignature: true }),
    };
  await fs.writeFile(
    path.join(f.root, 'beta-mac.yml'),
    yaml.dump({ version: config.version, files: f.entries.slice(0, 1) }),
  );
  await assert.rejects(verify(f.root, config, options), /unique.*arm64/);
  await fs.writeFile(
    path.join(f.root, 'beta-mac.yml'),
    yaml.dump({ version: config.version, files: f.entries }),
  );
  await assert.rejects(
    verify(f.root, config, {
      ...options,
      verifyApp: async () => {
        throw Error('Bad signature');
      },
    }),
    /Bad signature/,
  );
  await fs.appendFile(path.join(f.root, f.entries[0].url), 'corrupt');
  await assert.rejects(verify(f.root, config, options), /checksum/);
  await assert.rejects(verify(f.root, config, { platform: 'win32' }), /requires macOS/);
});
test('macOS updater ZIP rejects unrelated roots, incomplete bundles and escaping symlinks before extraction', () => {
  for (const mode of ['outside', 'incomplete', 'symlink']) {
    const zip = new AdmZip();
    if (mode !== 'incomplete')
      for (const name of [
        'Contents/Info.plist',
        'Contents/MacOS/Battly Launcher',
        'Contents/Resources/app.asar',
      ])
        zip.addFile('Battly Launcher.app/' + name, Buffer.from('fixture'));
    if (mode === 'outside') zip.addFile('outside.txt', Buffer.from('fixture'));
    if (mode === 'symlink') {
      zip.addFile('Battly Launcher.app/Contents/escape', Buffer.from('/outside'));
      zip.getEntry('Battly Launcher.app/Contents/escape').header.attr = (0xa1ff << 16) >>> 0;
    }
    assert.throws(() => inspectArchive(zip.toBuffer(), 'Battly Launcher'), /Unsafe|Incomplete/);
  }
});

test('optional base-app check passes designated requirement and paths as separate codesign arguments', async (t) => {
  const f = await fixture(t);
  const baseApp = path.join(f.root, 'Installed App with spaces.app');
  await fs.mkdir(baseApp);
  const requirement = 'identifier "com.fixture.Battly" and anchor apple generic';
  const calls = [];
  const result = await verify(f.root, config, {
    platform: 'darwin',
    baseApp,
    extract: async () => {},
    verifyApp: async () => ({ codeSignature: true, packageIntegrity: true }),
    codeSign: (command, args, options) => {
      assert.equal(command, 'codesign');
      assert.equal(options.shell, undefined);
      calls.push(args);
      return {
        status: 0,
        stdout: '',
        stderr: args.includes('-r-')
          ? 'Executable=fixture\ndesignated => ' + requirement + '\n'
          : '',
      };
    },
  });
  assert.deepEqual(calls[0], ['--verify', '--deep', '--strict', baseApp]);
  assert.deepEqual(calls[1], ['-d', '-r-', baseApp]);
  const checks = calls.filter((args) => args.includes('-R'));
  assert.equal(checks.length, 2);
  for (const args of checks) {
    assert.equal(args[args.indexOf('-R') + 1], '=' + requirement);
    assert(args.at(-1).endsWith(path.sep + 'Battly Launcher.app'));
  }
  assert.equal(result.squirrelContinuity.checked, true);
  assert.equal(
    result.squirrelContinuity.requirementSha256,
    crypto.createHash('sha256').update(requirement).digest('hex'),
  );
});

test('implicit ad-hoc requirements from native codesign output are checked without the comment marker', async (t) => {
  const f = await fixture(t);
  const baseApp = path.join(f.root, 'Adhoc.app');
  await fs.mkdir(baseApp);
  const requirement = 'cdhash H"dad37b4ceb977fbaab242e5d0150b6dde3582542"';
  const checks = [];
  const result = await verify(f.root, config, {
    platform: 'darwin',
    arches: ['x64'],
    baseApp,
    extract: async () => {},
    verifyApp: async () => ({ codeSignature: true }),
    codeSign: (_command, args) => {
      if (args.includes('-R')) checks.push(args[args.indexOf('-R') + 1]);
      return {
        status: 0,
        stderr: args.includes('-r-')
          ? 'Executable=fixture\n# designated => ' + requirement + '\n'
          : '',
      };
    },
  });
  assert.deepEqual(checks, ['=' + requirement]);
  assert.equal(result.squirrelContinuity.checked, true);
  await assert.rejects(
    verify(f.root, config, {
      platform: 'darwin',
      baseApp,
      codeSign: () => ({
        status: 0,
        stdout: 'designated => ' + requirement + '\n# designated => ' + requirement + '\n',
      }),
    }),
    /unique designated requirement/,
  );
});

test('individually valid new bundles fail if they do not satisfy the base app requirement', async (t) => {
  const f = await fixture(t),
    baseApp = path.join(f.root, 'Old.app');
  await fs.mkdir(baseApp);
  let individuallyVerified = 0;
  await assert.rejects(
    verify(f.root, config, {
      platform: 'darwin',
      baseApp,
      extract: async () => {},
      verifyApp: async () => {
        individuallyVerified++;
        return { codeSignature: true, packageIntegrity: true };
      },
      codeSign: (_command, args) =>
        args.includes('-R')
          ? { status: 1, stderr: 'code failed to satisfy specified code requirement' }
          : {
              status: 0,
              stderr: args.includes('-r-') ? 'designated => cdhash H"0123456789abcdef"\n' : '',
            },
    }),
    /requirement verification failed/,
  );
  assert.equal(individuallyVerified, 1);
});

test('base app requirement failures are rejected and no-base reports do not claim Squirrel continuity', async (t) => {
  const f = await fixture(t),
    baseApp = path.join(f.root, 'Old.app');
  await fs.mkdir(baseApp);
  const options = {
    platform: 'darwin',
    extract: async () => {},
    verifyApp: async () => ({ codeSignature: true }),
  };
  assert.equal((await verify(f.root, config, options)).squirrelContinuity.checked, false);
  await assert.rejects(
    verify(f.root, config, {
      ...options,
      baseApp,
      codeSign: () => ({ status: 0, stdout: 'no designated requirement' }),
    }),
    /designated requirement/,
  );
  await assert.rejects(
    verify(f.root, config, { ...options, baseApp, codeSign: () => ({ status: 1 }) }),
    /requirement verification/,
  );
  await assert.rejects(verify(f.root, config, { ...options, baseApp: '' }), /Invalid base/);
});

test('macOS distribution requires both DMGs and their blockmaps alongside updater ZIPs', async (t) => {
  const options = {
    platform: 'darwin',
    extract: async () => {},
    verifyApp: async () => ({ codeSignature: true }),
  };
  for (const file of [
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg',
    'Battly-Launcher-mac-x64.dmg.blockmap',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
  ]) {
    const f = await fixture(t);
    await fs.unlink(path.join(f.root, file));
    await assert.rejects(verify(f.root, config, options), { code: 'ENOENT' });
  }
});

test('macOS distribution rejects broken gzip, inconsistent block sizes and changed DMG sizes', async (t) => {
  const options = {
    platform: 'darwin',
    extract: async () => {},
    verifyApp: async () => ({ codeSignature: true }),
  };
  for (const mode of ['gzip', 'sizes', 'checksums', 'dmg']) {
    const f = await fixture(t);
    const dmg = path.join(f.root, 'Battly-Launcher-mac-x64.dmg');
    const map = dmg + '.blockmap';
    if (mode === 'gzip') {
      await fs.writeFile(map, 'invalid gzip data');
      await assert.rejects(verify(f.root, config, options), /header|gzip/i);
      continue;
    }
    if (mode === 'dmg') {
      await fs.appendFile(dmg, 'changed');
    } else {
      const body = JSON.parse(gunzipSync(await fs.readFile(map)).toString('utf8'));
      if (mode === 'sizes') body.files[0].sizes[0]++;
      else body.files[0].checksums = [];
      await fs.writeFile(map, gzipSync(JSON.stringify(body)));
    }
    await assert.rejects(verify(f.root, config, options), /blockmap.*size/);
  }
});
