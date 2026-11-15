const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { MesaRecoveryAdapter } = require('../dist/main/minecraft/mesa-recovery-adapter');
for (const repeated of [false, true])
  test(`GLFW code zero retries Mesa and records ${repeated ? 'failed' : 'enabled'}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'battly-mesa-zero-'));
    let launches = 0,
      preparations = 0;
    const adapter = {
      engine: 'minecraft-java-core',
      launch: async (options, emit) => {
        launches++;
        if (launches === 1 || repeated)
          emit({
            type: 'log',
            stream: 'game',
            message: 'GLFW error 65542: WGL: The driver does not appear to support OpenGL',
          });
        emit({ type: 'exit', code: 0, signal: null });
        return { completion: Promise.resolve({ code: 0, signal: null }), cancel: () => true };
      },
    };
    try {
      const wrapper = new MesaRecoveryAdapter(
        adapter,
        {
          prepare: async (options) => {
            preparations++;
            return options;
          },
        },
        root,
        'win32',
      );
      const handle = await wrapper.launch(
        { gameDirectory: root, version: { id: '1.20.1' }, javaPath: 'C:/java/bin/javaw.exe' },
        () => {},
      );
      await handle.completion;
      assert.equal(launches, 2);
      assert.equal(preparations, 1);
      const state = JSON.parse(
        await readFile(
          join(
            root,
            (await readdir(root)).find((name) => name.endsWith('.json')),
          ),
          'utf8',
        ),
      );
      assert.equal(state.state, repeated ? 'failed' : 'enabled');
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

test('a later non-graphics failure preserves proven Mesa rendering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-mesa-rendered-'));
  let launches = 0;
  const adapter = {
    engine: 'minecraft-java-core',
    launch: async (options, emit) => {
      launches++;
      emit({
        type: 'log',
        stream: 'game',
        message:
          launches === 1
            ? 'GLFW error 65542'
            : 'Created: 1024x1024x4 minecraft:textures/atlas/blocks.png-atlas',
      });
      return { completion: Promise.resolve({ code: 1, signal: null }), cancel: () => true };
    },
  };
  try {
    const wrapper = new MesaRecoveryAdapter(
      adapter,
      { prepare: async (options) => options },
      root,
      'win32',
    );
    const handle = await wrapper.launch(
      { gameDirectory: root, version: { id: '1.20.1' }, javaPath: 'C:/java/bin/javaw.exe' },
      () => {},
    );
    assert.equal((await handle.completion).code, 1);
    const state = JSON.parse(
      await readFile(
        join(
          root,
          (await readdir(root)).find((name) => name.endsWith('.json')),
        ),
        'utf8',
      ),
    );
    assert.equal(state.state, 'enabled');
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
