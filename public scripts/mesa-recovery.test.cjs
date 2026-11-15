const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  { mkdtemp } = require('node:fs/promises'),
  { tmpdir } = require('node:os'),
  { join } = require('node:path');
const { MesaRecoveryAdapter } = require('../dist/main/minecraft/mesa-recovery-adapter');
const { isMesaCompatibleFailure } = require('../dist/main/minecraft/mesa-runtime-service');
const options = {
  engine: 'minecraft-launcher-core',
  gameDirectory: 'C:/game',
  javaPath: 'C:/java/bin/java.exe',
  javaArguments: [],
  version: { id: '1.21' },
};
const fault = 'GLFW error 65542: WGL: The driver does not appear to support OpenGL';
async function fixture(codes = [1, 0], message = fault) {
  const root = await mkdtemp(join(tmpdir(), 'mesa-recovery-test-'));
  let launches = 0,
    prepares = 0;
  const received = [];
  const adapter = {
    engine: options.engine,
    async launch(o, emit) {
      received.push(o);
      const index = launches++;
      emit({
        type: 'log',
        stream: 'game',
        message: codes[index] === 0 ? 'Minecraft stopped normally' : message,
      });
      emit({ type: 'exit', code: codes[index] ?? 1, signal: null });
      return {
        completion: Promise.resolve({ code: codes[index] ?? 1, signal: null }),
        cancel: () => true,
      };
    },
  };
  const runtime = {
    prepare: async (o) => {
      prepares++;
      return { ...o, javaPath: 'C:/isolated/bin/java.exe' };
    },
  };
  return {
    recovery: new MesaRecoveryAdapter(adapter, runtime, root, 'win32'),
    received,
    counts: () => ({ launches, prepares }),
    runtime,
  };
}
test('repairs once, preserves launch options and reuses successful profile', async () => {
  const f = await fixture([1, 0, 0]);
  const events = [];
  const handle = await f.recovery.launch(options, (e) => events.push(e));
  assert.equal((await handle.completion).code, 0);
  assert.deepEqual(f.counts(), { launches: 2, prepares: 1 });
  assert.equal(events.filter((e) => e.type === 'exit').length, 1);
  assert.equal(f.received[1].gameDirectory, options.gameDirectory);
  await (
    await f.recovery.launch(options, () => {})
  ).completion;
  assert.equal(f.received[2].javaPath, 'C:/isolated/bin/java.exe');
});
test('failed recovery is not retried on subsequent launches', async () => {
  const f = await fixture([1, 1, 1]);
  await (
    await f.recovery.launch(options, () => {})
  ).completion;
  await (
    await f.recovery.launch(options, () => {})
  ).completion;
  assert.deepEqual(f.counts(), { launches: 3, prepares: 1 });
});
test('unrelated GLFW errors and clean exits never trigger repair', async () => {
  assert(!isMesaCompatibleFailure('GLFW error 65544: No monitors found'));
  assert(!isMesaCompatibleFailure('OpenGL shader failed'));
  for (const [codes, message] of [
    [[1], 'GLFW error 65544'],
    [[0], 'Minecraft stopped normally'],
  ]) {
    const f = await fixture(codes, message);
    await (
      await f.recovery.launch(options, () => {})
    ).completion;
    assert.equal(f.counts().prepares, 0);
  }
});
test('cancel during preparation prevents relaunch', async () => {
  const f = await fixture();
  let started;
  const ready = new Promise((r) => (started = r));
  f.runtime.prepare = async (o, e, signal) => {
    started();
    await new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
    );
    return o;
  };
  const h = await f.recovery.launch(options, () => {});
  await ready;
  h.cancel();
  await h.completion;
  assert.equal(f.counts().launches, 1);
});
test('download failure preserves original exit and cannot loop', async () => {
  const f = await fixture();
  f.runtime.prepare = async () => {
    throw new Error('hash mismatch');
  };
  const events = [];
  assert.equal(
    (await (await f.recovery.launch(options, (e) => events.push(e))).completion).code,
    1,
  );
  assert(events.some((e) => e.type === 'log' && e.message.includes('hash mismatch')));
  assert.equal(f.counts().launches, 1);
});

test('launch-time GLFW rejection also recovers once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mesa-reject-'));
  let attempts = 0;
  const adapter = {
    engine: options.engine,
    async launch() {
      if (++attempts === 1) throw new Error(fault);
      return { completion: Promise.resolve({ code: 0, signal: null }), cancel: () => true };
    },
  };
  const h = await new MesaRecoveryAdapter(
    adapter,
    { prepare: async (o) => o },
    root,
    'win32',
  ).launch(options, () => {});
  assert.equal((await h.completion).code, 0);
  assert.equal(attempts, 2);
});
test('native environment applies to the selected child only', async () => {
  const { observeLauncherProcesses } = require('../dist/main/minecraft/launcher-process-observer');
  const { spawn } = require('node:child_process');
  const launch = () =>
    new Promise((resolve, reject) => {
      const p = spawn(process.execPath, [
        '-e',
        'process.stdout.write(process.env.BATTLY_MESA_TEST||"unset")',
      ]);
      let output = '';
      p.stdout.on('data', (b) => (output += b));
      p.on('error', reject);
      p.on('close', () => resolve(output));
    });
  const [scoped, other] = await Promise.all([
    observeLauncherProcesses(launch, () => {}, {
      executable: process.execPath,
      values: { BATTLY_MESA_TEST: 'scoped' },
    }),
    launch(),
  ]);
  assert.equal(scoped, 'scoped');
  assert.equal(other, 'unset');
  assert.equal(process.env.BATTLY_MESA_TEST, undefined);
});
