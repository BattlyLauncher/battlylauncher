const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createReadStream } = require('node:fs');
const { readFile, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');
const AdmZip = require('adm-zip');
const { verifySignature } = require('electron-updater/out/windowsExecutableCodeSignatureVerifier');

async function verifyRelease() {
  const expected = require('../package.json');
  const root = path.resolve(process.argv[2] || `artifacts/releases/release-${expected.version}`);
  const arch = process.argv.find((value) => value.startsWith('--arch='))?.slice(7) || 'x64';
  if (!['x64', 'ia32'].includes(arch)) throw new Error('Unsupported Windows release architecture');
  const unpacked = path.resolve(
    process.argv.find((value) => value.startsWith('--unpacked='))?.slice(11) ||
      path.join(root, arch === 'ia32' ? 'win-ia32-unpacked' : 'win-unpacked'),
  );
  const linux = process.argv.includes('--linux');
  const manifest = linux
    ? yaml.load(
        await readFile(
          path.join(
            root,
            `${expected.battlyUpdate?.channel === 'beta' ? 'beta' : 'latest'}-linux.yml`,
          ),
          'utf8',
        ),
      )
    : {
        version: expected.version,
        files: [{ url: `Battly-Launcher-${expected.version}-${arch}.zip` }],
      };
  if (manifest.version !== expected.version || !manifest.files?.length) {
    throw new Error('Missing artifacts or incorrect release version');
  }
  const linuxNames = [
    'Battly-Launcher-linux-x86_64.AppImage',
    'Battly-Launcher-linux-amd64.deb',
    'Battly-Launcher-linux-x86_64.rpm',
    'Battly-Launcher-linux-x64.tar.gz',
  ];
  if (
    linux &&
    (manifest.files.some((entry) => !linuxNames.includes(entry.url)) ||
      new Set(manifest.files.map((entry) => entry.url)).size !== manifest.files.length ||
      !manifest.files.some((entry) => entry.url === linuxNames[0]))
  ) {
    throw new Error('Unexpected Linux release artifacts');
  }
  const artifacts = linux
    ? linuxNames.map((url) => manifest.files.find((entry) => entry.url === url) || { url })
    : manifest.files;
  const results = [];
  for (const entry of artifacts) {
    if (entry.url !== path.basename(entry.url)) throw new Error('Unexpected artifact path');
    const file = path.join(root, entry.url);
    const info = await stat(file);
    const digest = createHash('sha512');
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    const sha512 = digest.digest('base64');
    if (
      linux &&
      manifest.files.includes(entry) &&
      (sha512 !== entry.sha512 || info.size !== entry.size)
    ) {
      throw new Error(`Update metadata does not match ${entry.url}`);
    }
    if (linux && entry.url.endsWith('.deb')) {
      const { stdout: dependencies } = await promisify(execFile)('dpkg-deb', [
        '--field',
        file,
        'Depends',
      ]);
      if (!/\blibasound2(?:t64)?\b/.test(dependencies) || !/\blibgbm1\b/.test(dependencies)) {
        throw new Error(`Missing Electron audio or graphics dependency in ${entry.url}`);
      }
      const { stdout: architecture } = await promisify(execFile)('dpkg-deb', [
        '--field',
        file,
        'Architecture',
      ]);
      if (architecture.trim() !== 'amd64') {
        throw new Error(`Debian package architecture does not match amd64: ${entry.url}`);
      }
    }
    if (!linux) {
      if (process.platform !== 'win32')
        throw new Error('Windows signature verification requires Windows');
      const publishers = [expected.build.win.signtoolOptions.publisherName];
      const executable = entry.url.endsWith('.zip')
        ? path.join(unpacked, `${expected.build.productName}.exe`)
        : file;
      const binary = await readFile(executable);
      const pe = binary.length >= 64 ? binary.readUInt32LE(60) : -1;
      if (
        pe < 0 ||
        pe + 6 > binary.length ||
        binary.toString('ascii', pe, pe + 4) !== 'PE\0\0' ||
        binary.readUInt16LE(pe + 4) !== (arch === 'ia32' ? 0x14c : 0x8664)
      ) {
        throw new Error(`Executable architecture does not match ${arch}`);
      }
      if (entry.url.endsWith('.zip')) {
        const archive = new AdmZip(file);
        const app = archive.getEntry(`${expected.build.productName}.exe`);
        if (!app || !app.getData().equals(await readFile(executable))) {
          throw new Error('ZIP does not contain the verified application executable');
        }
        for (const required of ['resources/app.asar', 'icudtl.dat', 'resources.pak']) {
          const resource = archive.getEntry(required);
          if (
            !resource ||
            !resource.getData().equals(await readFile(path.join(unpacked, required)))
          ) {
            throw new Error(`ZIP is missing or has altered compiled content: ${required}`);
          }
        }
      } else if (!entry.url.endsWith('.exe')) {
        throw new Error(`Unexpected Windows artifact: ${entry.url}`);
      }
      const error = await verifySignature(publishers, executable, {
        info() {},
        warn() {},
        error() {},
      });
      if (error) throw new Error(`Invalid release publisher or signature: ${entry.url}`);
      const { stdout } = await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$ErrorActionPreference = "Stop"; Import-Module "$PSHOME/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1"; (Get-AuthenticodeSignature -LiteralPath $env:BATTLY_VERIFY_FILE).Status.ToString()',
        ],
        {
          env: { ...process.env, BATTLY_VERIFY_FILE: executable },
          windowsHide: true,
          timeout: 60000,
        },
      );
      if (stdout.trim() !== 'Valid')
        throw new Error(`Authenticode verification failed: ${entry.url}`);
    }
    results.push({ file: entry.url, bytes: info.size, sha512 });
  }
  const report = {
    version: expected.version,
    checkedAt: new Date().toISOString(),
    artifacts: results,
  };
  await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Verified ${results.length} release artifacts${linux ? '' : ', compiled ZIP content and signature'}.`,
  );
}

verifyRelease().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
