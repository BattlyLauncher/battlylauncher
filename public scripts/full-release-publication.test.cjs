const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  yaml = require('js-yaml');
const { publicationPlan, targets } = require('./publish-battly-update.cjs');
test('release publication keeps the human changelog visible and metadata in an HTML comment', async () => {
  const { publish } = require('./publish-battly-update.cjs');
  const notes = '### Minecraft\n\n- Corregido el inicio de LabyMod.\n- Recuperadas las instancias.';
  let created;
  await publish(
    {
      repository: 'BattlyLauncher/battlylauncher',
      tag: 'battly-patch-3.1.0-patch8',
      type: 'patch',
      channel: 'stable',
      version: '3.1.0',
      patchVersion: '3.1.0-patch8',
      build: 8,
      prerelease: true,
      notes,
      files: [],
    },
    {
      token: 'fixture',
      sha: 'a'.repeat(40),
      notBefore: '',
      fetcher: async (url, options) => {
        if (options.method === 'POST') {
          created = JSON.parse(options.body);
          return Response.json({ id: 1, draft: true });
        }
        if (options.method === 'PATCH') return Response.json({ id: 1, draft: false });
        if (url.includes('/assets?')) return Response.json([]);
        return Response.json({}, { status: 404 });
      },
    },
  );
  assert.ok(created.body.startsWith(notes + '\n\n<!-- battly-update\n'));
  assert.ok(created.body.endsWith('\n-->'));
  assert.equal(created.draft, true);
});
const sha512 = (bytes) => crypto.createHash('sha512').update(bytes).digest('base64');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t, channel = 'beta') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-full-plan-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const pkg = {
    version: channel === 'beta' ? '3.1.0-beta.7' : '3.1.0',
    battlyBuild: 1,
    battlyUpdate: { type: 'full', channel, repository: '1ly4s0/BattlyRemake' },
    build: { win: { signtoolOptions: { publisherName: 'Pinned fixture publisher' } } },
  };
  const prefix = `Battly-Launcher-${pkg.version}`,
    feedChannel = channel === 'beta' ? 'beta' : 'latest';
  const put = (name, data) =>
    fs.writeFileSync(
      path.join(root, name),
      typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data,
    );
  const read = (name) => fs.readFileSync(path.join(root, name));
  const archiveNames = [
    'Battly-Launcher-win.zip',
    'Battly-Launcher-win-ia32.zip',
    'Battly-Launcher-linux-x86_64.AppImage',
    `${prefix}-x86_64.flatpak`,
    'Battly-Launcher-linux-amd64.deb',
    `Battly-Launcher-mac-x64.tar.gz`,
    `Battly-Launcher-mac-arm64.tar.gz`,
    `Battly-Launcher-mac-x64.zip`,
    `Battly-Launcher-mac-arm64.zip`,
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg',
    'Battly-Launcher-mac-x64.dmg.blockmap',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
    'Battly-Launcher-win.exe',
    'Battly-Launcher-win.exe.blockmap',
    'Battly-Launcher-win-ia32.exe',
    'Battly-Launcher-win-ia32.exe.blockmap',
  ];
  for (const name of archiveNames) put(name, Buffer.from('verified fixture ' + name));
  put('Battly-Launcher-win-x64.exe', read('Battly-Launcher-win.exe'));
  put('Battly-Launcher-win-x64.exe.blockmap', read('Battly-Launcher-win.exe.blockmap'));
  const entry = (name) => ({ url: name, size: read(name).length, sha512: sha512(read(name)) });
  const reportEntry = (name) => ({
    file: name,
    bytes: read(name).length,
    sha512: sha512(read(name)),
  });
  put('verification-flatpak-linux-x64.json', {
    version: pkg.version,
    platform: 'linux',
    arch: 'x64',
    installedAndLaunched: true,
    artifact: reportEntry(`${prefix}-x86_64.flatpak`),
  });
  for (const [platform, arch] of targets) {
    put(`patch-base-${platform}-${arch}.json`, {
      version: pkg.version,
      baseBuild: pkg.battlyBuild,
      platform,
      arch,
      githubRepository: pkg.battlyUpdate.repository,
      publicKey: 'fixture-public-key',
    });
    const name =
      platform === 'win32'
        ? arch === 'ia32'
          ? 'Battly-Launcher-win-ia32.zip'
          : 'Battly-Launcher-win.zip'
        : platform === 'darwin'
          ? `Battly-Launcher-mac-${arch}.tar.gz`
          : 'Battly-Launcher-linux-x86_64.AppImage';
    put(`verification-${platform}-${arch}.json`, {
      version: pkg.version,
      artifacts: (platform === 'linux'
        ? [
            'Battly-Launcher-linux-x86_64.AppImage',
            'Battly-Launcher-linux-amd64.deb',
            'Battly-Launcher-linux-x86_64.rpm',
            'Battly-Launcher-linux-x64.tar.gz',
          ]
        : [name]
      ).map(reportEntry),
    });
  }
  const win = entry('Battly-Launcher-win.exe');
  const wins = [win, entry('Battly-Launcher-win-ia32.exe')];
  const mac = [`Battly-Launcher-mac-x64.zip`, `Battly-Launcher-mac-arm64.zip`];
  for (const [name, names] of [
    [`${feedChannel}.yml`, wins.map((e) => e.url)],
    [`${feedChannel}-linux.yml`, ['Battly-Launcher-linux-x86_64.AppImage']],
    [`${feedChannel}-mac.yml`, mac],
  ])
    put(
      name,
      yaml.dump({
        version: pkg.version,
        files: names.map(entry),
        path: names[0],
        sha512: entry(names[0]).sha512,
      }),
    );
  const installers = wins.map((e, index) => ({
    file: e.url,
    arch: index === 0 ? 'x64' : 'ia32',
    sourceAsset: index === 0 ? 'Battly-Launcher-Windows.exe' : 'Battly-Launcher-win-ia32.exe',
    size: e.size,
    sha512: e.sha512,
    blockmapSha256: sha256(read(e.url + '.blockmap')),
  }));
  put('official-installers.json', {
    schema: 1,
    protocol: 2,
    qa: false,
    repository: 'BattlyLauncher/battlyinstaller',
    tag: 'rust_v4.2.0',
    publisherName: pkg.build.win.signtoolOptions.publisherName,
    installers,
  });
  put('verification-updater-win32-x64.json', {
    version: pkg.version,
    publisherName: pkg.build.win.signtoolOptions.publisherName,
    artifacts: installers.map((e) => ({ ...e, feed: feedChannel + '.yml', installer: e.file })),
  });
  put('verification-updater-darwin-x64.json', {
    version: pkg.version,
    dmgs: ['x64', 'arm64'].map((arch) => {
      const file = 'Battly-Launcher-mac-' + arch + '.dmg';
      return { ...reportEntry(file), arch, blockmap: reportEntry(file + '.blockmap') };
    }),
    artifacts: mac.map((name, index) => ({
      ...reportEntry(name),
      arch: index === 0 ? 'x64' : 'arm64',
      feed: feedChannel + '-mac.yml',
      trust: {
        codeSignature: true,
        packageIntegrity: true,
        machO: index === 0 ? 'x86_64' : 'arm64',
      },
    })),
  });
  return { root, pkg, prefix, feedChannel, put, read };
}
test('full publication rejects an absent, modified or unlaunched Flatpak', (t) => {
  for (const change of ['missing', 'bytes', 'not-launched']) {
    const f = fixture(t, 'stable');
    if (change === 'missing') fs.unlinkSync(path.join(f.root, `${f.prefix}-x86_64.flatpak`));
    if (change === 'bytes') f.put(`${f.prefix}-x86_64.flatpak`, 'changed after installation');
    if (change === 'not-launched') {
      const report = JSON.parse(f.read('verification-flatpak-linux-x64.json'));
      report.installedAndLaunched = false;
      f.put('verification-flatpak-linux-x64.json', report);
    }
    assert.throws(() => publicationPlan(f.pkg, f.root));
  }
});
test('complete full releases include official Windows installers, Linux feed and both mac ZIP architectures for each channel', (t) => {
  for (const channel of ['beta', 'stable']) {
    const f = fixture(t, channel),
      plan = publicationPlan(f.pkg, f.root);
    assert.equal(plan.prerelease, channel === 'beta');
    for (const name of [
      'Battly-Launcher-win.exe',
      'Battly-Launcher-win.exe.blockmap',
      `${f.feedChannel}.yml`,
      `${f.feedChannel}-linux.yml`,
      `${f.feedChannel}-mac.yml`,
      `Battly-Launcher-mac-arm64.zip`,
    ])
      assert(
        plan.files.some((file) => file.name === name),
        name,
      );
  }
});
test('Linux feeds include the verified Debian package and reject another platform package', (t) => {
  const f = fixture(t, 'stable');
  const name = `${f.feedChannel}-linux.yml`;
  const feed = yaml.load(f.read(name).toString('utf8'));
  const deb = 'Battly-Launcher-linux-amd64.deb';
  feed.files.push({ url: deb, size: f.read(deb).length, sha512: sha512(f.read(deb)) });
  f.put(name, yaml.dump(feed));
  assert.doesNotThrow(() => publicationPlan(f.pkg, f.root));
  const verifiedDeb = f.read(deb);
  f.put(deb, 'corrupt');
  assert.throws(() => publicationPlan(f.pkg, f.root), /checksum/);
  f.put(deb, verifiedDeb);
  const other = `Battly-Launcher-mac-x64.zip`;
  feed.files[1] = { url: other, size: f.read(other).length, sha512: sha512(f.read(other)) };
  f.put(name, yaml.dump(feed));
  assert.throws(() => publicationPlan(f.pkg, f.root), /unexpected full updater feed/);
});

test('ZIP-only Windows full release and missing macOS ZIP are rejected', (t) => {
  for (const suffix of [
    'Battly-Launcher-win.exe',
    'Battly-Launcher-win.exe.blockmap',
    'Battly-Launcher-win-ia32.exe',
    'Battly-Launcher-win-ia32.exe.blockmap',
    'official-installers.json',
    'Battly-Launcher-mac-arm64.zip',
  ]) {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, suffix));
    assert.throws(() => publicationPlan(f.pkg, f.root), /Missing/);
  }
});
test('installer, archive and transport blockmap corruption are rejected before any publication', (t) => {
  for (const suffix of [
    'Battly-Launcher-win.exe',
    'Battly-Launcher-win.zip',
    'Battly-Launcher-win.exe.blockmap',
  ]) {
    const f = fixture(t);
    fs.appendFileSync(path.join(f.root, suffix), 'corrupt');
    assert.throws(() => publicationPlan(f.pkg, f.root), /checksum|verification|alias/);
  }
});
test('full publication refuses wrong channel or version and unsafe or stale feed references', (t) => {
  for (const kind of ['channel', 'version', 'url', 'path', 'sha512', 'duplicate']) {
    const f = fixture(t);
    const name = `${f.feedChannel}.yml`,
      feed = yaml.load(f.read(name).toString('utf8'));
    if (kind === 'channel') {
      fs.renameSync(path.join(f.root, name), path.join(f.root, 'latest.yml'));
    } else {
      if (kind === 'version') feed.version = '1.0.0';
      if (kind === 'url') feed.files[0].url = '../outside.exe';
      if (kind === 'path') feed.path = f.prefix + '-x64.zip';
      if (kind === 'sha512') feed.sha512 = 'wrong';
      if (kind === 'duplicate') feed.files.push(feed.files[0]);
      f.put(name, yaml.dump(feed));
    }
    assert.throws(() => publicationPlan(f.pkg, f.root), /Unexpected|Invalid|Unsafe|Missing/);
  }
});
test('macOS feed must bind both ZIP architectures and their exact bytes from one producer', (t) => {
  for (const kind of ['missing-arm', 'wrong-size', 'wrong-hash']) {
    const f = fixture(t),
      name = `${f.feedChannel}-mac.yml`,
      feed = yaml.load(f.read(name).toString('utf8'));
    if (kind === 'missing-arm') feed.files.pop();
    if (kind === 'wrong-size') feed.files[1].size++;
    if (kind === 'wrong-hash') feed.files[1].sha512 = 'wrong';
    f.put(name, yaml.dump(feed));
    assert.throws(() => publicationPlan(f.pkg, f.root), /Missing|checksum/);
  }
});
test('full verification is version-bound and cannot change the pinned Windows publisher', (t) => {
  for (const change of [
    { version: '1.0.0' },
    { publisherName: 'Untrusted publisher' },
    { artifacts: [{ installer: 'wrong' }] },
    { artifacts: [] },
  ]) {
    const f = fixture(t),
      name = 'verification-updater-win32-x64.json',
      report = JSON.parse(f.read(name));
    f.put(name, { ...report, ...change });
    assert.throws(() => publicationPlan(f.pkg, f.root), /pinned Windows/);
  }
});
test('unrelated debug data, secret files, and installers from another version cannot enter the plan', (t) => {
  for (const name of ['private.pem', 'builder-debug.yml', 'Battly-Launcher-0.0.1-Setup.exe']) {
    const f = fixture(t);
    f.put(name, 'fixture');
    assert.throws(() => publicationPlan(f.pkg, f.root), /Unexpected/);
  }
});
test('CLI repository authorization remains strict for a future private-to-public workflow', () => {
  const source = fs.readFileSync(path.join(__dirname, 'publish-battly-update.cjs'), 'utf8');
  assert.match(source, /process\.env\.GITHUB_REPOSITORY\s*!==\s*plan\.repository/);
  assert.match(source, /Wrong publication repository/);
});

test('macOS verification must certify the expected CPU, code signature and package content', (t) => {
  for (const change of [
    { arch: 'x64' },
    { trust: { codeSignature: false, packageIntegrity: true, machO: 'arm64' } },
    { trust: { codeSignature: true, packageIntegrity: false, machO: 'arm64' } },
  ]) {
    const f = fixture(t),
      name = 'verification-updater-darwin-x64.json',
      report = JSON.parse(f.read(name));
    report.artifacts[1] = { ...report.artifacts[1], ...change };
    f.put(name, report);
    assert.throws(() => publicationPlan(f.pkg, f.root), /architecture or signature/);
  }
});

test('legacy distribution names are mandatory for every installer format and Windows x64 alias', (t) => {
  const names = [
    'Battly-Launcher-linux-x86_64.AppImage',
    'Battly-Launcher-linux-amd64.deb',
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg',
    'Battly-Launcher-mac-x64.dmg.blockmap',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
    'Battly-Launcher-win-x64.exe',
    'Battly-Launcher-win-x64.exe.blockmap',
  ];
  for (const name of names) {
    const f = fixture(t, 'stable');
    assert(publicationPlan(f.pkg, f.root).files.some((file) => file.name === name));
    fs.unlinkSync(path.join(f.root, name));
    assert.throws(() => publicationPlan(f.pkg, f.root), /Missing/);
  }
});

test('new Linux formats, macOS DMGs and their blockmaps must match their verification reports', (t) => {
  for (const name of [
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
  ]) {
    const f = fixture(t);
    f.put(name, 'modified after verification');
    assert.throws(() => publicationPlan(f.pkg, f.root), /checksum/);
  }
});

test('the Windows x64 alias and blockmap must be identical to the official verified installer', (t) => {
  for (const name of ['Battly-Launcher-win-x64.exe', 'Battly-Launcher-win-x64.exe.blockmap']) {
    const f = fixture(t);
    f.put(name, 'different alias bytes');
    assert.throws(() => publicationPlan(f.pkg, f.root), /alias/);
  }
});

test('macOS disk image verification is required for both architectures', (t) => {
  const f = fixture(t);
  const file = 'verification-updater-darwin-x64.json';
  const report = JSON.parse(f.read(file));
  report.dmgs.pop();
  f.put(file, report);
  assert.throws(() => publicationPlan(f.pkg, f.root), /macOS updater verification/);
});
