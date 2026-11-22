'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { resolveFabricLoader } = require('../dist/main/minecraft/fabric-loader-compatibility');
const { LoaderBuildService } = require('../dist/main/minecraft/loader-build-service');

function options(root, version = '26.2', build = '0.16.10', instanceId) {
  return {
    root,
    gameDirectory: root,
    instanceId,
    engine: 'minecraft-java-core',
    version: { id: version, type: 'release' },
    core: { loader: { type: 'fabric', build, enabled: true } },
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'battly-fabric-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a stale Fabric build is repaired for the normal profile and for instances', async (t) => {
  const root = await fixture(t);
  for (const instanceId of [undefined, 'my-pack']) {
    const original = options(root, '26.2', '0.16.10', instanceId);
    const events = [];
    const resolved = await resolveFabricLoader(original, (event) => events.push(event), true);
    assert.equal(resolved.core.loader.build, '0.19.3');
    assert.equal(resolved.gameDirectory, original.gameDirectory);
    assert.equal(resolved.instanceId, instanceId);
    assert.equal(original.core.loader.build, '0.16.10');
    assert.match(events[0].message, /0\.16\.10.*0\.19\.3/);
  }
});

test('a recent build, latest and versions that can use older loaders retain their selection', async (t) => {
  const root = await fixture(t);
  for (const [version, build] of [
    ['26.2', '0.19.3'],
    ['26.2', 'latest'],
    ['26.2', '0.17.0'],
    ['1.21.1', '0.16.10'],
  ]) {
    const original = options(root, version, build);
    assert.equal(await resolveFabricLoader(original, () => {}, true), original);
  }
});

test('an offline instance uses a compatible loader already installed for its Minecraft version', async (t) => {
  const root = await fixture(t);
  for (const id of ['fabric-loader-0.19.5-26.3', 'fabric-loader-0.20.1-26.2']) {
    const installed = join(root, 'loader', 'versions', id);
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, id + '.json'), JSON.stringify({ id }));
  }
  const resolved = await resolveFabricLoader(options(root), () => {}, false);
  assert.equal(resolved.core.loader.build, '0.20.1');
  await assert.rejects(
    resolveFabricLoader(options(root, '26.1'), () => {}, false),
    /Fabric.*26\.1/,
  );
});

test('the Fabric catalog filters unsupported Java 25 builds only for the affected game versions', async () => {
  const service = new LoaderBuildService(async () =>
    Response.json([
      { loader: { version: '0.19.3', stable: true } },
      { loader: { version: '0.16.10', stable: false } },
    ]),
  );
  assert.deepEqual(
    (await service.list('fabric', '26.2')).builds.map((build) => build.version),
    ['0.19.3'],
  );
  assert.deepEqual(
    (await service.list('fabric', '1.21.1')).builds.map((build) => build.version),
    ['0.19.3', '0.16.10'],
  );
});
