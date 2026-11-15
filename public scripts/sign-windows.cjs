const { execFile } = require('node:child_process');
const { access, readFile } = require('node:fs/promises');
const { basename, dirname, join } = require('node:path');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');

const run = promisify(execFile);

// Same Trusted Signing flow as sign.bat, without pause or success on failure.
module.exports = async ({ path: target }) => {
  // This release asset is pinned by its manifest and downloaded from GitHub.
  // Authenticode changes its bytes: retain the published binary inside the signed installer.
  if (basename(dirname(target)) === 'terracotta' && basename(target) === 'terracotta-battly.exe') {
    const manifest = JSON.parse(await readFile(join(dirname(target), 'manifest.json'), 'utf8'));
    const actual = createHash('sha256')
      .update(await readFile(target))
      .digest('hex');
    if (manifest.executable !== basename(target) || actual !== manifest.sha256)
      throw Error('Terracotta release integrity failed before signing');
    return;
  }
  const names = ['BATTLY_SIGNTOOL', 'BATTLY_SIGNING_DLIB', 'BATTLY_SIGNING_METADATA'];
  const paths = names.map((name) => {
    if (!process.env[name]) throw new Error(`Missing release signing configuration: ${name}`);
    return process.env[name];
  });
  await Promise.all([...paths, target].map((file) => access(file)));
  const [tool, library, metadata] = paths;
  const options = { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 };
  await run(
    tool,
    [
      'sign',
      '/fd',
      'SHA256',
      '/tr',
      'http://timestamp.acs.microsoft.com',
      '/td',
      'SHA256',
      '/dlib',
      library,
      '/dmdf',
      metadata,
      target,
    ],
    options,
  );
  await run(tool, ['verify', '/pa', target], options);
};
