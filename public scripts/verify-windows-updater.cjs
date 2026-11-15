const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { verifySignature } = require('electron-updater/out/windowsExecutableCodeSignatureVerifier');

async function verify(root, version, publisher, signature = verifySignature) {
  const names = (await fs.readdir(root)).filter((name) => /^(latest|beta)\.yml$/.test(name));
  if (!names.length) throw Error('Missing Windows updater feed');
  const aliasFiles = ['Battly-Launcher-win-x64.exe', 'Battly-Launcher-win-x64.exe.blockmap'];
  const aliasPresent = await Promise.all(
    aliasFiles.map(async (name) => {
      try {
        await fs.stat(path.join(root, name));
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    }),
  );
  // Older releases have no alias. New publication checks require it separately.
  if (aliasPresent.some(Boolean)) {
    if (!aliasPresent.every(Boolean)) throw Error('Incomplete Windows x64 alias');
    for (const [index, name] of aliasFiles.entries()) {
      const alias = await fs.readFile(path.join(root, name));
      const canonical = await fs.readFile(
        path.join(root, 'Battly-Launcher-win.exe' + (index === 1 ? '.blockmap' : '')),
      );
      if (!alias.equals(canonical))
        throw Error('Windows x64 alias differs from the official installer');
    }
  }
  const results = [];
  for (const name of names) {
    const metadata = yaml.load(await fs.readFile(path.join(root, name), 'utf8'));
    if (metadata.version !== version || !metadata.files?.length)
      throw Error('Invalid updater version');
    const expected = ['Battly-Launcher-win.exe', 'Battly-Launcher-win-ia32.exe'];
    if (
      metadata.files.length !== 2 ||
      metadata.files[0].url !== expected[0] ||
      expected.some((name) => metadata.files.filter((entry) => entry.url === name).length !== 1)
    )
      throw Error('Missing unique official Windows installers');
    for (const entry of metadata.files) {
      if (path.basename(entry.url) !== entry.url) throw Error('Unsafe installer path');
      const file = path.join(root, entry.url);
      const bytes = await fs.readFile(file);
      if (
        bytes.length !== entry.size ||
        createHash('sha512').update(bytes).digest('base64') !== entry.sha512
      )
        throw Error('Updater checksum mismatch');
      const blockmap = await fs.stat(file + '.blockmap');
      if (!blockmap.size) throw Error('Empty installer blockmap');
      const error = await signature([publisher], file, { info() {}, warn() {}, error() {} });
      if (error) throw Error('Invalid installer signature: ' + error);
      const map = await fs.readFile(file + '.blockmap');
      results.push({
        feed: name,
        installer: entry.url,
        arch: entry.url.includes('ia32') ? 'ia32' : 'x64',
        size: bytes.length,
        sha512: entry.sha512,
        blockmapSha256: createHash('sha256').update(map).digest('hex'),
      });
    }
  }
  return results;
}
module.exports = { verify };
if (require.main === module) {
  const pkg = require('../package.json');
  const root = path.resolve(process.argv[2]);
  verify(root, pkg.version, pkg.build.win.signtoolOptions.publisherName)
    .then(async (artifacts) => {
      await fs.writeFile(
        path.join(root, 'updater-verification.json'),
        JSON.stringify({ artifacts, checkedAt: new Date().toISOString() }, null, 2),
      );
      console.log('Signed Windows updater feeds, checksums and blockmaps verified.');
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
