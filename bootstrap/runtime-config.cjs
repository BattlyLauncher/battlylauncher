'use strict';
const path = require('node:path');
const crypto = require('node:crypto');

function runtimeConfig(config, platform = process.platform, arch = process.arch) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Invalid bootstrap configuration');
  }
  // Un instalador universal puede empaquetar ambos binarios desde un único proceso x64.
  // La selección de parches debe seguir al binario que se está ejecutando.
  return { ...config, platform, arch };
}

function patchStorageRoot(userData, config) {
  // Keep the complete identity without nesting two long path components.
  // Chromium can reject renderer paths beyond MAX_PATH on standard Windows installs.
  const namespace = crypto
    .createHash('sha256')
    .update(JSON.stringify([config.runtimeId || 'development', config.platform, config.arch]))
    .digest('base64url');
  return path.join(userData, 'updates', namespace);
}

module.exports = { runtimeConfig, patchStorageRoot };
