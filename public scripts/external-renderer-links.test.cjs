const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

test('renderer links open in the browser while unsafe schemes and launcher navigation stay blocked', async () => {
  const source = ts.createSourceFile(
    'index.ts',
    fs.readFileSync('src/main/index.ts', 'utf8'),
    99,
    true,
  );
  const functions = ['confirmExternalLink', 'secureWebContents']
    .map((name) =>
      source.statements
        .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
        .getText(source),
    )
    .join('\n');
  const opened = [];
  const context = vm.createContext({
    URL,
    shell: { openExternal: async (url) => opened.push(url) },
    isTrustedRendererUrl: (url) => url === 'file:///launcher.html',
    rendererUrl: undefined,
  });
  vm.runInContext(ts.transpile(functions), context);
  const webContents = new EventEmitter();
  webContents.setWindowOpenHandler = (handler) => {
    webContents.openHandler = handler;
  };
  context.secureWebContents({ webContents });
  for (const url of [
    'https://example.com/changelog',
    'https://discord.gg/example',
    'mailto:help@example.com',
  ]) {
    assert.equal(webContents.openHandler({ url }).action, 'deny');
  }
  for (const url of [
    'javascript:alert(1)',
    'file:///private.txt',
    'cmd:run',
    'data:text/html,test',
  ]) {
    assert.equal(webContents.openHandler({ url }).action, 'deny');
  }
  let prevented = false;
  webContents.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    'https://example.com/details',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.deepEqual(opened, [
    'https://example.com/changelog',
    'https://discord.gg/example',
    'mailto:help@example.com',
    'https://example.com/details',
  ]);
  prevented = false;
  webContents.emit(
    'will-navigate',
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    'file:///launcher.html',
  );
  assert.equal(prevented, false);
});
