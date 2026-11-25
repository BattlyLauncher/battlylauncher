const assert = require('node:assert/strict');
const { test } = require('node:test');
const { additionalDiagnostics } = require('../dist/main/minecraft/local-crash-diagnostics');
const { isMesaCompatibleFailure } = require('../dist/main/minecraft/mesa-runtime-service');
const { planLwjglNatives } = require('../dist/main/minecraft/lwjgl-native-compatibility');

test('NeoForge can use the Mojang LWJGL natives for the architecture of Java on macOS', () => {
  const metadata = {
    libraries: [
      { name: 'org.lwjgl:lwjgl:3.4.3' },
      { name: 'org.lwjgl:lwjgl-sdl:3.4.3' },
      ...['lwjgl', 'lwjgl-sdl'].flatMap((module) =>
        ['natives-macos', 'natives-macos-arm64', 'natives-windows'].map((classifier) => ({
          name: `org.lwjgl:${module}:3.4.3:${classifier}`,
        })),
      ),
    ],
  };
  for (const [arch, suffix] of [
    ['arm64', 'natives-macos-arm64'],
    ['x64', 'natives-macos'],
  ]) {
    const plan = planLwjglNatives(metadata, { platform: 'darwin', arch });
    assert.deepEqual(
      plan.artifacts.map((artifact) => artifact.name),
      [`org.lwjgl:lwjgl:3.4.3:${suffix}`, `org.lwjgl:lwjgl-sdl:3.4.3:${suffix}`],
    );
  }
});

test('distinguishes an early LWJGL loading failure from a GPU fence crash during rendering', () => {
  const nativeFailure = '[LWJGL] Failed to load a library. Possible solutions:';
  const gpuFailure = 'java.lang.IllegalStateException: Failed to complete GPU fence: 0';
  for (const [content, id] of [
    [nativeFailure, 'native-library'],
    [gpuFailure, 'opengl-gpu-fence'],
  ]) {
    assert.deepEqual(
      additionalDiagnostics([{ name: 'game.log', content }]).map((issue) => issue.id),
      [id],
    );
    assert.equal(isMesaCompatibleFailure(content), false);
  }
});
