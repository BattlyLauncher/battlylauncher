const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseMinecraftPresence } = require('../dist/shared/social/presence-format');
const { formatPlayVersion } = require('../dist/shared/minecraft/play-version-presentation');

test('NeoForge presence shows the Minecraft version embedded in the installed loader ID', () => {
  for (const [build, version] of [
    ['21.1.248', '1.21.1'],
    ['21.0.167-beta', '1.21'],
    ['26.3.0.116', '26.3'],
    ['26.1.2.28', '26.1.2'],
  ]) {
    assert.deepEqual(parseMinecraftPresence(`neoforge-${build}`), { loader: 'neoforge', version });
    assert.deepEqual(parseMinecraftPresence(`NeoForge ${build}`), { loader: 'neoforge', version });
    assert.equal(formatPlayVersion(`neoforge-${build}`), `NeoForge ${version} (${build})`);
  }
});

test('uses explicit Minecraft versions and leaves other status messages intact', () => {
  for (const [text, loader, version] of [
    ['NeoForge 1.21.1 (21.1.248)', 'neoforge', '1.21.1'],
    ['fabric-loader-0.18.1-26.3', 'fabric', '26.3'],
    ['Legacy Fabric 1.8.9', 'legacyfabric', '1.8.9'],
    ['quilt-loader-0.29.0-beta.1-1.21.1', 'quilt', '1.21.1'],
    ['1.20.1-forge-47.3.0', 'forge', '1.20.1'],
    ['Minecraft 26.3-pre-2', 'vanilla', '26.3-pre-2'],
  ]) {
    assert.deepEqual(parseMinecraftPresence(text), { loader, version });
  }
  assert.equal(parseMinecraftPresence('Jugando en forge21.1.248.example'), null);
  assert.equal(parseMinecraftPresence('En Battly'), null);
});
