const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  prepareLegacyGameOptionsBeforeSpawn: prepare,
} = require('../dist/main/minecraft/legacy-game-options');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-client-settings-'));
  const gameDirectory = path.join(root, 'client-profiles', 'cmpack_1.8.8');
  const options = { root, gameDirectory, version: { id: '1.8.8', customId: 'cmpack_1.8.8' } };
  return {
    root,
    gameDirectory,
    options,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('CM-Pack inherits shared Minecraft settings and keeps subsequent changes across launches', () => {
  const f = fixture();
  try {
    const shared = 'lang:es_ES\nrenderDistance:10\nkey_key.forward:17\nsoundCategory_master:0.35\n';
    fs.writeFileSync(path.join(f.root, 'options.txt'), shared);
    fs.writeFileSync(path.join(f.root, 'optionsof.txt'), 'ofFastRender:true\n');
    fs.writeFileSync(path.join(f.root, 'optionsshaders.txt'), 'shaderPack=test.zip\n');
    prepare(f.options, () => {});
    assert.equal(fs.readFileSync(path.join(f.gameDirectory, 'options.txt'), 'utf8'), shared);
    assert.equal(
      fs.readFileSync(path.join(f.gameDirectory, 'optionsof.txt'), 'utf8'),
      'ofFastRender:true\n',
    );
    assert.equal(
      fs.readFileSync(path.join(f.gameDirectory, 'optionsshaders.txt'), 'utf8'),
      'shaderPack=test.zip\n',
    );
    const changed = shared.replace('10', '6');
    fs.writeFileSync(path.join(f.gameDirectory, 'options.txt'), changed);
    fs.writeFileSync(path.join(f.root, 'options.txt'), 'lang:en_US\n');
    prepare(f.options, () => {});
    assert.equal(fs.readFileSync(path.join(f.gameDirectory, 'options.txt'), 'utf8'), changed);
    assert.equal(fs.readFileSync(path.join(f.root, 'options.txt'), 'utf8'), 'lang:en_US\n');
  } finally {
    f.cleanup();
  }
});

test('an onboarding-only options file does not hide the saved gameplay settings', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.gameDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(f.root, 'options.txt'),
      'lang:es_ES\nrenderDistance:8\nonboardAccessibility:true\n',
    );
    fs.writeFileSync(path.join(f.gameDirectory, 'options.txt'), 'onboardAccessibility:false\n');
    prepare(f.options, () => {});
    const actual = fs.readFileSync(path.join(f.gameDirectory, 'options.txt'), 'utf8');
    assert.match(actual, /lang:es_ES/);
    assert.match(actual, /renderDistance:8/);
    assert.match(actual, /onboardAccessibility:false/);
    assert.doesNotMatch(actual, /onboardAccessibility:true/);
  } finally {
    f.cleanup();
  }
});

test('existing client settings, install-only requests and ordinary instances are preserved', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, 'options.txt'), 'lang:es_ES\n');
    prepare({ ...f.options, installOnly: true }, () => {});
    assert(!fs.existsSync(f.gameDirectory));
    prepare({ ...f.options, version: { id: '1.8.8' } }, () => {});
    assert(!fs.existsSync(f.gameDirectory));
    fs.mkdirSync(f.gameDirectory, { recursive: true });
    fs.writeFileSync(path.join(f.gameDirectory, 'options.txt'), 'lang:en_US\nrenderDistance:4\n');
    prepare(f.options, () => {});
    assert.equal(
      fs.readFileSync(path.join(f.gameDirectory, 'options.txt'), 'utf8'),
      'lang:en_US\nrenderDistance:4\n',
    );
  } finally {
    f.cleanup();
  }
});

test('profile junctions cannot redirect the migration', () => {
  const f = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-outside-settings-'));
  try {
    fs.writeFileSync(path.join(f.root, 'options.txt'), 'lang:es_ES\n');
    fs.mkdirSync(path.dirname(f.gameDirectory), { recursive: true });
    fs.symlinkSync(outside, f.gameDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    prepare(f.options, () => {});
    assert(!fs.existsSync(path.join(outside, 'options.txt')));
  } finally {
    fs.unlinkSync(f.gameDirectory);
    f.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
