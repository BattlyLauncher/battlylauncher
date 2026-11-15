'use strict';
const { app } = require('electron');
const path = require('node:path');
const { createRuntime } = require('./patch-runtime.cjs');
const { runtimeConfig, patchStorageRoot } = require('./runtime-config.cjs');
app.setName('Battly Launcher');
app.setPath(
  'userData',
  process.env.BATTLY_USER_DATA_PATH || path.join(app.getPath('appData'), 'Battly Launcher'),
);
const lock = app.requestSingleInstanceLock();
globalThis[Symbol.for('battly.bootstrap.lock')] = lock;
if (!lock) {
  app.quit();
} else {
  const installedRoot = path.resolve(__dirname, '..');
  let config;
  try {
    config = require('./config.json');
  } catch {
    config = { baseBuild: 1 };
  }
  config = runtimeConfig(config);
  const runtime = createRuntime({
    config,
    installedRoot,
    root: patchStorageRoot(app.getPath('userData'), config),
  });
  globalThis[Symbol.for('battly.patch.runtime')] = runtime;
  const entry = app.isPackaged ? runtime.boot() : path.join(installedRoot, 'dist/main/index.js');
  // Patched modules still use the immutable dependencies bundled with this installer.
  process.env.NODE_PATH = path.join(installedRoot, 'node_modules');
  require('node:module').Module._initPaths();
  let watchdog;
  if (runtime.snapshot().pending) {
    watchdog = setTimeout(() => {
      app.relaunch();
      app.exit(1);
    }, 120_000);
    const markHealthy = runtime.healthy;
    runtime.healthy = () => {
      markHealthy();
      clearTimeout(watchdog);
    };
  }
  try {
    require(entry);
  } catch (error) {
    if (runtime.snapshot().pending) {
      app.relaunch();
      app.exit(1);
    } else {
      throw error;
    }
  }
}
