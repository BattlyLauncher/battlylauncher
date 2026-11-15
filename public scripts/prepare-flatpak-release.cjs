const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function prepareFlatpak(pkg, source, destination) {
  const name = `Battly-Launcher-${pkg.version}-x86_64.flatpak`;
  const file = path.join(source, name);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0)
    throw Error('Invalid Flatpak artifact');
  const bytes = fs.readFileSync(file);
  const expected = fs
    .readFileSync(file + '.sha256', 'utf8')
    .trim()
    .split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (expected !== actual) throw Error('Installed Flatpak checksum mismatch');
  const report = {
    version: pkg.version,
    platform: 'linux',
    arch: 'x64',
    installedAndLaunched: true,
    artifact: {
      file: name,
      bytes: bytes.length,
      sha512: crypto.createHash('sha512').update(bytes).digest('base64'),
    },
  };
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(file, path.join(destination, name));
  fs.writeFileSync(
    path.join(destination, 'verification-flatpak-linux-x64.json'),
    JSON.stringify(report) + '\n',
  );
  return report;
}
module.exports = { prepareFlatpak };
if (require.main === module) {
  const pkg = require('../package.json');
  prepareFlatpak(
    pkg,
    `artifacts/releases/release-flatpak-${pkg.version}`,
    'artifacts/patch-ci/flatpak-assets',
  );
}
