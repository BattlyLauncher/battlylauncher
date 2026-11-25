'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash, safePath, atomicJson, verifyEnvelope } = require('../bootstrap/patch-runtime.cjs');
const { releaseConfig } = require('./patch-release-config.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
function files(at, prefix = '') {
  const result = [];
  for (const entry of fs
    .readdirSync(at, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('No se admiten enlaces: ' + rel);
    if (entry.isDirectory()) result.push(...files(path.join(at, entry.name), rel + '/'));
    else result.push(rel);
  }
  return result;
}
function runtimeId(pkg, publicKey, feed) {
  const runtime = crypto.createHash('sha256');
  runtime.update('battly-runtime-v2\0');
  for (const name of [
    'package-lock.json',
    'bootstrap/entry.cjs',
    'bootstrap/patch-runtime.cjs',
    'bootstrap/runtime-config.cjs',
    'bootstrap/github-patch-feed.cjs',
    ...files(path.join(root, 'build-resources'))
      .filter((file) => !/(?:^|\/)README\.md$/.test(file))
      .filter((file) => !/^battly-tunnel\/[^/]+\/battly-tunnel-client(?:\.exe)?$/.test(file))
      .filter(
        (file) => !/^terracotta\/(?:terracotta(?:-battly)?\.exe|linux-x64\/terracotta)$/.test(file),
      )
      .filter((file) => file !== 'worlds-overlay/WindowTracker.exe')
      .map((file) => 'build-resources/' + file),
  ]) {
    const content = fs.readFileSync(path.join(root, name));
    const text =
      /\.(?:cjs|js|json|java|cs|pem|plist|nsh|patch|md|txt|ya?ml|xml|sh|ps1|bat|toml|properties|cfg|ini|gradle)$/i.test(
        name,
      ) || /(?:^|\/)LICENSE(?:\.[\w-]+)?$/i.test(name);
    // Git checkout can change text line endings; native binaries keep their exact bytes.
    const canonical = text
      ? Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
      : content;
    runtime.update(name).update(canonical);
  }
  runtime.update(
    JSON.stringify({
      version: pkg.version,
      build: pkg.battlyBuild,
      main: pkg.main,
      dependencies: pkg.dependencies,
      packaging: pkg.build,
      publicKey,
      feed,
    }),
  );
  return runtime.digest('hex');
}
if (args[0] === 'keygen') {
  const out = option('--out');
  if (!out) throw Error('Indica --out fuera del repositorio');
  const dir = path.resolve(out);
  if (dir === root || dir.startsWith(root + path.sep))
    throw Error('Guarda la clave privada fuera del repositorio');
  fs.mkdirSync(dir, { recursive: true });
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(
    path.join(dir, 'patch-private.pem'),
    pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(dir, 'patch-public.pem'),
    pair.publicKey.export({ type: 'spki', format: 'pem' }),
    { flag: 'wx' },
  );
  console.log('Claves creadas. Solo la clave pública se incluye en el instalador.');
} else if (args[0] === 'config') {
  const pkg = require('../package.json');
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(path.join(root, 'bootstrap/config.json'), 'utf8'));
  } catch {
    /* First build */
  }
  const publicKeyInput = process.env.BATTLY_PATCH_PUBLIC_KEY_FILE
    ? fs.readFileSync(process.env.BATTLY_PATCH_PUBLIC_KEY_FILE, 'utf8')
    : saved.publicKey || '';
  const publicKey = publicKeyInput
    ? crypto.createPublicKey(publicKeyInput).export({ type: 'spki', format: 'pem' })
    : '';
  const feed = process.env.BATTLY_PATCH_FEED || saved.feed || '';
  const githubRepository = pkg.battlyUpdate?.repository;
  if (githubRepository) releaseConfig(pkg);
  if (
    githubRepository &&
    pkg.battlyUpdate.type === 'patch' &&
    !process.env.BATTLY_PATCH_BASE_CONFIG_FILE
  )
    throw Error(
      'A GitHub patch requires BATTLY_PATCH_BASE_CONFIG_FILE from its full installer release',
    );
  if (publicKey && crypto.createPublicKey(publicKey).asymmetricKeyType !== 'ed25519')
    throw Error('Se necesita una clave Ed25519');
  if (!Number.isSafeInteger(pkg.battlyBuild) || pkg.battlyBuild < 1)
    throw Error('battlyBuild debe ser un entero positivo');
  if (feed) {
    const url = new URL(feed);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw Error('El feed debe ser una URL HTTPS sin credenciales, consulta ni fragmento');
  }
  const identityFeed = githubRepository ? `github:${githubRepository}` : feed;
  const config = {
    schema: 1,
    runtimeId: runtimeId(pkg, publicKey, identityFeed),
    baseBuild: pkg.battlyBuild,
    version: pkg.version,
    platform: process.env.BATTLY_PATCH_PLATFORM || process.platform,
    arch: process.env.BATTLY_PATCH_ARCH || process.arch,
    publicKey,
    feed: githubRepository ? '' : feed,
    ...(githubRepository ? { githubRepository } : {}),
  };
  if (process.env.BATTLY_PATCH_BASE_CONFIG_FILE) {
    const baseline = JSON.parse(fs.readFileSync(process.env.BATTLY_PATCH_BASE_CONFIG_FILE, 'utf8'));
    for (const key of [
      'schema',
      'runtimeId',
      'baseBuild',
      'version',
      'platform',
      'arch',
      'publicKey',
      'feed',
      'githubRepository',
    ])
      if (baseline[key] !== config[key])
        throw Error(`Base installer mismatch (${key}); publish a full version`);
  }
  atomicJson(path.join(root, 'bootstrap/config.json'), config);
  console.log(
    publicKey && (feed || githubRepository)
      ? 'Bootstrap de parches configurado.'
      : 'Bootstrap creado; parches desactivados hasta configurar firma y feed.',
  );
} else if (args[0] === 'release') {
  const config = require('../bootstrap/config.json');
  const pkg = require('../package.json');
  if (
    runtimeId(
      pkg,
      config.publicKey,
      config.githubRepository ? `github:${config.githubRepository}` : config.feed,
    ) !== config.runtimeId
  )
    throw Error(
      'El runtime ha cambiado: genera un nuevo instalador base, no un parche para el anterior.',
    );
  const metadata = pkg.battlyUpdate?.type === 'patch' ? releaseConfig(pkg) : undefined;
  const build = Number(option('--build') || metadata?.build);
  const out = option('--out');
  const keyPath = process.env.BATTLY_PATCH_PRIVATE_KEY_FILE;
  if (!out || !keyPath || !Number.isSafeInteger(build) || build <= config.baseBuild)
    throw Error('Usa release --build N --out carpeta y BATTLY_PATCH_PRIVATE_KEY_FILE');
  const channel = option('--channel') || metadata?.channel;
  if (!['stable', 'beta'].includes(channel))
    throw Error('Indica --channel stable o --channel beta');
  if (metadata && (build !== metadata.build || channel !== metadata.channel))
    throw Error('Patch arguments must match package.json');
  const createdAt =
    process.env.SOURCE_DATE_EPOCH === undefined
      ? Date.now()
      : Number(process.env.SOURCE_DATE_EPOCH) * 1000;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw Error('Invalid SOURCE_DATE_EPOCH');
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (
    crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !==
    crypto.createPublicKey(config.publicKey).export({ type: 'spki', format: 'pem' })
  )
    throw Error('Signing key does not match the base installer');
  const manifest = {
    schema: 1,
    channel,
    runtimeId: config.runtimeId,
    platform: config.platform,
    arch: config.arch,
    build,
    ...(metadata
      ? { type: 'patch', baseVersion: pkg.version, patchVersion: metadata.patchVersion }
      : {}),
    notes: option('--notes-file')
      ? fs.readFileSync(option('--notes-file'), 'utf8')
      : metadata?.notes || '',
    expiresAt: new Date(createdAt + (config.githubRepository ? 365 : 30) * 86400_000).toISOString(),
    files: [],
  };
  const destination = path.resolve(out, config.runtimeId);
  fs.mkdirSync(path.join(destination, 'blobs'), { recursive: true });
  let bytes = 0;
  for (const rel of files(path.join(root, 'dist'), 'dist/')) {
    if (/\.(map|d\.ts|tsbuildinfo)$/.test(rel)) continue;
    if (!safePath(rel)) throw Error('Non-patchable compiled file: ' + rel);
    const data = fs.readFileSync(path.join(root, rel));
    const sha256 = hash(data);
    manifest.files.push({ path: rel, size: data.length, sha256 });
    bytes += data.length;
    const blob = path.join(destination, 'blobs', sha256);
    if (!fs.existsSync(blob)) fs.writeFileSync(blob, data, { flag: 'wx' });
  }
  const data = Buffer.from(JSON.stringify(manifest));
  const envelope = {
    payload: data.toString('base64'),
    signature: crypto.sign(null, data, fs.readFileSync(keyPath)).toString('base64'),
  };
  verifyEnvelope(envelope, config);
  atomicJson(path.join(destination, `${channel}-${config.platform}-${config.arch}.json`), envelope);
  if (config.githubRepository) {
    const assets = path.join(path.resolve(out), 'github-assets');
    fs.mkdirSync(assets, { recursive: true });
    if (args.includes('--export-release-notes')) {
      fs.writeFileSync(path.join(assets, 'release-notes.md'), manifest.notes, 'utf8');
    }
    for (const f of manifest.files)
      fs.copyFileSync(
        path.join(destination, 'blobs', f.sha256),
        path.join(assets, `${f.sha256}.blob`),
      );
    atomicJson(
      path.join(
        assets,
        `patch-${config.runtimeId}-${channel}-${config.platform}-${config.arch}.json`,
      ),
      envelope,
    );
    if (fs.readdirSync(assets).length > 950)
      throw Error('GitHub release asset limit exceeded; use a new base release');
  }
  console.log(
    `Build ${build} (${channel}): ${manifest.files.length} archivos (${bytes} bytes). Cada cliente descargará solo los que hayan cambiado. No se ha publicado nada.`,
  );
} else throw Error('Usa config, keygen --out carpeta o release --build N --out carpeta');
