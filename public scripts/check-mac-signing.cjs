const fs = require('node:fs');
const { signingMode, signingCertificate } = require('./mac-signing-policy.cjs');

function check(env = process.env, platform = process.platform) {
  const mode = signingMode(env);
  if (platform !== 'darwin') throw Error('Signed macOS releases must be built on macOS.');
  if (mode === 'adhoc') return mode;
  if (mode === 'self-signed') {
    signingCertificate(env);
    if (!env.BATTLY_MAC_SIGNING_P12 || !env.BATTLY_MAC_SIGNING_PASSWORD)
      throw Error('Missing BATTLY_MAC_SIGNING_P12 / BATTLY_MAC_SIGNING_PASSWORD.');
    return mode;
  }
  if (!env.CSC_LINK || !env.CSC_KEY_PASSWORD)
    throw Error(
      'Missing CSC_LINK / CSC_KEY_PASSWORD: Developer ID Application certificate required.',
    );
  const api = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER;
  const account = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID;
  if (!api && !account) throw Error('Missing Apple notarization credentials.');
  if (api && !fs.existsSync(env.APPLE_API_KEY)) throw Error('Apple API key file does not exist.');
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false')
    throw Error('Signing identity discovery must be enabled.');
  return mode;
}

module.exports = { check };
if (require.main === module) {
  try {
    const mode = check();
    console.log(
      mode === 'adhoc'
        ? 'macOS ad-hoc signing selected. No Developer ID or notarization credentials required; macOS build and final integrity checks remain required.'
        : `macOS ${mode} signing prerequisites present.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
