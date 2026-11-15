'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseConfig } = require('./patch-release-config.cjs');
const { targets } = require('./publish-battly-update.cjs');
const yaml = require('js-yaml');

function packagePlan(pkg, platform, arch) {
  const update = releaseConfig(pkg);
  if (update.type !== 'full') throw Error('Only full releases can package native installers');
  if (!targets.some((target) => target[0] === platform && target[1] === arch))
    throw Error('Unsupported base target');
  // One Windows job owns the universal installer and feed; ia32 exports its ZIP only.
  const universal = platform === 'win32' && arch === 'x64';
  const macUniversal = platform === 'darwin' && arch === 'x64';
  const builderArguments = [
    'node_modules/electron-builder/out/cli/cli.js',
    '--config',
    'electron-builder.release.cjs',
    ...(universal
      ? ['--win', 'zip', '--x64', '--ia32']
      : platform === 'win32'
        ? ['--win', 'zip', '--ia32']
        : macUniversal
          ? ['--mac', 'zip', 'tar.gz', 'dmg', '--x64', '--arm64']
          : platform === 'darwin'
            ? ['--mac', 'tar.gz', `--${arch}`]
            : ['--linux', `--${arch}`]),
    '--publish',
    'never',
  ];
  return { update, platform, arch, universal, macUniversal, builderArguments };
}
function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Base package verification failed');
}
function regularBytes(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid base package file');
  return fs.readFileSync(file);
}
function normalizeMacUpdaterFeed(directory, version, channel) {
  const file = path.join(directory, `${channel === 'beta' ? 'beta' : 'latest'}-mac.yml`);
  const feed = yaml.load(regularBytes(file).toString('utf8'));
  const names = ['x64', 'arm64'].map((arch) => `Battly-Launcher-mac-${arch}.zip`);
  if (feed?.version !== version || !Array.isArray(feed.files))
    throw Error('Invalid macOS updater feed');
  const files = names.map((name) => {
    const entries = feed.files.filter((entry) => entry?.url === name);
    if (entries.length !== 1) throw Error('Missing unique macOS updater ZIP: ' + name);
    return entries[0];
  });
  // DMGs are manual installers; the updater keeps using architecture-specific ZIPs.
  fs.writeFileSync(file, yaml.dump({ ...feed, files, path: names[0], sha512: files[0].sha512 }));
}
function packageBase({
  pkg,
  platform,
  arch,
  directory = `artifacts/releases/release-${pkg.version}`,
  destination = 'artifacts/patch-ci/github-assets',
  execute = run,
}) {
  const plan = packagePlan(pkg, platform, arch);
  const exported = new Map();
  const collect = (source, target = source) =>
    exported.set(target, regularBytes(path.join(directory, source)));
  if (platform === 'darwin') execute(process.execPath, ['public scripts/check-mac-signing.cjs']);
  execute(process.execPath, plan.builderArguments);
  if (platform === 'win32') {
    for (const verifiedArch of plan.universal ? ['x64', 'ia32'] : ['ia32']) {
      execute(process.execPath, [
        'public scripts/verify-release.cjs',
        directory,
        `--arch=${verifiedArch}`,
      ]);
      // Capture the current job's report before verification of the other arch replaces it.
      if (verifiedArch === arch) {
        const report = JSON.parse(
          regularBytes(path.join(directory, 'verification.json')).toString('utf8'),
        );
        for (const entry of report.artifacts ?? []) {
          if (entry.file === `Battly-Launcher-${pkg.version}-${arch}.zip`)
            entry.file =
              arch === 'ia32' ? 'Battly-Launcher-win-ia32.zip' : 'Battly-Launcher-win.zip';
        }
        exported.set(
          `verification-${platform}-${arch}.json`,
          Buffer.from(JSON.stringify(report) + '\n'),
        );
      }
    }
    collect(
      `Battly-Launcher-${pkg.version}-${arch}.zip`,
      arch === 'ia32' ? 'Battly-Launcher-win-ia32.zip' : 'Battly-Launcher-win.zip',
    );
    if (plan.universal) {
      const publisher = pkg.build?.win?.signtoolOptions?.publisherName;
      if (typeof publisher !== 'string' || !publisher.trim())
        throw Error('Missing pinned Windows publisher');
      execute(process.execPath, ['public scripts/prepare-official-windows.cjs', directory]);
      execute(process.execPath, ['public scripts/verify-windows-updater.cjs', directory]);
      const report = JSON.parse(
        regularBytes(path.join(directory, 'updater-verification.json')).toString('utf8'),
      );
      exported.set(
        'verification-updater-win32-x64.json',
        Buffer.from(
          JSON.stringify({ ...report, version: pkg.version, publisherName: publisher }) + '\n',
        ),
      );
      for (const name of [
        'Battly-Launcher-win.exe',
        'Battly-Launcher-win-x64.exe',
        'Battly-Launcher-win-ia32.exe',
        'official-installers.json',
      ])
        collect(name);
      for (const name of [
        'Battly-Launcher-win.exe.blockmap',
        'Battly-Launcher-win-x64.exe.blockmap',
        'Battly-Launcher-win-ia32.exe.blockmap',
      ])
        collect(name);
      collect(plan.update.channel === 'beta' ? 'beta.yml' : 'latest.yml');
    }
  } else {
    execute(
      process.execPath,
      platform === 'darwin'
        ? ['public scripts/verify-mac-release.cjs', directory, arch]
        : ['public scripts/verify-release.cjs', directory, '--linux'],
    );
    collect('verification.json', `verification-${platform}-${arch}.json`);
    if (platform === 'darwin') {
      collect(`Battly-Launcher-mac-${arch}.tar.gz`);
      if (plan.macUniversal) {
        normalizeMacUpdaterFeed(directory, pkg.version, plan.update.channel);
        execute(process.execPath, ['public scripts/verify-mac-updater.cjs', directory]);
        collect('updater-verification-mac.json', 'verification-updater-darwin-x64.json');
        for (const zipArch of ['x64', 'arm64']) {
          const zip = `Battly-Launcher-mac-${zipArch}.zip`;
          collect(zip);
          if (fs.existsSync(path.join(directory, zip + '.blockmap'))) collect(zip + '.blockmap');
          collect(`Battly-Launcher-mac-${zipArch}.dmg`);
          collect(`Battly-Launcher-mac-${zipArch}.dmg.blockmap`);
        }
        collect(`${plan.update.channel === 'beta' ? 'beta' : 'latest'}-mac.yml`);
      }
    } else {
      for (const name of [
        'Battly-Launcher-linux-x86_64.AppImage',
        'Battly-Launcher-linux-amd64.deb',
        'Battly-Launcher-linux-x86_64.rpm',
        'Battly-Launcher-linux-x64.tar.gz',
      ]) {
        collect(name);
      }
      collect(`${plan.update.channel === 'beta' ? 'beta' : 'latest'}-linux.yml`);
    }
  }
  // Validate the complete selection before writing anything into the artifact directory.
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, bytes] of exported) {
    const target = path.join(destination, name);
    if (fs.existsSync(target) && !regularBytes(target).equals(bytes))
      throw Error('Conflicting base artifact: ' + name);
  }
  for (const [name, bytes] of exported) fs.writeFileSync(path.join(destination, name), bytes);
  return [...exported.keys()];
}
module.exports = { packagePlan, packageBase };
if (require.main === module)
  packageBase({
    pkg: require('../package.json'),
    platform: process.argv[2] || process.env.BATTLY_PATCH_PLATFORM || process.platform,
    arch: process.argv[3] || process.env.BATTLY_PATCH_ARCH || process.arch,
  });
