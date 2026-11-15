const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

async function publishRuntime(
  staging,
  directory,
  executable,
  io = fs,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await io.rename(staging, directory);
      return;
    } catch (error) {
      // A concurrent start can publish the same complete runtime first.
      try {
        await io.access(path.join(directory, 'ready.json'));
        await io.access(executable);
        return;
      } catch {
        /* Never reuse an incomplete destination. */
      }
      if (
        !['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'].includes(error.code) ||
        attempt >= 8
      ) {
        error.message +=
          '\nNo se pudo preparar Battly. Cierra las otras ventanas de Battly y revisa el informe del antivirus si ha bloqueado el ejecutable.';
        throw error;
      }
      await wait(Math.min(250 * (attempt + 1), 1500));
    }
  }
}

async function prepareDevRuntime() {
  const electron = require('electron');
  if (process.platform !== 'win32') return electron;
  const pkg = require('../package.json');
  const icon = await fs.readFile(path.join(root, pkg.build.win.icon));
  const source = await fs.stat(electron);
  const fingerprint = createHash('sha256')
    .update(icon)
    .update(
      JSON.stringify({
        format: 1,
        product: pkg.productName,
        version: pkg.version,
        electron: require('electron/package.json').version,
        arch: process.arch,
        size: source.size,
        modified: source.mtimeMs,
        changed: source.ctimeMs,
      }),
    )
    .digest('hex')
    .slice(0, 20);
  const cache = path.join(root, '.battly-dev-runtime');
  const directory = path.join(cache, fingerprint);
  const filename = `${pkg.productName}.exe`;
  const executable = path.join(directory, filename);
  try {
    await fs.access(path.join(directory, 'ready.json'));
    await fs.access(executable);
    return executable;
  } catch {
    /* Prepare a fresh runtime without touching installed Electron. */
  }

  await fs.mkdir(cache, { recursive: true });
  const staging = await fs.mkdtemp(path.join(cache, 'preparing-'));
  try {
    await fs.cp(path.dirname(electron), staging, { recursive: true });
    const ResEdit = require('resedit');
    const original = path.join(staging, path.basename(electron));
    const pe = ResEdit.NtExecutable.from(await fs.readFile(original));
    const resources = ResEdit.NtExecutableResource.from(pe);
    const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
    if (!versions.length) versions.push(ResEdit.Resource.VersionInfo.createEmpty());
    for (const version of versions) {
      version.setFileVersion(pkg.version);
      version.setProductVersion(pkg.version);
      const languages = version.getAllLanguagesForStringValues();
      if (!languages.length) languages.push({ lang: 1033, codepage: 1200 });
      for (const language of languages)
        version.setStringValues(language, {
          FileDescription: pkg.productName,
          ProductName: pkg.productName,
          CompanyName: 'TECNO BROS',
          InternalName: pkg.productName,
          OriginalFilename: filename,
          FileVersion: pkg.version,
          ProductVersion: pkg.version,
        });
      version.outputToResourceEntries(resources.entries);
    }
    const icons = ResEdit.Data.IconFile.from(icon).icons.map((item) => item.data);
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
    for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        group.id,
        group.lang,
        icons,
      );
    }
    resources.outputResource(pe);
    await fs.writeFile(path.join(staging, filename), Buffer.from(pe.generate()));
    await fs.unlink(original);
    await fs.writeFile(path.join(staging, 'ready.json'), JSON.stringify({ fingerprint, filename }));
    await publishRuntime(staging, directory, executable);
    return executable;
  } finally {
    // The generated staging directory is the only recursive-cleanup target.
    if (
      path.dirname(path.resolve(staging)) !== cache ||
      !path.basename(staging).startsWith('preparing-')
    ) {
      throw new Error('Invalid development runtime staging path');
    }
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function startDev() {
  const executable = await prepareDevRuntime();
  if (process.argv.includes('--prepare-only')) {
    console.log(executable);
    return;
  }
  const env = { ...process.env, BATTLY_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, ['.', ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const interrupt = () => {
    if (child.exitCode === null) child.kill();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  child.once('error', (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.exitCode = code ?? (signal ? 130 : 1);
  });
}

module.exports = { prepareDevRuntime, publishRuntime };
if (require.main === module)
  startDev().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
