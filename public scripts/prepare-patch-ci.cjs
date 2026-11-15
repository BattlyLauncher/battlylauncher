'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const pkg = require('../package.json');
require('./patch-release-config.cjs').releaseConfig(pkg);
const key = process.env.PATCH_PUBLIC_KEY;
if (!key || crypto.createPublicKey(key).asymmetricKeyType !== 'ed25519')
  throw Error('Configure BATTLY_PATCH_PUBLIC_KEY (Ed25519)');
const dir = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP || require('node:os').tmpdir(), 'battly-release-'),
);
const publicFile = path.join(dir, 'public.pem');
fs.writeFileSync(publicFile, key, { mode: 0o600 });
const variables = { BATTLY_PATCH_PUBLIC_KEY_FILE: publicFile };
if (pkg.battlyUpdate.type === 'patch') {
  const secret = process.env.PATCH_PRIVATE_KEY;
  if (!secret) throw Error('Configure BATTLY_PATCH_PRIVATE_KEY');
  const privateKey = crypto.createPrivateKey(secret);
  if (
    crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }) !==
    crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' })
  )
    throw Error('Patch signing keys do not match');
  const privateFile = path.join(dir, 'private.pem');
  fs.writeFileSync(privateFile, secret, { mode: 0o600 });
  variables.BATTLY_PATCH_PRIVATE_KEY_FILE = privateFile;
}
if (!process.env.GITHUB_ENV) throw Error('This helper is for Actions');
fs.appendFileSync(
  process.env.GITHUB_ENV,
  Object.entries(variables)
    .map(([k, v]) => `${k}=${v}\n`)
    .join(''),
);
