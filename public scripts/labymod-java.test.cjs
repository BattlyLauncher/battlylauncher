const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { resolveMinecraftJava } = require('../dist/main/minecraft/minecraft-java-selection');
const { prepareLaunchJava } = require('../dist/main/minecraft/prepare-launch-java');
const javaExecutable = require('../dist/main/minecraft/java-executable');
const { worldsPlayRequest } = require('../dist/shared/social/worlds-version');
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

test('joining a LabyMod world switches away from an incompatible global Java path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'battly-laby-worlds-java-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const base = join(root, 'versions', '1.8.9');
  await mkdir(base, { recursive: true });
  await writeFile(join(base, '1.8.9.json'), JSON.stringify({ javaVersion: { majorVersion: 8 } }));
  t.mock.method(javaExecutable, 'inspectJavaRuntime', async (path) => ({
    major: path.includes('java-21') ? 21 : 8,
    bits: 64,
    architecture: 'x64',
  }));

  for (const [id, configuredMajor, expectedMajor] of [
    ['LabyMod-1.8', 8, 21],
    ['LabyMod-3-1.8.9', 21, 8],
  ]) {
    const request = worldsPlayRequest(id, [{ id, custom: true, version: '1.8.9', loader: 'vanilla' }], '127.0.0.1:25565');
    assert.deepEqual(request.directConnect, { host: '127.0.0.1', port: 25565 });
    const managed = join(root, 'runtime', `java-${expectedMajor}`, 'bin');
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, executable), 'fixture');
    const options = {
      root,
      engine: 'minecraft-launcher-core',
      version: { id: request.version, customId: request.installedVersionId },
      javaPath: join(root, 'configured', `java-${configuredMajor}`, executable),
      javaArguments: [],
    };
    const preparation = {
      contentRoot: root,
      requiredJavaVersion: request.requiredJavaVersion,
      install: async () => assert.fail('The compatible runtime already exists'),
    };
    assert.equal((await prepareLaunchJava(options, preparation, () => {})).javaPath, join(managed, executable));
    await assert.rejects(
      prepareLaunchJava(options, { ...preparation, explicitInstancePath: true }, () => {}),
      /Java/,
    );
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

test('LabyMod 4 keeps its declared LWJGL core and JNA together, excluding inherited copies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'battly-laby-classpath-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const id = 'LabyMod-1.8';
  const declarations = [
    ['org.lwjgl:lwjgl:3.4.3:unsafe', 'org/lwjgl/lwjgl/3.4.3/lwjgl-3.4.3-unsafe.jar'],
    ['net.java.dev.jna:jna:5.17.0', 'net/java/dev/jna/jna/5.17.0/jna-5.17.0.jar'],
    [
      'net.java.dev.jna:jna-platform:5.17.0',
      'net/java/dev/jna/jna-platform/5.17.0/jna-platform-5.17.0.jar',
    ],
  ];
  await mkdir(join(root, 'versions', id), { recursive: true });
  await writeFile(
    join(root, 'versions', id, id + '.json'),
    JSON.stringify({
      inheritsFrom: '1.8.9',
      labymod_data: { commitReference: '12345678', lwjglVersion: '3.4.3' },
      libraries: declarations.map(([name, path]) => ({ name, downloads: { artifact: { path } } })),
    }),
  );
  const preferred = [];
  for (const [, file] of declarations) {
    const full = join(root, 'libraries', file);
    await mkdir(require('node:path').dirname(full), { recursive: true });
    await writeFile(full, 'fixture');
    preferred.push(full);
  }
  const inherited = [
    join(root, 'libraries/org/lwjgl/lwjgl/lwjgl/2.9.4/lwjgl.jar'),
    join(root, 'libraries/net/java/dev/jna/platform/3.4.0/platform.jar'),
    join(root, 'libraries/net/java/dev/jna/jna/3.4.0/jna.jar'),
  ];
  const { labyModLaunchOptions } = require('../dist/main/minecraft/labymod-launch-compatibility');
  const legacy = labyModLaunchOptions({ root, version: { id } });
  assert.equal(legacy.version.id, '1.8.9');
  assert.equal(legacy.version.customId, id);
  const explicit = labyModLaunchOptions({ root, version: { id: '1.8.9', customId: id } });
  assert.deepEqual(legacy, explicit);
  const result = mergeLabyLwjglClasspath(legacy, [...inherited, 'minecraft.jar']);
  for (const entry of preferred) assert(result.includes(entry), entry);
  for (const entry of inherited) assert(!result.includes(entry), entry);
  assert(result.includes('minecraft.jar'));
  assert.equal(labyModLaunchOptions({ root, version: { id: 'LabyMod-3-1.8.9' } }), null);
});
