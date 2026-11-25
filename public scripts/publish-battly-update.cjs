'use strict';
// Network writes are opt-in. CI calls --publish only after every matrix job succeeds.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const yaml = require('js-yaml');
const { releaseConfig, publicationWindow } = require('./patch-release-config.cjs');
const { verifyEnvelope } = require('../bootstrap/patch-runtime.cjs');
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const targets = [
  ['win32', 'x64'],
  ['win32', 'ia32'],
  ['linux', 'x64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
];
function verifyFullRelease(pkg, update, root, files) {
  const prefix = `Battly-Launcher-${pkg.version}`;
  const channel = update.channel === 'beta' ? 'beta' : 'latest';
  const installer = 'Battly-Launcher-win.exe';
  const windowsInstallers = [installer, 'Battly-Launcher-win-ia32.exe'];
  const windowsAlias = 'Battly-Launcher-win-x64.exe';
  const linuxPackages = [
    'Battly-Launcher-linux-x86_64.AppImage',
    'Battly-Launcher-linux-amd64.deb',
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
  ];
  const requiredPackages = [
    'Battly-Launcher-win.zip',
    'Battly-Launcher-win-ia32.zip',
    ...linuxPackages,
    `${prefix}-x86_64.flatpak`,
    `Battly-Launcher-mac-x64.tar.gz`,
    `Battly-Launcher-mac-arm64.tar.gz`,
    `Battly-Launcher-mac-x64.zip`,
    `Battly-Launcher-mac-arm64.zip`,
  ];
  const reportNames = targets.map(([platform, arch]) => `verification-${platform}-${arch}.json`);
  const feeds = [`${channel}.yml`, `${channel}-linux.yml`, `${channel}-mac.yml`];
  const expected = new Set([
    ...targets.map(([platform, arch]) => `patch-base-${platform}-${arch}.json`),
    ...reportNames,
    ...requiredPackages,
    ...windowsInstallers.flatMap((name) => [name, name + '.blockmap']),
    windowsAlias,
    windowsAlias + '.blockmap',
    'official-installers.json',
    ...feeds,
    'verification-updater-win32-x64.json',
    'verification-updater-darwin-x64.json',
    'verification-flatpak-linux-x64.json',
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg',
    'Battly-Launcher-mac-x64.dmg.blockmap',
    'Battly-Launcher-mac-arm64.dmg.blockmap',
    `Battly-Launcher-mac-x64.zip.blockmap`,
    `Battly-Launcher-mac-arm64.zip.blockmap`,
  ]);
  if (files.some((name) => !expected.has(name))) throw Error('Unexpected full release asset');
  if (
    [
      ...requiredPackages,
      ...windowsInstallers.flatMap((name) => [name, name + '.blockmap']),
      windowsAlias,
      windowsAlias + '.blockmap',
      'Battly-Launcher-mac-x64.dmg',
      'Battly-Launcher-mac-arm64.dmg',
      'Battly-Launcher-mac-x64.dmg.blockmap',
      'Battly-Launcher-mac-arm64.dmg.blockmap',
      'official-installers.json',
      ...feeds,
      ...reportNames,
      'verification-updater-win32-x64.json',
      'verification-updater-darwin-x64.json',
      'verification-flatpak-linux-x64.json',
    ].some((name) => !files.includes(name))
  )
    throw Error('Missing full release packages, updater feeds or verification');
  const bytes = (name) => fs.readFileSync(path.join(root, name));
  if (
    !bytes(windowsAlias).equals(bytes(installer)) ||
    !bytes(windowsAlias + '.blockmap').equals(bytes(installer + '.blockmap'))
  ) {
    throw Error('Windows x64 alias differs from the verified official installer');
  }
  const checkedArtifact = (entry, name) => {
    if (!entry || entry.file !== name || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0)
      throw Error('Invalid full release verification');
    const data = bytes(name);
    if (
      data.length !== entry.bytes ||
      crypto.createHash('sha512').update(data).digest('base64') !== entry.sha512
    )
      throw Error('Full release verification checksum mismatch');
  };
  const flatpak = JSON.parse(bytes('verification-flatpak-linux-x64.json').toString('utf8'));
  if (
    flatpak.version !== pkg.version ||
    flatpak.platform !== 'linux' ||
    flatpak.arch !== 'x64' ||
    flatpak.installedAndLaunched !== true
  )
    throw Error('Invalid Flatpak release verification');
  checkedArtifact(flatpak.artifact, `${prefix}-x86_64.flatpak`);
  for (let index = 0; index < targets.length; index++) {
    const [platform, arch] = targets[index];
    const report = JSON.parse(bytes(reportNames[index]).toString('utf8'));
    if (report.version !== pkg.version || !Array.isArray(report.artifacts))
      throw Error('Invalid full release verification version');
    const name =
      platform === 'win32'
        ? arch === 'ia32'
          ? 'Battly-Launcher-win-ia32.zip'
          : 'Battly-Launcher-win.zip'
        : platform === 'darwin'
          ? `Battly-Launcher-mac-${arch}.tar.gz`
          : linuxPackages[0];
    checkedArtifact(
      report.artifacts.find((entry) => entry.file === name),
      name,
    );
    if (platform === 'linux') {
      for (const file of linuxPackages) {
        checkedArtifact(
          report.artifacts.find((entry) => entry.file === file),
          file,
        );
      }
    }
  }
  const verifyFeed = (name, required, optional = []) => {
    const feed = yaml.load(bytes(name).toString('utf8'));
    if (
      !feed ||
      feed.version !== pkg.version ||
      !Array.isArray(feed.files) ||
      !feed.files.length ||
      feed.files.length > 20
    )
      throw Error('Invalid full updater feed version');
    const seen = new Set();
    for (const entry of feed.files) {
      if (
        !entry ||
        typeof entry.url !== 'string' ||
        !files.includes(entry.url) ||
        !expected.has(entry.url) ||
        seen.has(entry.url) ||
        (!required.includes(entry.url) && !optional.includes(entry.url))
      )
        throw Error('Unsafe or unexpected full updater feed file');
      seen.add(entry.url);
      const data = bytes(entry.url);
      if (
        !Number.isSafeInteger(entry.size) ||
        entry.size <= 0 ||
        data.length !== entry.size ||
        crypto.createHash('sha512').update(data).digest('base64') !== entry.sha512
      )
        throw Error('Full updater checksum mismatch');
    }
    if (required.some((file) => !seen.has(file)))
      throw Error('Missing installer or architecture in full updater feed');
    if (feed.path !== undefined && !required.includes(feed.path))
      throw Error('Invalid legacy updater path');
    if (
      feed.sha512 !== undefined &&
      feed.sha512 !== feed.files.find((entry) => entry.url === (feed.path || required[0]))?.sha512
    )
      throw Error('Invalid legacy updater checksum');
    return feed;
  };
  const winFeed = verifyFeed(feeds[0], windowsInstallers);
  if (winFeed.files[0].url !== installer) throw Error('Invalid Windows installer fallback order');
  verifyFeed(feeds[1], [linuxPackages[0]], linuxPackages.slice(1));
  const macPackages = [`Battly-Launcher-mac-x64.zip`, `Battly-Launcher-mac-arm64.zip`];
  verifyFeed(feeds[2], macPackages, [
    'Battly-Launcher-mac-x64.tar.gz',
    'Battly-Launcher-mac-arm64.tar.gz',
    'Battly-Launcher-mac-x64.dmg',
    'Battly-Launcher-mac-arm64.dmg',
  ]);
  const winReport = JSON.parse(bytes('verification-updater-win32-x64.json').toString('utf8'));
  const source = JSON.parse(bytes('official-installers.json').toString('utf8'));
  const publisher = pkg.build?.win?.signtoolOptions?.publisherName;
  if (
    typeof publisher !== 'string' ||
    !publisher.trim() ||
    winReport.version !== pkg.version ||
    winReport.publisherName !== publisher ||
    source.publisherName !== publisher ||
    source.schema !== 1 ||
    source.protocol !== 2 ||
    source.qa !== false ||
    source.repository !== 'BattlyLauncher/battlyinstaller' ||
    !/^[\w.-]+$/.test(source.tag || '') ||
    !Array.isArray(source.installers) ||
    source.installers.length !== 2 ||
    !Array.isArray(winReport.artifacts) ||
    winReport.artifacts.length !== 2
  )
    throw Error('Invalid pinned Windows updater verification');
  for (const [index, file] of windowsInstallers.entries()) {
    const arch = index === 0 ? 'x64' : 'ia32';
    const feedEntry = winFeed.files.find((entry) => entry.url === file);
    const proven = source.installers.find((entry) => entry.file === file && entry.arch === arch);
    const verified = winReport.artifacts.find(
      (entry) => entry.installer === file && entry.arch === arch,
    );
    if (
      !proven ||
      proven.sourceAsset !==
        (index === 0 ? 'Battly-Launcher-Windows.exe' : 'Battly-Launcher-win-ia32.exe') ||
      !verified ||
      verified.feed !== feeds[0] ||
      verified.sha512 !== feedEntry.sha512 ||
      verified.size !== feedEntry.size ||
      proven.sha512 !== feedEntry.sha512 ||
      proven.size !== feedEntry.size ||
      proven.blockmapSha256 !== digest(bytes(file + '.blockmap')) ||
      verified.blockmapSha256 !== proven.blockmapSha256
    )
      throw Error('Invalid pinned Windows updater verification');
  }
  const macReport = JSON.parse(bytes('verification-updater-darwin-x64.json').toString('utf8'));
  if (
    macReport.version !== pkg.version ||
    !Array.isArray(macReport.artifacts) ||
    !Array.isArray(macReport.dmgs) ||
    macReport.dmgs.length !== 2
  )
    throw Error('Invalid macOS updater verification');
  for (const arch of ['x64', 'arm64']) {
    const file = 'Battly-Launcher-mac-' + arch + '.dmg';
    const entry = macReport.dmgs.find((artifact) => artifact.arch === arch);
    checkedArtifact(entry, file);
    checkedArtifact(entry.blockmap, file + '.blockmap');
  }
  for (const [index, name] of macPackages.entries()) {
    const entry = macReport.artifacts.find((artifact) => artifact.file === name);
    const arch = index === 0 ? 'x64' : 'arm64';
    if (
      entry?.arch !== arch ||
      entry.feed !== feeds[2] ||
      entry.trust?.codeSignature !== true ||
      entry.trust?.packageIntegrity !== true ||
      entry.trust?.machO !== (arch === 'x64' ? 'x86_64' : 'arm64')
    )
      throw Error('Invalid macOS updater architecture or signature verification');
    checkedArtifact(entry, name);
  }
}
function publicationPlan(pkg, directory) {
  const update = releaseConfig(pkg),
    root = path.resolve(directory),
    files = fs.readdirSync(root);
  if (
    !files.length ||
    files.length > 950 ||
    files.some(
      (name) =>
        !/^[\w.+-]+$/.test(name) ||
        !fs.lstatSync(path.join(root, name)).isFile() ||
        fs.lstatSync(path.join(root, name)).isSymbolicLink(),
    )
  )
    throw Error('Invalid release files');
  const configs = targets.map(([platform, arch]) => {
    const name = `patch-base-${platform}-${arch}.json`;
    if (!files.includes(name)) throw Error('Missing installer baseline: ' + name);
    const config = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
    if (
      config.version !== pkg.version ||
      config.githubRepository !== update.repository ||
      config.platform !== platform ||
      config.arch !== arch ||
      config.baseBuild !== pkg.battlyBuild ||
      !config.publicKey
    )
      throw Error('Invalid installer baseline');
    return config;
  });
  let notes = update.notes;
  if (update.type === 'patch') {
    const expected = new Set(configs.map((c) => `patch-base-${c.platform}-${c.arch}.json`));
    let signedNotes;
    for (const config of configs) {
      const name = `patch-${config.runtimeId}-${update.channel}-${config.platform}-${config.arch}.json`;
      const m = verifyEnvelope(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')), config);
      if (
        m.type !== 'patch' ||
        m.patchVersion !== update.patchVersion ||
        m.channel !== update.channel ||
        m.build !== update.build
      )
        throw Error('Patch publication metadata mismatch');
      if (signedNotes !== undefined && signedNotes !== m.notes)
        throw Error('Signed patch release notes differ between platforms');
      signedNotes = m.notes;
      expected.add(name);
      for (const file of m.files) {
        const blob = `${file.sha256}.blob`,
          bytes = fs.readFileSync(path.join(root, blob));
        if (bytes.length !== file.size || digest(bytes) !== file.sha256)
          throw Error('Invalid release blob');
        expected.add(blob);
      }
    }
    notes = signedNotes;
    if (files.includes('release-notes.md')) {
      if (fs.readFileSync(path.join(root, 'release-notes.md'), 'utf8') !== signedNotes)
        throw Error('Release notes do not match the signed patch');
      expected.add('release-notes.md');
    }
    if (files.some((name) => !expected.has(name)))
      throw Error('Unexpected patch asset (installers and updater manifests are forbidden)');
  } else {
    verifyFullRelease(pkg, update, root, files);
  }
  return {
    ...update,
    notes,
    prerelease: update.type === 'patch' || update.channel === 'beta',
    files: files.map((name) => ({
      name,
      path: path.join(root, name),
      sha256: digest(fs.readFileSync(path.join(root, name))),
    })),
  };
}
async function publish(
  plan,
  {
    token,
    sha,
    fetcher = globalThis.fetch,
    notBefore = process.env.BATTLY_RELEASE_NOT_BEFORE,
    now = Date.now(),
  },
) {
  if (!publicationWindow(notBefore, now)) throw Error('Publication is held until the launch date');
  if (!token || !/^[a-f0-9]{40}$/.test(sha))
    throw Error('Publication requires token and exact commit');
  const api = `https://api.github.com/repos/${plan.repository}`;
  async function request(url, method = 'GET', body, binary = false) {
    const parsed = new URL(url);
    if (
      !['https://api.github.com', 'https://uploads.github.com'].includes(parsed.origin) ||
      !parsed.pathname.startsWith(`/repos/${plan.repository}/`)
    )
      throw Error('Invalid publication endpoint');
    const response = await fetcher(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': binary ? 'application/octet-stream' : 'application/json',
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw Error(`GitHub publication failed (${response.status})`);
    return response.json();
  }
  let release = await request(`${api}/releases/tags/${encodeURIComponent(plan.tag)}`);
  if (release && (!release.draft || release.target_commitish !== sha))
    throw Error('Release tag is already published or belongs to another commit');
  if (!release) {
    if (await request(`${api}/git/ref/tags/${encodeURIComponent(plan.tag)}`))
      throw Error('Tag already exists; refusing to publish different source');
    release = await request(`${api}/releases`, 'POST', {
      tag_name: plan.tag,
      target_commitish: sha,
      name: plan.patchVersion || plan.version,
      draft: true,
      prerelease: plan.prerelease,
      body:
        (plan.notes ? plan.notes + '\n\n<!-- battly-update\n' : '') +
        JSON.stringify(
          {
            type: plan.type,
            channel: plan.channel,
            baseVersion: plan.version,
            patchVersion: plan.patchVersion,
            build: plan.build,
            commit: sha,
          },
          null,
          2,
        ) +
        (plan.notes ? '\n-->' : ''),
    });
  }
  const existing = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await request(`${api}/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(rows)) throw Error('Invalid assets');
    existing.push(...rows);
    if (rows.length < 100) break;
    if (page === 10) throw Error('Too many assets');
  }
  if (existing.some((a) => !plan.files.some((f) => f.name === a.name)))
    throw Error('Draft has unexpected assets');
  for (const file of plan.files) {
    const previous = existing.find((a) => a.name === file.name);
    if (previous) {
      if (previous.digest !== `sha256:${file.sha256}` || previous.state !== 'uploaded')
        throw Error('Existing draft asset differs; no overwrite allowed');
      continue;
    }
    const uploaded = await request(
      `https://uploads.github.com/repos/${plan.repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,
      'POST',
      fs.readFileSync(file.path),
      true,
    );
    if (uploaded.digest !== `sha256:${file.sha256}` || uploaded.state !== 'uploaded')
      throw Error('Uploaded asset verification failed');
  }
  // The draft becomes visible only when the complete, locally verified set is present.
  return request(`${api}/releases/${release.id}`, 'PATCH', {
    draft: false,
    prerelease: plan.prerelease,
    make_latest: plan.prerelease ? 'false' : 'true',
  });
}
if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) throw Error('Provide a local release directory');
  const plan = publicationPlan(require('../package.json'), directory);
  if (process.argv.includes('--publish')) {
    if (process.env.GITHUB_REPOSITORY !== plan.repository)
      throw Error('Wrong publication repository');
    publish(plan, { token: process.env.GH_TOKEN, sha: process.env.GITHUB_SHA })
      .then((result) => console.log(result.html_url))
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
  } else
    console.log(
      JSON.stringify(
        { ...plan, files: plan.files.map((f) => ({ name: f.name, sha256: f.sha256 })) },
        null,
        2,
      ),
    );
}
module.exports = { publicationPlan, publish, targets };
