const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore } = require('../dist/main/settings/settings-store');
const { startupIntroVolume } = require('../dist/main/startup-presentation');
const { normalizeRuntimeSettings } = require('../dist/shared/settings/settings-contract');

test('startup sound defaults to enabled and preserves an explicit disabled preference', async () => {
  assert.equal(normalizeRuntimeSettings({}).startupSoundEnabled, true);
  assert.equal(normalizeRuntimeSettings({ startupSoundEnabled: false }).startupSoundEnabled, false);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-startup-sound-'));
  try {
    const file = path.join(directory, 'profile.json');
    await fs.writeFile(file, '{}');
    const store = new SettingsStore(file);
    const snapshot = await store.snapshot();
    assert.equal(snapshot.runtime.startupSoundEnabled, true);
    assert.equal((await store.startupSoundPreference()).volume, 0.8);
    await store.save({ ...snapshot, runtime: { ...snapshot.runtime, startupSoundEnabled: false } });
    const reopened = new SettingsStore(file);
    assert.equal((await reopened.snapshot()).runtime.startupSoundEnabled, false);
    assert.equal((await reopened.startupSoundPreference()).volume, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Battly Boost mutes the intro without changing the saved sound preference', () => {
  const runtime = normalizeRuntimeSettings({ launchBoostEnabled: true, startupSoundEnabled: true });
  assert.equal(startupIntroVolume(runtime, 0.8), 0);
  assert.equal(runtime.startupSoundEnabled, true);
  assert.equal(startupIntroVolume({ ...runtime, launchBoostEnabled: false }, 0.8), 0.8);
  assert.equal(
    startupIntroVolume({ launchBoostEnabled: false, startupSoundEnabled: false }, 0.8),
    0,
  );
});
