'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const yaml = require('js-yaml');
const { gunzipSync } = require('node:zlib');
const { verifyApp } = require('./verify-mac-release.cjs');

function inspectArchive(bytes, productName) {
  const names = new Set();
  for (const entry of new AdmZip(bytes).getEntries()) {
    const name = entry.entryName;
    if (
      !name ||
      name.includes('\\') ||
      path.posix.isAbsolute(name) ||
      name.split('/').includes('..') ||
      name.includes('\0') ||
      ![productName + '.app', '__MACOSX'].some(
        (root) => name === root || name.startsWith(root + '/'),
      ) ||
      names.has(name)
    )
      throw Error('Unsafe macOS updater ZIP path');
    names.add(name);
    if (((entry.header.attr >>> 16) & 0xf000) === 0xa000) {
      const target = entry.getData().toString('utf8');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(name), target));
      if (
        path.posix.isAbsolute(target) ||
        target.includes('\\') ||
        target.includes('\0') ||
        !resolved.startsWith(productName + '.app/')
      )
        throw Error('Unsafe macOS updater ZIP symlink');
    }
  }
  for (const name of [
    'Contents/Info.plist',
    'Contents/MacOS/' + productName,
    'Contents/Resources/app.asar',
  ])
    if (!names.has(productName + '.app/' + name)) throw Error('Incomplete macOS updater ZIP');
}
function codeSign(args, execute = spawnSync) {
  const result = execute('codesign', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw Error('macOS code-signing requirement verification failed');
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}
function designatedRequirement(baseApp, execute) {
  codeSign(['--verify', '--deep', '--strict', baseApp], execute);
  const output = codeSign(['-d', '-r-', baseApp], execute);
  // codesign prints an implicit requirement as a source comment for ad-hoc bundles.
  const matches = [...output.matchAll(/^(?:# )?designated => (.+)$/gm)];
  if (
    matches.length !== 1 ||
    !matches[0][1].trim() ||
    matches[0][1].length > 16384 ||
    matches[0][1].includes('\0')
  )
    throw Error('Missing unique designated requirement for the base macOS app');
  return matches[0][1].trim();
}
async function verify(root, { version, productName, channel }, options = {}) {
  if ((options.platform || process.platform) !== 'darwin')
    throw Error('macOS updater signature verification requires macOS');
  const arches = options.arches || ['x64', 'arm64'];
  if (
    !arches.length ||
    arches.some((arch) => !['x64', 'arm64'].includes(arch)) ||
    new Set(arches).size !== arches.length
  )
    throw Error('Invalid macOS updater architectures');
  let requirement;
  if (options.baseApp !== undefined) {
    if (typeof options.baseApp !== 'string' || !options.baseApp.trim())
      throw Error('Invalid base macOS app path');
    const baseApp = path.resolve(options.baseApp);
    const baseInfo = await fs.lstat(baseApp);
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink())
      throw Error('Invalid base macOS app bundle');
    requirement = designatedRequirement(baseApp, options.codeSign);
  }
  const feedName = `${channel === 'beta' ? 'beta' : 'latest'}-mac.yml`;
  const feed = yaml.load(await fs.readFile(path.join(root, feedName), 'utf8'));
  if (!feed || feed.version !== version || !Array.isArray(feed.files))
    throw Error('Invalid macOS updater feed');
  const artifacts = [];
  const dmgs = [];
  for (const arch of arches) {
    const file = `Battly-Launcher-mac-${arch}.zip`;
    const entries = feed.files.filter((entry) => entry?.url === file);
    if (entries.length !== 1) throw Error('Missing unique macOS updater ZIP for ' + arch);
    const target = path.join(root, file);
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid macOS updater ZIP');
    const bytes = await fs.readFile(target);
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    if (bytes.length !== entries[0].size || sha512 !== entries[0].sha512)
      throw Error('macOS updater checksum mismatch');
    inspectArchive(bytes, productName);
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-mac-updater-verify-'));
    try {
      await (
        options.extract ||
        ((archive, destination) =>
          execFileSync('ditto', ['-x', '-k', archive, destination], { stdio: 'pipe' }))
      )(target, temporary);
      const trust = await (options.verifyApp || verifyApp)(
        path.join(temporary, productName + '.app'),
        arch,
        options,
      );
      if (requirement) {
        // Squirrel tests the new bundle against the installed app's requirement.
        // Pass it as one argument; never interpolate paths or requirements into a shell.
        codeSign(
          [
            '--verify',
            '--deep',
            '--strict',
            '-R',
            '=' + requirement,
            path.join(temporary, productName + '.app'),
          ],
          options.codeSign,
        );
      }
      artifacts.push({ file, arch, feed: feedName, bytes: bytes.length, sha512, trust });
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
    const dmg = `Battly-Launcher-mac-${arch}.dmg`;
    const targetDmg = path.join(root, dmg);
    const dmgStat = await fs.lstat(targetDmg);
    if (!dmgStat.isFile() || dmgStat.isSymbolicLink() || dmgStat.size <= 0) {
      throw Error('Invalid macOS disk image');
    }
    const dmgHash = createHash('sha512');
    for await (const chunk of createReadStream(targetDmg)) dmgHash.update(chunk);
    const mapName = dmg + '.blockmap';
    const mapStat = await fs.lstat(path.join(root, mapName));
    if (
      !mapStat.isFile() ||
      mapStat.isSymbolicLink() ||
      mapStat.size <= 0 ||
      mapStat.size > 4 * 1024 * 1024
    ) {
      throw Error('Invalid macOS disk image blockmap');
    }
    const mapBytes = await fs.readFile(path.join(root, mapName));
    const map = JSON.parse(
      gunzipSync(mapBytes, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8'),
    );
    if (
      !Array.isArray(map.files) ||
      map.files.length !== 1 ||
      map.files[0].offset !== 0 ||
      !Array.isArray(map.files[0].sizes) ||
      !Array.isArray(map.files[0].checksums) ||
      map.files[0].sizes.length !== map.files[0].checksums.length ||
      map.files[0].sizes.some((size) => !Number.isSafeInteger(size) || size <= 0) ||
      map.files[0].sizes.reduce((total, size) => total + size, 0) !== dmgStat.size
    ) {
      throw Error('macOS disk image blockmap does not match its size');
    }
    dmgs.push({
      arch,
      file: dmg,
      bytes: dmgStat.size,
      sha512: dmgHash.digest('base64'),
      blockmap: {
        file: mapName,
        bytes: mapBytes.length,
        sha512: createHash('sha512').update(mapBytes).digest('base64'),
      },
    });
  }
  return {
    version,
    artifacts,
    dmgs,
    squirrelContinuity: requirement
      ? {
          checked: true,
          requirementSha256: createHash('sha256').update(requirement).digest('hex'),
        }
      : { checked: false },
  };
}
module.exports = { inspectArchive, verify };
if (require.main === module) {
  const pkg = require('../package.json');
  const root = path.resolve(process.argv[2]);
  const baseOption = process.argv.slice(3).find((value) => value.startsWith('--base-app='));
  if (
    process.argv.slice(3).some((value) => !value.startsWith('--base-app=')) ||
    process.argv.slice(3).filter((value) => value.startsWith('--base-app=')).length > 1
  )
    throw Error('Use only the optional --base-app=/path/to/Installed.app argument');
  verify(
    root,
    {
      version: pkg.version,
      productName: pkg.build.productName,
      channel: pkg.battlyUpdate.channel,
    },
    baseOption === undefined ? {} : { baseApp: baseOption.slice('--base-app='.length) },
  )
    .then(async (report) => {
      await fs.writeFile(
        path.join(root, 'updater-verification-mac.json'),
        JSON.stringify(report, null, 2) + '\n',
      );
      console.log('macOS updater ZIP hashes, bundle signatures and architectures verified.');
      console.log(
        report.squirrelContinuity.checked
          ? 'The ZIP bundles also satisfy the provided base app signing requirement.'
          : 'Squirrel signing continuity was not checked; provide --base-app to verify it.',
      );
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
