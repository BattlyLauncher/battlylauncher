const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LaunchMemoryPreflight } = require('../dist/main/minecraft/launch-memory-preflight');
const { isMinecraftLaunchEvent } = require('../dist/shared/minecraft/launch-contract');
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
