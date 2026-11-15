const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const yaml = require('js-yaml');
const { verifySignature } = require('electron-updater/out/windowsExecutableCodeSignatureVerifier');
const sourceRepository = 'BattlyLauncher/battlyinstaller';
const installers = [
  {
    arch: 'x64',
    source: 'Battly-Launcher-Windows.exe',
    file: 'Battly-Launcher-win.exe',
    machine: 0x8664,
  },
  {
    arch: 'ia32',
    source: 'Battly-Launcher-win-ia32.exe',
    file: 'Battly-Launcher-win-ia32.exe',
    machine: 0x014c,
  },
];

function machine(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ')
    throw Error('Invalid installer PE');
  const offset = bytes.readUInt32LE(60);
  if (offset > bytes.length - 6 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0')
    throw Error('Invalid installer PE header');
  return bytes.readUInt16LE(offset + 4);
}

function executionLevel(bytes) {
  const { NtExecutable, NtExecutableResource } = require('resedit');
  const executable = NtExecutable.from(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { ignoreCert: true },
  );
  return NtExecutableResource.from(executable)
    .entries.filter((entry) => entry.type === 24)
    .some((entry) =>
      /<requestedExecutionLevel\b[^>]*\blevel\s*=\s*["']asInvoker["']/.test(
        Buffer.from(entry.bin).toString('utf8'),
      ),
    );
}

async function responseBytes(response, limit) {
  if (!response.ok) throw Error('Official installer download failed: ' + response.status);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('Official installer download exceeds limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function prepare({
  pkg,
  directory,
  fetchImpl = fetch,
  signature = verifySignature,
  execution = executionLevel,
  blockmap = async (file) =>
    require('app-builder-lib/out/targets/blockmap/blockmap').buildBlockMap(
      file,
      'gzip',
      file + '.blockmap',
    ),
  tag = process.env.BATTLY_OFFICIAL_INSTALLER_TAG,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
}) {
  directory = path.resolve(directory);
  if (tag && !/^[\w.-]+$/.test(tag)) throw Error('Invalid official installer tag');
  const endpoint = `https://api.github.com/repos/${sourceRepository}/releases/${tag ? 'tags/' + tag : 'latest'}`;
  const release = JSON.parse(
    (
      await responseBytes(
        await fetchImpl(endpoint, {
          headers: {
            'User-Agent': 'BattlyReleaseBuilder',
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: AbortSignal.timeout(30000),
        }),
        1024 * 1024,
      )
    ).toString('utf8'),
  );
  if (
    release.draft ||
    release.prerelease ||
    !/^[\w.-]+$/.test(release.tag_name || '') ||
    !Array.isArray(release.assets)
  )
    throw Error('Invalid official installer release');
  const download = async (name, limit) => {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length !== 1) throw Error('Missing unique official installer asset: ' + name);
    const asset = matches[0];
    const prefix = `https://github.com/${sourceRepository}/releases/download/${release.tag_name}/`;
    if (
      asset.browser_download_url !== prefix + name ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > limit
    )
      throw Error('Unsafe official installer asset');
    const bytes = await responseBytes(
      await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(120000) }),
      limit,
    );
    if (bytes.length !== asset.size) throw Error('Official installer asset size mismatch');
    if (
      asset.digest &&
      asset.digest !== 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    )
      throw Error('Official installer GitHub checksum mismatch');
    return bytes;
  };
  let protocol;
  try {
    protocol = JSON.parse((await download('installer-protocol.json', 65536)).toString('utf8'));
  } catch (cause) {
    throw Error(
      'The official installer release needs update protocol 2 and real x64/ia32 builds; publish the corrected installer first',
      { cause },
    );
  }
  if (
    protocol.schema !== 1 ||
    protocol.protocol !== 2 ||
    protocol.qa !== false ||
    !Array.isArray(protocol.installers)
  )
    throw Error('Unsupported official installer update protocol');
  const publisher = pkg.build.win.signtoolOptions.publisherName;
  const staging = await fs.mkdtemp(path.join(directory, '.official-installer-'));
  const records = [];
  try {
    for (const target of installers) {
      const bytes = await download(target.source, 64 * 1024 * 1024);
      const metadata = protocol.installers.find(
        (entry) => entry.file === target.source && entry.arch === target.arch,
      );
      const sha512 = createHash('sha512').update(bytes).digest('base64');
      if (
        machine(bytes) !== target.machine ||
        metadata?.sha512 !== sha512 ||
        metadata?.size !== bytes.length
      )
        throw Error(
          'Official installer architecture or protocol checksum mismatch: ' + target.source,
        );
      if (!execution(bytes))
        throw Error('Official installer must request elevation only when needed');
      const file = path.join(staging, target.file);
      await fs.writeFile(file, bytes);
      const error = await signature([publisher], file, { info() {}, warn() {}, error() {} });
      if (error) throw Error('Invalid official installer signature: ' + error);
      await blockmap(file);
      const map = await fs.readFile(file + '.blockmap');
      if (!map.length) throw Error('Empty official installer blockmap');
      records.push({
        file: target.file,
        arch: target.arch,
        sourceAsset: target.source,
        size: bytes.length,
        sha512,
        blockmapSha256: createHash('sha256').update(map).digest('hex'),
      });
    }
    // Keep the architecture-specific 3.0.1 download name without adding a duplicate feed entry.
    for (const suffix of ['', '.blockmap']) {
      await fs.copyFile(
        path.join(staging, 'Battly-Launcher-win.exe' + suffix),
        path.join(staging, 'Battly-Launcher-win-x64.exe' + suffix),
      );
    }
    const channel = pkg.battlyUpdate.channel === 'beta' ? 'beta' : 'latest';
    const feed = {
      version: pkg.version,
      files: records.map(({ file, sha512, size }) => ({ url: file, sha512, size })),
      path: records[0].file,
      sha512: records[0].sha512,
      releaseDate: new Date().toISOString(),
    };
    const provenance = {
      schema: 1,
      protocol: 2,
      qa: false,
      repository: sourceRepository,
      tag: release.tag_name,
      publisherName: publisher,
      installers: records,
    };
    await fs.writeFile(path.join(staging, channel + '.yml'), yaml.dump(feed));
    await fs.writeFile(
      path.join(staging, 'official-installers.json'),
      JSON.stringify(provenance, null, 2) + '\n',
    );
    for (const name of await fs.readdir(staging))
      await fs.copyFile(path.join(staging, name), path.join(directory, name));
    return provenance;
  } finally {
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
module.exports = { prepare, machine, executionLevel, installers };
if (require.main === module)
  prepare({ pkg: require('../package.json'), directory: path.resolve(process.argv[2]) })
    .then((report) =>
      console.log(`Verified official installers from ${report.repository}@${report.tag}`),
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
