'use strict';

function signingMode(env = process.env) {
  const mode = env.BATTLY_MAC_SIGNING_MODE || 'developer-id';
  if (!['developer-id', 'self-signed', 'adhoc'].includes(mode)) {
    throw new Error('BATTLY_MAC_SIGNING_MODE must be developer-id, self-signed or adhoc.');
  }
  return mode;
}

function signingCertificate(env = process.env) {
  const hash = env.BATTLY_MAC_CERT_SHA1;
  if (!/^[0-9a-f]{40}$/i.test(hash || ''))
    throw Error('BATTLY_MAC_CERT_SHA1 must identify the stable macOS signing certificate.');
  return hash.toUpperCase();
}

function certificateRequirement(appId, fingerprint, slot = 'root') {
  if (typeof appId !== 'string' || !/^[\w.-]+$/.test(appId) || !/^[0-9A-F]{40}$/.test(fingerprint))
    throw Error('Invalid macOS signing identity.');
  return `identifier "${appId}" and certificate ${slot} = H"${fingerprint.toLowerCase()}"`;
}

function macSigningOptions(env = process.env, appId) {
  if (signingMode(env) === 'self-signed') {
    return {
      identity: '-',
      forceCodeSigning: true,
      hardenedRuntime: false,
      notarize: false,
      preAutoEntitlements: false,
      timestamp: 'none',
      sign: async (options) => {
        const { signAsync } = require('@electron/osx-sign');
        await signAsync({ ...options, identity: '-', identityValidation: false });
        await require('./sign-mac-self-signed.cjs').signApp(options.app, appId, env);
      },
    };
  }
  const adhoc = signingMode(env) === 'adhoc';
  return {
    forceCodeSigning: true,
    hardenedRuntime: !adhoc,
    notarize: !adhoc,
    ...(adhoc ? { identity: '-' } : {}),
  };
}

module.exports = { signingMode, signingCertificate, certificateRequirement, macSigningOptions };
