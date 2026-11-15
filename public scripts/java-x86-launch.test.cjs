const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withJavaMemoryLimit } = require('../dist/main/minecraft/prepare-launch-java');
const { publicCoreError } = require('../dist/main/minecraft/minecraft-java-core-adapter');

const options = {
  memory: { minimumMiB: 2048, maximumMiB: 4096 },
  javaArguments: ['-Xmx4G', '-Xms2G', '-XX:MaxHeapSize=4294967296', '-Dexample=true'],
  authorization: {
    accessToken: 'private-token',
    clientToken: 'private-client',
    uuid: 'private-uuid',
  },
};

test('32-bit Java gets a bounded heap even with instance or custom JVM overrides', () => {
  const messages = [];
  const result = withJavaMemoryLimit(options, 32, (text) => messages.push(text));
  assert.deepEqual(result.memory, { minimumMiB: 1024, maximumMiB: 1024 });
  assert.deepEqual(result.javaArguments, ['-Dexample=true']);
  assert.equal(options.memory.maximumMiB, 4096);
  assert.equal(messages.length, 1);
  assert.equal(
    withJavaMemoryLimit(options, 64, () => {}),
    options,
  );
});

test('32-bit Java keeps a smaller configured heap', () => {
  const result = withJavaMemoryLimit(
    { ...options, memory: { minimumMiB: 256, maximumMiB: 768 }, javaArguments: [] },
    32,
    () => {},
  );
  assert.deepEqual(result.memory, { minimumMiB: 256, maximumMiB: 768 });
});

test('Mesa x86 leaves extra native address space without changing stored settings', () => {
  const result = withJavaMemoryLimit(options, 32, () => {}, 768);
  assert.deepEqual(result.memory, { minimumMiB: 768, maximumMiB: 768 });
  assert.deepEqual(result.javaArguments, ['-Dexample=true']);
  assert.equal(options.memory.maximumMiB, 4096);
  const small = withJavaMemoryLimit(
    { ...options, memory: { minimumMiB: 256, maximumMiB: 512 } },
    32,
    () => {},
    768,
  );
  assert.deepEqual(small.memory, { minimumMiB: 256, maximumMiB: 512 });
  assert.equal(
    withJavaMemoryLimit(options, 64, () => {}, 768),
    options,
  );
});

test('JVM heap errors survive Buffer and string error events without exposing tokens', () => {
  const text = 'Could not reserve enough space for 2097152KB object heap private-token';
  for (const error of [text, Buffer.from(text), { error: Buffer.from(text) }, new Error(text)]) {
    const detail = publicCoreError(error, options);
    assert.match(detail, /Could not reserve enough space/);
    assert.doesNotMatch(detail, /private-token/);
    assert.match(detail, /\[redacted\]/);
  }
});
