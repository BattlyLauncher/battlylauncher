const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { resolveMinecraftJava } = require('../dist/main/minecraft/minecraft-java-selection');
const {
  mergeLabyLwjglClasspath,
} = require('../dist/main/minecraft/minecraft-launcher-core-adapter');

test('LabyMod 3 selects Java 8 despite a saved Java 21 requirement; LabyMod 4 keeps its runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-laby-java-'));
  try {
    for (const [version, major] of [
      ['1.8.9', 8],
      ['1.12.2', 8],
      ['26.3', 25],
    ]) {
      const directory = join(root, 'versions', version);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${version}.json`),
        JSON.stringify({ javaVersion: { majorVersion: major } }),
      );
    }
    for (const version of ['1.8.9', '1.12.2']) {
      for (const saved of ['', '8', '21']) {
        const selected = await resolveMinecraftJava(
          root,
          `LabyMod-3-${version}`,
          saved,
          root,
          version,
        );
        assert.equal(selected.major, 8);
        assert.equal(selected.maximumMajor, 8);
      }
      const modern = await resolveMinecraftJava(root, `LabyMod-${version}`, '21', root, version);
      assert.equal(modern.major, 21);
      assert.equal(modern.maximumMajor, undefined);
    }
    const modern = await resolveMinecraftJava(root, 'LabyMod-26.3', '21', root, '26.3');
    assert.equal(modern.major, 25);
    const ordinary = await resolveMinecraftJava(root, '1.8.9', '17');
    assert.equal(ordinary.major, 17);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('installed LabyMod 4 assets do not replace the LabyMod 3 client classpath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-laby-coexist-'));
  try {
    await mkdir(join(root, 'labymod-neo', 'assets'), { recursive: true });
    await writeFile(join(root, 'labymod-neo', 'assets', 'common.jar'), 'PK');
    const entries = [
      join(root, 'libraries/net/labymod/LabyMod/3_1.8.9/LabyMod-3_1.8.9.jar'),
      'minecraft.jar',
    ];
    assert.deepEqual(
      mergeLabyLwjglClasspath(
        { root, version: { id: '1.8.9', customId: 'LabyMod-3-1.8.9' } },
        entries,
      ),
      entries,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
