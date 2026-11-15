const { build: base, version, battlyUpdate } = require('./package.json');
const cloudSigning = process.env.BATTLY_SIGNING_MODE === 'azure';
const { macSigningOptions } = require('./public scripts/mac-signing-policy.cjs');
require('./public scripts/patch-release-config.cjs').releaseConfig(require('./package.json'));
const [releaseOwner, releaseRepository] = battlyUpdate.repository.split('/');
function azureSetting(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw Error('Missing Azure signing setting: ' + name);
  }
  return value;
}

module.exports = {
  ...base,
  directories: { output: `artifacts/releases/release-${version}` },
  appImage: { ...base.appImage, artifactName: 'Battly-Launcher-linux-x86_64.${ext}' },
  dmg: { ...base.dmg, writeUpdateInfo: true },
  mac: {
    ...base.mac,
    ...macSigningOptions(process.env, base.appId),
    signIgnore: [],
    entitlements: 'build-resources/entitlements.mac.plist',
    entitlementsInherit: 'build-resources/entitlements.mac.plist',
    category: 'public.app-category.games',
    artifactName: 'Battly-Launcher-mac-${arch}.${ext}',
    target: [
      { target: 'zip', arch: ['x64', 'arm64'] },
      { target: 'tar.gz', arch: ['x64', 'arm64'] },
      { target: 'dmg', arch: ['x64', 'arm64'] },
    ],
  },
  win: {
    ...base.win,
    target: [{ target: 'zip', arch: ['x64', 'ia32'] }],
    signExecutable: true,
    forceCodeSigning: true,
    signtoolOptions: cloudSigning
      ? undefined
      : {
          ...base.win.signtoolOptions,
          sign: './public scripts/sign-windows.cjs',
          signingHashAlgorithms: ['sha256'],
        },
    azureSignOptions: cloudSigning
      ? {
          publisherName: base.win.signtoolOptions.publisherName,
          endpoint: azureSetting('BATTLY_AZURE_SIGNING_ENDPOINT'),
          codeSigningAccountName: azureSetting('BATTLY_AZURE_SIGNING_ACCOUNT'),
          certificateProfileName: azureSetting('BATTLY_AZURE_SIGNING_PROFILE'),
        }
      : undefined,
  },
  publish: [
    {
      provider: 'github',
      owner: releaseOwner,
      repo: releaseRepository,
      releaseType: 'release',
      channel: battlyUpdate?.channel === 'beta' ? 'beta' : 'latest',
    },
  ],
};
