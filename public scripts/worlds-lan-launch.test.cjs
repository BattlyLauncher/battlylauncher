const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { buildInstanceLaunchOptions } = require('../dist/main/minecraft/instance-launch-profile');
const {
  supportsOpenWorldsRoom,
  withWorldsLanConnection,
  WorldsLanRoomLease,
} = require('../dist/main/minecraft/worlds-lan-launch');

test('Java launches get the Worlds LAN adapter before joining a room', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'battly-worlds-launch-'));
  const instanceDirectory = path.join(directory, 'instances', 'forge-test');
  const lease = new WorldsLanRoomLease(path.join(directory, 'rooms'));
  t.after(async () => {
    lease.update();
    await fs.rm(directory, { recursive: true, force: true });
  });

  const launch = buildInstanceLaunchOptions({
    account: { type: 'offline', uuid: '123456781234123412341234567890ab', name: 'QA' },
    config: {
      gameArguments: [],
      raw: {
        libraries: {
          package_mimbpyzw_s52o: {
            version: 'qa',
            sha256: 'a'.repeat(64),
            url: 'https://cdn.battlylauncher.com/qa.zip',
          },
        },
      },
    },
    instanceDirectory,
    instanceId: 'forge-test',
    instanceMetadata: {
      name: 'Claws of Berk',
      version: '1.18.2',
      loader: 'forge',
      loaderVersion: '40.3.12',
    },
    profileValues: {},
  });

  const agentPath = path.resolve(__dirname, '../resources/worlds-lan/worlds-lan-agent.jar');
  assert.equal(launch.root, instanceDirectory);
  assert.equal(launch.gameDirectory, instanceDirectory);
  assert.equal(launch.instanceId, undefined);
  assert.equal(supportsOpenWorldsRoom(launch), true);
  const prepared = withWorldsLanConnection(launch, undefined, undefined, agentPath, lease.path);
  assert.deepEqual(prepared.javaArguments, [
    ...launch.javaArguments,
    `-javaagent:${agentPath}=room-file:${lease.path}`,
  ]);
  await assert.rejects(fs.access(lease.path), { code: 'ENOENT' });

  lease.update({ state: 'joined', code: 'QA', address: '127.0.0.1:58488' });
  assert.match(await fs.readFile(lease.path, 'utf8'), /^127\.0\.0\.1:58488\n\d+\n$/);
  lease.update();
  await assert.rejects(fs.access(lease.path), { code: 'ENOENT' });

  assert.equal(supportsOpenWorldsRoom({ ...launch, installOnly: true }), false);
  for (const [loader, version] of [
    ['vanilla', '1.8.9'],
    ['forge', '1.20.1'],
    ['fabric', '26.3'],
    ['quilt', '1.20.1'],
    ['neoforge', '1.21.11'],
  ]) {
    const options = {
      ...launch,
      version: { id: version, type: 'release' },
      core: {
        ...launch.core,
        loader: { type: loader, enabled: loader !== 'vanilla', build: 'latest' },
      },
    };
    assert.deepEqual(
      withWorldsLanConnection(options, undefined, undefined, agentPath, lease.path).javaArguments,
      prepared.javaArguments,
      loader,
    );
  }
  const optiFine = {
    ...launch,
    core: undefined,
    engine: 'minecraft-launcher-core',
    version: { id: '1.20.1', type: 'release', customId: '1.20.1-OptiFine_HD_U_I6' },
  };
  assert.deepEqual(
    withWorldsLanConnection(optiFine, undefined, undefined, agentPath, lease.path).javaArguments,
    prepared.javaArguments,
  );
});
