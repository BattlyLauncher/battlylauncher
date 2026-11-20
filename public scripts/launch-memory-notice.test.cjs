const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LaunchMemoryPreflight } = require('../dist/main/minecraft/launch-memory-preflight');
const { configuredJavaSpawnArguments } = require('../dist/main/minecraft/launch-memory');
const { isMinecraftLaunchEvent } = require('../dist/shared/minecraft/launch-contract');
const { CrashAnalysisService } = require('../dist/main/minecraft/crash-analysis-service');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mib = 1024 ** 2;
const options = {
  memory: { minimumMiB: 512, maximumMiB: 1536 },
  javaArguments: [],
  version: { id: '1.8.9' },
};
function guard(available, physical = 1985) {
  return new LaunchMemoryPreflight({
    supported: true,
    read: async () => {
      if (available === null) throw Error('counter unavailable');
      return {
        commitLimitBytes: 16000 * mib,
        availableCommitBytes: available * mib,
        physicalTotalBytes: 8000 * mib,
        physicalAvailableBytes: physical * mib,
      };
    },
    ask: async (assessment, emit) => {
      emit({ type: 'memory-warning', severity: assessment.severity });
      return 'continue';
    },
    openSettings: async () => {
      throw Error('must not open Windows settings');
    },
  });
}
test('reported 349 MiB margin shows one Battly notice and lets the launch proceed', async () => {
  const events = [];
  assert.equal(await guard(349).prepare(options, (e) => events.push(e)), options);
  assert.deepEqual(
    events.filter((e) => e.type === 'memory-warning'),
    [{ type: 'memory-warning', severity: 'critical' }],
  );
});
test('low physical memory uses the same notice without silently changing heap', async () => {
  const events = [];
  assert.equal(await guard(10000, 256).prepare(options, (e) => events.push(e)), options);
  assert.equal(events.find((e) => e.type === 'memory-warning').severity, 'warning');
});
test('unavailable counters warn and continue; safe memory has no notice', async () => {
  const events = [];
  assert.equal(await guard(null).prepare(options, (e) => events.push(e)), options);
  assert.equal(events.find((e) => e.type === 'memory-warning').severity, 'unknown');
  events.length = 0;
  assert.equal(await guard(10000).prepare(options, (e) => events.push(e)), options);
  assert.equal(
    events.some((e) => e.type === 'memory-warning'),
    false,
  );
});
test('preload accepts only recognized memory notice severities', () => {
  assert.equal(isMinecraftLaunchEvent({ type: 'memory-warning', severity: 'critical' }), true);
  assert.equal(isMinecraftLaunchEvent({ type: 'memory-warning', severity: 'oops' }), false);
  assert.equal(isMinecraftLaunchEvent({ type: 'memory-warning' }), false);
});

test('instance launch orders diagnostic flags across classpath while preserving game arguments', () => {
  const gameArguments = [
    'net.minecraft.client.main.Main',
    '-XX:-UnlockDiagnosticVMOptions',
    '-Xmx7G',
  ];
  const launcherArguments = [
    'java',
    '-XX:-UnlockDiagnosticVMOptions',
    '-cp',
    'instance libraries',
    '-XX:+AlwaysPreTouchStacks',
    '-XX:+UnlockDiagnosticVMOptions',
    '-Xmx6G',
    ...gameArguments,
  ];
  assert.deepEqual(configuredJavaSpawnArguments(launcherArguments, options.memory), [
    'java',
    '-XX:+UnlockDiagnosticVMOptions',
    '-cp',
    'instance libraries',
    '-XX:+AlwaysPreTouchStacks',
    '-Xms512M',
    '-Xmx1536M',
    ...gameArguments,
  ]);
});

test('Fabric heap failures in the launch log report the cause for the global profile and instances', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'battly-fabric-heap-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const launchLogPath = join(directory, 'fabric.jsonl');
  const service = new CrashAnalysisService(
    { snapshot: async () => ({ runtime: { ramMaxGb: 4 } }) },
    {
      readInternal: async () => ({
        name: 'Fabric test',
        version: '1.21.1',
        loader: 'fabric',
        launchProfile: { ramMaxGb: 4 },
      }),
    },
  );
  const cases = [
    ['Invalid maximum heap size: -Xmx12Q', 'invalid-heap-size', 0, null],
    ['Too small maximum heap', 'invalid-heap-size', 1, 'fabric-test'],
    [
      'Initial heap size set to a larger value than the maximum heap size',
      'invalid-heap-size',
      1,
      null,
    ],
    ['Could not reserve enough space for 4194304KB object heap', 'jvm-reservation', 0, null],
    ['Could not allocate enough space for the Java heap', 'jvm-reservation', 1, 'fabric-test'],
    ['Caused by: java.lang.OutOfMemoryError: Java heap space', 'java-heap', 0, 'fabric-test'],
    ['Caused by: java.lang.OutOfMemoryError: Metaspace', 'metaspace', 1, null],
    ['Caused by: java.lang.OutOfMemoryError: Direct buffer memory', 'native-memory', 1, null],
  ];
  for (const [message, issueId, code, instanceId] of cases) {
    await writeFile(launchLogPath, JSON.stringify({ event: { message } }) + '\n');
    const report = await service.analyze({
      exit: { code, signal: null },
      gameDirectory: directory,
      instanceId,
      launchLogPath,
      launchStartedAt: Date.now(),
    });
    const issue = report?.issues.find((item) => item.id === issueId);
    assert.ok(issue, `Expected ${issueId} for ${message}`);
    assert.ok(issue.evidence.some((line) => line.line.includes(message)));
    if (issueId !== 'java-heap') {
      assert.ok(!report.issues.some((item) => item.id === 'java-heap'));
    }
  }
  await writeFile(launchLogPath, '[Fabric] Heap size configured to 4096 MiB\nStopping!');
  assert.equal(
    await service.analyze({
      exit: { code: 0, signal: null },
      gameDirectory: directory,
      instanceId: null,
      launchLogPath,
      launchStartedAt: Date.now(),
    }),
    null,
  );
});
