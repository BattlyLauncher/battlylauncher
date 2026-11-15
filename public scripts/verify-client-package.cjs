const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

function verify(archive, projectDir) {
  const contents = asar.listPackage(archive);
  for (const file of [
    'bootstrap/entry.cjs',
    'bootstrap/runtime-config.cjs',
    'dist/main/index.js',
    'dist/main/client/client-adapter.js',
    'dist/main/client/client-bridge.js',
    'dist/main/minecraft/minecraft-launcher-core-adapter.js',
    'dist/main/minecraft/minecraft-java-core-adapter.js',
    'dist/renderer/index.html',
  ]) {
    const entry = contents.find((value) => value.replaceAll('\\', '/').replace(/^\//, '') === file);
    if (!entry) throw new Error(`Incomplete Battly package: missing ${file}`);
    const packaged = asar.extractFile(archive, entry.slice(1));
    if (!packaged.equals(fs.readFileSync(path.join(projectDir, file)))) {
      throw new Error(`Stale Battly package: ${file} differs from compiled code`);
    }
  }
  console.log(
    'Battly Client package verified: bridge, engines, main and renderer match compiled code.',
  );
}

module.exports = async (context) => {
  const resources =
    context.electronPlatformName === 'darwin'
      ? path.join(
          context.appOutDir,
          context.packager.appInfo.productFilename + '.app',
          'Contents',
          'Resources',
        )
      : path.join(context.appOutDir, 'resources');
  verify(path.join(resources, 'app.asar'), context.packager.projectDir);
  if (context.packager.config.extraMetadata?.main !== 'qa-windows-updater-entry.cjs') {
    const entries = asar.listPackage(path.join(resources, 'app.asar'));
    if (entries.some((file) => file.includes('qa-windows-updater-entry.cjs')))
      throw Error('QA updater entry must never ship in production');
  }
};
if (require.main === module) verify(path.resolve(process.argv[2]), path.resolve(__dirname, '..'));
