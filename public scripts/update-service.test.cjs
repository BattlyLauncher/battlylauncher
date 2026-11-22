const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { runStartupUpdate } = require('../dist/main/updates/startup-update-flow');

test('a late startup check prepares an available update without checking again', async (t) => {
  const { updates, calls } = service(t);
  const checked = await updates.action('check');
  assert.equal(checked.status, 'available');

  await updates.automatic(false);

  assert.deepEqual(calls, ['check', 'download']);
  assert.equal(updates.snapshot().status, 'ready');
});
function service(
  t,
  packaged = true,
  patch,
  flatpak = false,
  options = {},
  pendingTarget,
  platform,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-update-service-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  if (pendingTarget)
    fs.writeFileSync(
      path.join(dir, 'updates-pending.json'),
      JSON.stringify(typeof pendingTarget === 'string' ? { target: pendingTarget } : pendingTarget),
    );
  const calls = [];
  if (platform === 'win32') {
    fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'resources/app-update.yml'),
      'provider: github\nowner: 1ly4s0\nrepo: BattlyRemake\n',
    );
  }
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    calls.push('check');
    return { isUpdateAvailable: true, updateInfo: { version: '3.2.0' } };
  };
  updater.downloadUpdate = async () => {
    calls.push('download');
    updater.emit('download-progress', { percent: 100, transferred: 42 });
  };
  updater.quitAndInstall = () => calls.push('install');
  const exports = {};
  const context = {
    exports,
    console,
    AbortController,
    AbortSignal,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    process: {
      platform,
      arch: 'ia32',
      execPath: path.join(dir, 'Battly Launcher.exe'),
      resourcesPath: path.join(dir, 'resources'),
      windowsStore: false,
      env: flatpak ? { FLATPAK_ID: 'com.battlylauncher.launcher' } : {},
    },
    require(name) {
      if (name === 'electron')
        return {
          app: {
            isPackaged: packaged,
            once: () => {},
            getPath: () => dir,
            getVersion: () => '3.1.0',
            quit: () => calls.push('quit'),
            relaunch: () => calls.push('restart'),
          },
        };
      if (name === 'electron-updater')
        return {
          autoUpdater: updater,
          CancellationToken: class {
            cancel() {}
          },
        };
      if (name === '../runtime-mode') return { packagedApplication: packaged };
      if (name === './update-config') return require('../dist/main/updates/update-config');
      if (name === './official-installer-context')
        return require('../dist/main/updates/official-installer-context');
      if (name === '../storage/protected-data')
        return {
          decodePrivateData: (_path, bytes) => bytes,
          encodePrivateData: (_path, bytes) => bytes,
        };
      return require(name);
    },
  };
  if (patch) context[Symbol.for('battly.patch.runtime')] = patch;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../dist/main/updates/update-service.js'), 'utf8'),
    context,
  );
  const updates = new exports.UpdateService(options);
  t.after(() => updates.stop());
  return { updates, updater, calls, environment: context.process.env };
}

test('startup downloads a full update and hands off without claiming an installation percentage', async (t) => {
  const { updates, updater, calls } = service(t);
  const states = [];
  updater.downloadUpdate = async () => {
    calls.push('download');
    updater.emit('download-progress', { percent: 35, transferred: 1024 });
    await new Promise((r) => setTimeout(r, 130));
    updater.emit('download-progress', { percent: 100, transferred: 4096 });
    await new Promise((r) => setTimeout(r, 130));
  };
  const result = await runStartupUpdate(
    updates,
    (s) => states.push(s),
    () => updates.action('install'),
  );
  assert.equal(result, 'handoff');
  assert.deepEqual(calls, ['check', 'download', 'install']);
  assert(states.some((s) => s.phase === 'downloading' && s.percent === 35));
  assert(states.some((s) => s.phase === 'verifying'));
  assert.equal(states.at(-1).phase, 'installing');
  assert.equal(states.at(-1).percent, null);
});

test('startup does not install after a download failure and can retry the same update', async (t) => {
  const { updates, updater, calls } = service(t);
  updater.downloadUpdate = async () => {
    throw Error('offline');
  };
  assert.equal(
    await runStartupUpdate(
      updates,
      () => {},
      () => updates.action('install'),
    ),
    'error',
  );
  assert(!calls.includes('install'));
  updater.downloadUpdate = async () => calls.push('download');
  assert.equal(
    await runStartupUpdate(
      updates,
      () => {},
      () => updates.action('install'),
    ),
    'handoff',
  );
  assert.equal(calls.filter((x) => x === 'install').length, 1);
});

test('late administrator cancellation remains visible to startup and supports explicit retry', async (t) => {
  const { updates, updater } = service(t);
  await runStartupUpdate(
    updates,
    () => {},
    () => updates.action('install'),
  );
  updater.emit('error', Object.assign(Error('cancelled'), { code: 1223 }));
  assert.equal(updates.snapshot().installationError, true);
  assert.equal(updates.snapshot().status, 'ready');
  assert.equal(
    await runStartupUpdate(
      updates,
      () => {},
      () => updates.action('install'),
    ),
    'error',
  );
  assert.equal(
    await runStartupUpdate(
      updates,
      () => {},
      () => updates.action('install'),
      true,
    ),
    'handoff',
  );
  assert.equal(updates.snapshot().installationError, false);
});

test('startup does not relaunch a previously cancelled installer without an explicit retry', async (t) => {
  const { updates, calls } = service(
    t,
    true,
    undefined,
    false,
    {},
    { target: '3.2.0', attempted: true },
  );
  assert.equal(
    await runStartupUpdate(
      updates,
      () => {},
      () => updates.action('install'),
    ),
    'error',
  );
  assert.deepEqual(calls, ['check', 'download']);
});

test('periodic checks can start without duplicating the completed startup check', async (t) => {
  const { updates, calls } = service(t);
  updates.start(false);
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test('a stalled release check times out without a late result starting a download', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { updates, updater, calls } = service(t);
  let finish;
  updater.checkForUpdates = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const checking = updates.action('check');
  t.mock.timers.tick(15_001);
  await checking;
  assert.equal(updates.snapshot().status, 'error');
  finish({ isUpdateAvailable: true, updateInfo: { version: '3.2.0' } });
  await Promise.resolve();
  assert.equal(updates.snapshot().status, 'error');
  assert(!calls.includes('download'));
});

test('Windows handoff binds the downloaded update to its repository, target tag and current architecture', async (t) => {
  const { updates, calls, environment } = service(
    t,
    true,
    undefined,
    false,
    {},
    undefined,
    'win32',
  );
  await updates.automatic();
  await updates.action('install');
  assert(calls.includes('install'));
  assert.equal(environment.BATTLY_INSTALLER_UPDATE_TAG, 'v3.2.0');
  assert.equal(environment.BATTLY_INSTALLER_UPDATE_ARCH, 'ia32');
  assert.equal(environment.BATTLY_INSTALLER_UPDATE_REPOSITORY, '1ly4s0/BattlyRemake');
});
test('full updates download automatically and wait for a safe restart', async (t) => {
  const { updates, updater, calls } = service(t);
  await updates.automatic();
  assert.equal(updates.snapshot().status, 'ready');
  assert.deepEqual(calls, ['check', 'download']);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, true);
  await updates.action('install');
  assert.deepEqual(calls, ['check', 'download', 'install']);
});
test('Flatpak never downloads, activates patches or starts the installer', async (t) => {
  let touched = false;
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async () => {
      touched = true;
    },
    activate: () => {
      touched = true;
    },
    rollback: () => {
      touched = true;
    },
  };
  const { updates, calls } = service(t, true, patch, true);
  for (const action of ['check', 'download', 'install', 'rollback']) await updates.action(action);
  assert.deepEqual(calls, []);
  assert.equal(touched, false);
  assert.equal(updates.snapshot().patchConfigured, false);
  assert.match(updates.snapshot().message, /Flatpak/);
});
test('only the channel is configurable; legacy opt-out flags are ignored', async (t) => {
  const { updates, updater, calls } = service(t);
  updates.settings({ channel: 'beta', automatic: false, patches: false });
  assert.equal(updates.snapshot().settings.automatic, undefined);
  assert.equal(updates.snapshot().settings.patches, undefined);
  await updates.automatic();
  assert.deepEqual(calls, ['check', 'download']);
  assert.equal(updater.channel, 'beta');
  assert.equal(updater.allowPrerelease, true);
  assert.equal(updater.allowDowngrade, false);
  assert.throws(() => updates.settings({ channel: 'arbitrary', automatic: true, patches: true }));
});
test('development never contacts the release server and cannot install an unchecked update', async (t) => {
  const { updates, calls } = service(t, false);
  await updates.action('check');
  assert.equal(updates.snapshot().status, 'idle');
  assert.deepEqual(calls, []);
  await updates.action('install');
  assert.equal(updates.snapshot().status, 'error');
  assert.deepEqual(calls, []);
});

test('patches follow the selected channel and GitHub remains available when the patch feed fails', async (t) => {
  const channels = [];
  let fail = false;
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async (_signal, channel) => {
      channels.push(channel);
      if (fail) throw Error('offline');
      return { m: { build: 2, notes: 'fix' } };
    },
  };
  const { updates, updater, calls } = service(t, true, patch);
  updates.settings({ channel: 'stable', patches: true, automatic: true });
  await updates.action('check');
  assert.equal(updates.snapshot().kind, 'patch');
  updates.settings({ channel: 'beta', patches: true, automatic: true });
  await updates.action('check');
  assert.deepEqual(channels, ['stable', 'beta']);
  fail = true;
  await updates.action('check');
  assert.equal(updates.snapshot().kind, 'installer');
  assert.equal(updater.channel, 'beta');
  assert.deepEqual(calls, ['check']);
});

test('mandatory signed patches stage for next startup without quitting', async (t) => {
  const events = [];
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async () => ({ m: { build: 3, patchVersion: '3.1.0-patch3', notes: 'fix' } }),
    stage: async () => events.push('stage'),
    activate: () => events.push('activate'),
  };
  const { updates, calls } = service(t, true, patch);
  assert.equal(updates.snapshot().settings.patches, undefined);
  await updates.automatic();
  assert.equal(updates.snapshot().status, 'ready');
  assert.equal(updates.snapshot().target, '3.1.0-patch3');
  assert.deepEqual(events, ['stage', 'activate']);
  assert.deepEqual(calls, []);
});

test('legacy disabled flags cannot stop patch checks or downloads', async (t) => {
  const events = [];
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async () => {
      events.push('check');
      return { m: { build: 3, notes: 'fix' } };
    },
    stage: async () => events.push('stage'),
    activate: () => events.push('activate'),
  };
  const { updates } = service(t, true, patch);
  updates.settings({ channel: 'stable', automatic: false, patches: false });
  await updates.automatic();
  assert.deepEqual(events, ['check', 'stage', 'activate']);
  assert.equal(updates.snapshot().status, 'ready');
});

test('installer boundary refuses patch versions even if upstream selects one', async (t) => {
  const { updates, updater } = service(t);
  updater.checkForUpdates = async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '3.1.0-patch3' },
  });
  await updates.action('check');
  assert.equal(updates.snapshot().status, 'error');
  assert.equal(updates.snapshot().kind, null);
});

test('automatic activation failure becomes a visible error without quitting or an unhandled rejection', async (t) => {
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async () => ({ m: { build: 2, notes: 'fix' } }),
    stage: async () => {},
    activate: () => {
      throw Error('tampered');
    },
  };
  const { updates, calls } = service(t, true, patch);
  await updates.automatic();
  assert.equal(updates.snapshot().status, 'error');
  assert.deepEqual(calls, []);
});

test('ready notification is deduplicated, later snoozes 15 minutes, then emits a new reminder', async (t) => {
  let now = 1000;
  const notices = [];
  let closed = 0;
  const events = [];
  const patch = {
    snapshot: () => ({ build: 1, enabled: true }),
    check: async () => ({ m: { build: 2, notes: 'fix' } }),
    stage: async () => events.push('stage'),
    activate: () => events.push('activate'),
  };
  const { updates } = service(t, true, patch, false, {
    now: () => now,
    ready: (s) => notices.push(s),
    later: () => closed++,
  });
  await updates.automatic();
  assert.equal(notices.length, 1);
  await updates.automatic();
  assert.equal(notices.length, 1);
  const later = await updates.action('later');
  assert.equal(later.remindAt, 901000);
  assert.equal(closed, 1);
  now += 899999;
  await updates.automatic();
  assert.equal(notices.length, 1);
  now++;
  await updates.automatic();
  assert.equal(notices.length, 2);
  assert.equal(notices[1].noticeId, 2);
  assert.deepEqual(events, ['stage', 'activate']);
});

test('recovered cached full installer is verified before startup install; ordinary fresh download waits until quit', async (t) => {
  const { updates, updater, calls } = service(t, true, undefined, false, {}, '3.2.0');
  await updates.automatic();
  assert.deepEqual(calls, ['check', 'download', 'install']);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test('cached startup install respects the same active-game guard and keeps the update available', async (t) => {
  let attempts = 0;
  const { updates, calls } = service(
    t,
    true,
    undefined,
    false,
    {
      install: async () => {
        attempts++;
        throw Error('game active');
      },
    },
    '3.2.0',
  );
  await updates.automatic();
  assert.equal(attempts, 1);
  assert.equal(updates.snapshot().status, 'ready');
  assert(!calls.includes('install'));
  await updates.automatic();
  assert.equal(attempts, 1);
});

test('parallel automatic checks share a single network/download operation', async (t) => {
  const { updates, calls } = service(t);
  await Promise.all([updates.automatic(), updates.automatic(), updates.automatic()]);
  assert.deepEqual(calls, ['check', 'download']);
});

test('a cancelled or interrupted installer is not retried automatically on every boot', async (t) => {
  const { updates, calls } = service(
    t,
    true,
    undefined,
    false,
    {},
    { target: '3.2.0', attempted: true },
  );
  await updates.automatic();
  assert.deepEqual(calls, ['check', 'download']);
  assert.equal(updates.snapshot().status, 'ready');
  await updates.action('install');
  assert.equal(calls.at(-1), 'install');
});

test('asynchronous installer permission failure keeps the verified update retryable', async (t) => {
  const { updates, updater } = service(t);
  await updates.automatic();
  updater.quitAndInstallCalled = true;
  updater.emit('error', Object.assign(Error('User cancelled'), { code: 1223 }));
  assert.equal(updates.snapshot().status, 'ready');
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.quitAndInstallCalled, false);
  assert.match(updates.snapshot().message, /administrador/);
  await updates.action('install');
  assert.equal(updates.snapshot().status, 'ready');
});

test('start registers one 15-minute timer, runs immediately and stops cleanly', async (t) => {
  const { updates, calls } = service(t);
  t.after(() => updates.stop());
  updates.start();
  updates.start();
  await updates.automatic();
  assert.deepEqual(calls, ['check', 'download']);
  updates.stop();
});
