const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

async function bridge(entry) {
  const exposed = {};
  const calls = [];
  const { outputFiles } = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    write: false,
  });
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      on() {},
      removeListener() {},
      send() {},
      async invoke(channel, ...args) {
        calls.push({ channel, args });
        throw new Error(
          `Error invoking remote method '${channel}': Error: El servicio no está disponible`,
        );
      },
    },
  };
  const context = {
    require: (id) => (id === 'electron' ? electron : require(id)),
    exports: {},
    module: { exports: {} },
    process,
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout,
    Error,
    TypeError,
    AbortSignal,
  };
  vm.runInNewContext(outputFiles[0].text, context, { filename: entry });
  return { exposed, calls };
}

for (const [entry, namespace] of [
  ['src/preload/index.ts', 'battly'],
  ['src/preload/worlds-overlay.ts', 'worldsOverlay'],
]) {
  test(`${entry}: every IPC invocation passes through the common error handler`, async () => {
    const { exposed } = await bridge(entry);
    const ts = require('typescript');
    const text = fs.readFileSync(entry, 'utf8');
    const tree = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true);
    const calls = [];
    const walk = (node) => {
      if (
        ts.isCallExpression(node) &&
        (node.expression.getText(tree) === 'invokeDesktop' ||
          node.expression.getText(tree) === 'ipcRenderer.invoke')
      )
        calls.push(node);
      ts.forEachChild(node, walk);
    };
    walk(tree);
    assert(calls.length > 10);
    for (const node of calls)
      assert.equal(
        node.expression.getText(tree),
        'invokeDesktop',
        `unprotected IPC call in ${entry}`,
      );
    const api = exposed[namespace];
    assert(api, `missing ${namespace} bridge`);
    const action = namespace === 'battly' ? () => api.getServers() : () => api.getWorldsSnapshot();
    await assert.rejects(action(), { message: 'El servicio no está disponible' });
  });
}

test('nested Electron errors are unwrapped without changing business messages or successful results', async () => {
  const { createIpcInvoker, stripElectronErrorPrefix } = require('../dist/shared/ipc-errors');
  const raw = new Error(
    'Error invoking remote method \'outer\': Error: Error invoking remote method "inner": TypeError: Elige otro nombre.',
  );
  const invoke = createIpcInvoker(async () => {
    throw raw;
  });
  await assert.rejects(invoke('outer'), (error) => {
    assert.equal(error.message, 'Elige otro nombre.');
    assert.equal(error.cause, raw);
    return true;
  });
  assert.equal(
    stripElectronErrorPrefix("Error invoking remote method 'x': RangeError: Valor fuera de rango."),
    'Valor fuera de rango.',
  );
  assert.equal(
    stripElectronErrorPrefix('No se pudo guardar: C:\\Games\\options.txt'),
    'No se pudo guardar: C:\\Games\\options.txt',
  );
  const value = { ok: true };
  assert.equal(
    await createIpcInvoker(async (channel, arg) => {
      assert.equal(channel, 'test');
      assert.equal(arg, 42);
      return value;
    })('test', 42),
    value,
  );
  const original = new TypeError('Selecciona una carpeta.');
  await assert.rejects(
    createIpcInvoker(async () => {
      throw original;
    })('test'),
    (error) => error === original,
  );
});

test('Electron infrastructure failures use a plain message and retain the original cause', async () => {
  const { createIpcInvoker } = require('../dist/shared/ipc-errors');
  for (const detail of [
    "No handler registered for 'servers:create'",
    'An object could not be cloned.',
    'Object has been destroyed',
    'Rejected IPC request from an untrusted renderer',
    '',
  ]) {
    const original = new Error(`Error invoking remote method 'test': Error: ${detail}`);
    await assert.rejects(
      createIpcInvoker(async () => {
        throw original;
      })('test'),
      (error) => {
        assert.equal(error.message, 'No se pudo completar la acción. Vuelve a intentarlo.');
        assert.equal(error.cause, original);
        return true;
      },
    );
  }
});
