const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { stat, writeFile, mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const tar = require('tar');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  signingMode,
  signingCertificate,
  certificateRequirement,
} = require('./mac-signing-policy.cjs');
const { version, build } = require('../package.json');

function command(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function inspectSignature(app) {
  const details = spawnSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
  if (details.error || details.status !== 0) throw Error('Cannot inspect code signature');
  return `${details.stdout || ''}\n${details.stderr || ''}`;
}

function verifyPackage(app, run = command) {
  const asar = require('@electron/asar');
  const archive = path.join(app, 'Contents', 'Resources', 'app.asar');
  if (JSON.parse(asar.extractFile(archive, 'package.json')).version !== version) {
    throw Error('Packaged version mismatch');
  }
  run(process.execPath, [
    path.resolve(__dirname, 'verify-client-package.cjs'),
    archive,
    path.resolve(__dirname, '..'),
  ]);
}

/** The same signed bundle and packaged-code checks apply to both modes. */
async function verifyApp(app, arch, options = {}) {
  if ((options.platform || process.platform) !== 'darwin')
    throw Error('Final signature verification requires macOS.');
  if (!['x64', 'arm64'].includes(arch)) throw Error('Invalid macOS architecture');
  const mode = signingMode(options.env || process.env);
  const run = options.command || command;
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const signature = (options.inspectSignature || inspectSignature)(app);
  const adhoc = mode === 'adhoc';
  const runtime = /\bflags=0x[\da-f]+\([^\r\n)]*\bruntime\b/i.test(signature);
  if (adhoc) {
    if (!/^Signature=adhoc\s*$/m.test(signature) || /^Authority=/m.test(signature)) {
      throw Error('Expected a valid ad-hoc code signature for adhoc mode');
    }
  } else if (mode === 'self-signed') {
    const fingerprint = signingCertificate(options.env || process.env);
    const requirement = certificateRequirement(build.appId, fingerprint);
    const reported = run('codesign', ['-d', '-r-', app]);
    const designated = [...reported.matchAll(/^designated => (.+)$/gm)];
    if (designated.length !== 1 || designated[0][1].trim() !== requirement)
      throw Error('The app must designate the pinned macOS certificate and bundle ID.');
    const leaf = certificateRequirement(build.appId, fingerprint, 'leaf');
    run('codesign', ['--verify', '--deep', '--strict', '-R', '=' + leaf, app]);
  } else {
    if (
      !/^Authority=Developer ID Application:/m.test(signature) ||
      !/^TeamIdentifier=(?!not set\s*$)\S.+/m.test(signature) ||
      !runtime ||
      !/^Timestamp=.+/m.test(signature)
    ) {
      throw Error('Missing Developer ID, team, secure timestamp or hardened runtime');
    }
    run('xcrun', ['stapler', 'validate', app]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  }
  const binary = path.join(app, 'Contents', 'MacOS', build.productName);
  const cpu = run('lipo', ['-archs', binary]).trim().split(/\s+/);
  if (cpu.length !== 1 || cpu[0] !== (arch === 'x64' ? 'x86_64' : 'arm64')) {
    throw Error('Wrong Mach-O architecture: ' + cpu.join(' '));
  }
  await (options.verifyPackage || verifyPackage)(app, run);
  const developerId = mode === 'developer-id';
  return {
    signingMode: adhoc ? 'ad-hoc' : mode,
    codeSignature: true,
    adHoc: adhoc,
    developerId,
    hardenedRuntime: runtime,
    secureTimestamp: developerId,
    notarized: developerId,
    stapled: developerId,
    gatekeeper: developerId,
    packageIntegrity: true,
    machO: cpu[0],
  };
}

async function verifyTrust(target, arch, options = {}) {
  if ((options.platform || process.platform) !== 'darwin')
    throw Error('Final signature verification requires macOS.');
  signingMode(options.env || process.env);
  if (!['x64', 'arm64'].includes(arch)) throw Error('Invalid macOS architecture');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'battly-mac-verify-'));
  try {
    await tar.x({
      file: target,
      cwd: temp,
      strict: true,
      preserveOwner: false,
      filter: (name) => {
        if (path.isAbsolute(name) || name.split(/[\\/]/).includes('..'))
          throw Error('Unsafe archive path');
        return true;
      },
    });
    return await verifyApp(path.join(temp, build.productName + '.app'), arch, options);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(args = process.argv.slice(2), options = {}) {
  const mode = signingMode(options.env || process.env);
  const root = path.resolve(args[0] || `artifacts/releases/release-${version}`);
  const artifacts = [];
  const arches = args[1] ? args[1].split(',') : ['x64', 'arm64'];
  if (arches.some((arch) => !['x64', 'arm64'].includes(arch)))
    throw Error('Invalid macOS architecture');
  for (const arch of arches) {
    const file = `Battly-Launcher-mac-${arch}.tar.gz`;
    const target = path.join(root, file);
    const entries = new Set();
    await tar.t({
      file: target,
      onReadEntry: (entry) => entries.add(entry.path.replace(/^\.\//, '')),
    });
    for (const required of [
      `${build.productName}.app/Contents/Info.plist`,
      `${build.productName}.app/Contents/MacOS/${build.productName}`,
      `${build.productName}.app/Contents/Resources/app.asar`,
    ]) {
      if (!entries.has(required)) throw Error(`Incomplete macOS archive: ${file}: ${required}`);
    }
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    const trust = await verifyTrust(target, arch, options);
    artifacts.push({
      file,
      arch,
      trust,
      bytes: (await stat(target)).size,
      sha512: hash.digest('base64'),
    });
  }
  const report = { version, signingMode: mode === 'adhoc' ? 'ad-hoc' : mode, artifacts };
  await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    mode === 'developer-id'
      ? `Verified macOS archives: ${arches.join(', ')} (Developer ID, notarization ticket, Gatekeeper and architecture verified).`
      : `Verified macOS archives: ${arches.join(', ')} (${mode} signature, architecture and package integrity).`,
  );
  return report;
}

module.exports = { verifyApp, verifyTrust, verifyPackage, inspectSignature, main };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
