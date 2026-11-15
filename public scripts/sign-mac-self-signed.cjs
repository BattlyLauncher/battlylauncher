'use strict';
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { signingCertificate, certificateRequirement } = require('./mac-signing-policy.cjs');

const version = '0.29.0';
const tool = {
  x64: ['x86_64', '14ef11bedd51a8d95eafd767939ae96d5900e5a61511bef75bb21db6e7c74140'],
  arm64: ['aarch64', 'd1a532150adaf90048260d76359261aa716abafc45c53c5dc18845029184334a'],
};

async function signApp(app, appId, env = process.env) {
  if (process.platform !== 'darwin' || !Object.hasOwn(tool, process.arch))
    throw Error('The macOS signing tool requires an Intel or Apple Silicon Mac.');
  const fingerprint = signingCertificate(env);
  const p12 = env.BATTLY_MAC_SIGNING_P12;
  const password = env.BATTLY_MAC_SIGNING_PASSWORD;
  if (!p12 || !password || !/^[A-Za-z0-9+/]+={0,2}$/.test(p12))
    throw Error('Provide the macOS PKCS#12 as base64 and its password.');

  const [arch, digest] = tool[process.arch];
  const name = `apple-codesign-${version}-${arch}-apple-darwin`;
  const url = `https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${version}/${name}.tar.gz`;
  const dir = await mkdtemp(path.join(tmpdir(), 'battly-mac-sign-'));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok)
      throw Error(`Cannot download the pinned macOS signing tool (${response.status}).`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== digest)
      throw Error('The macOS signing tool checksum does not match.');
    const archivePath = path.join(dir, 'rcodesign.tar.gz');
    await writeFile(archivePath, archive);
    execFileSync('/usr/bin/tar', ['-xzf', archivePath, '-C', dir]);
    const p12File = path.join(dir, 'identity.p12');
    const passwordFile = path.join(dir, 'password');
    await writeFile(p12File, Buffer.from(p12, 'base64'), { mode: 0o600 });
    await writeFile(passwordFile, password, { mode: 0o600 });
    const childEnv = { ...env };
    delete childEnv.BATTLY_MAC_SIGNING_P12;
    delete childEnv.BATTLY_MAC_SIGNING_PASSWORD;
    execFileSync(
      path.join(dir, name, 'rcodesign'),
      [
        'sign',
        '--config-file',
        '/dev/null',
        '--shallow',
        '--timestamp-url',
        'none',
        '--p12-file',
        p12File,
        '--p12-password-file',
        passwordFile,
        app,
      ],
      { env: childEnv, timeout: 120000 },
    );
    execFileSync(
      '/usr/bin/codesign',
      [
        '--verify',
        '--deep',
        '--strict',
        '-R',
        '=' + certificateRequirement(appId, fingerprint, 'leaf'),
        app,
      ],
      { timeout: 60000 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

module.exports = { signApp };
