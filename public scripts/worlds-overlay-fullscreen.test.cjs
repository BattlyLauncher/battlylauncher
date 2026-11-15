const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const handleBytes of [4, 8])
  test(`fullscreen HUD supports ${handleBytes}-byte handles without capturing clicks`, () => {
    let window, tracker;
    let cursor = { x: -100, y: -100 };
    const shortcuts = new Map();
    class Window {
      constructor(options) {
        window = this;
        this.options = options;
        this.focusable = options.focusable;
        this.visible = false;
        this.boundsWrites = 0;
        this.webContents = new EventEmitter();
        this.webContents.send = () => {};
        this.webContents.focus = () => {
          this.contentFocusWrites = (this.contentFocusWrites || 0) + 1;
        };
        this.webContents.setWindowOpenHandler = () => {};
      }
      isDestroyed() {
        return false;
      }
      isVisible() {
        return this.visible;
      }
      setAlwaysOnTop() {
        this.topmostWrites = (this.topmostWrites || 0) + 1;
      }
      setMenu() {}
      setIgnoreMouseEvents(value) {
        this.ignored = value;
      }
      setFocusable(value) {
        this.focusable = value;
      }
      hide() {
        this.visible = false;
      }
      showInactive() {
        this.visible = true;
      }
      show() {
        throw Error('Overlay must not activate');
      }
      moveTop() {}
      focus() {
        this.focusWrites = (this.focusWrites || 0) + 1;
      }
      getBounds() {
        return this.bounds || { x: 0, y: 0, width: 238, height: 62 };
      }
      setBounds(value) {
        this.bounds = value;
        this.boundsWrites++;
      }
      loadURL() {
        return Promise.resolve();
      }
      getNativeWindowHandle() {
        return Buffer.alloc(handleBytes);
      }
    }
    const filename = path.resolve('dist/main/social/worlds-desktop.js');
    const module = { exports: {} };
    const realRequire = require('node:module').createRequire(filename);
    const req = (name) =>
      name === 'electron'
        ? {
            BrowserWindow: Window,
            Notification: { isSupported: () => false },
            screen: { getCursorScreenPoint: () => cursor, screenToDipRect: (_, rect) => rect },
            globalShortcut: {
              register: (key, fn) => {
                shortcuts.set(key, fn);
                return true;
              },
              unregister: (key) => shortcuts.delete(key),
            },
          }
        : name === 'node:child_process'
          ? {
              spawn: () => {
                tracker = new EventEmitter();
                tracker.stdout = new PassThrough();
                tracker.kill = () => {};
                return tracker;
              },
            }
          : realRequire(name);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: req,
      exports: module.exports,
      module,
      process: { platform: 'win32', pid: 42 },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Buffer,
      URL,
    });
    const desktop = new module.exports.WorldsDesktop(
      () => ({
        isDestroyed: () => false,
        webContents: { send() {} },
        show() {
          throw Error('Must not steal focus from another application');
        },
        focus() {
          throw Error('Must not focus root during gameplay');
        },
      }),
      process.cwd(),
      path.resolve('dist'),
    );
    desktop.emit({ type: 'snapshot', snapshot: { state: 'joined' } });
    desktop.gameStarted(123, '26.2');
    const frame = (fullscreen, exclusiveFullscreen) =>
      tracker.stdout.write(
        JSON.stringify({
          visible: true,
          fullscreen,
          exclusiveFullscreen,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        }) + '\n',
      );
    frame(false);
    assert.equal(window.visible, false, 'Do not show an unpainted renderer');
    window.webContents.emit('did-finish-load');
    assert.equal(window.visible, true);
    const lostFocus = () =>
      tracker.stdout.write(
        JSON.stringify({
          visible: false,
          fullscreen: false,
          exclusiveFullscreen: false,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        }) + '\n',
      );
    lostFocus();
    assert.equal(
      window.visible,
      true,
      'A single transient foreground sample must not flash the HUD',
    );
    frame(false);
    lostFocus();
    lostFocus();
    assert.equal(window.visible, false, 'Switching away from Minecraft still hides the HUD');
    const topmostBeforeRestore = window.topmostWrites;
    desktop.open();
    assert.equal(
      window.visible,
      false,
      'Opening during a focus transition must not activate the launcher',
    );
    frame(false);
    assert.ok(
      window.topmostWrites > topmostBeforeRestore,
      'Restoring Minecraft must reassert overlay z-order and hit testing',
    );
    tracker.stdout.write('{"visible":false}\n');
    assert.equal(window.visible, true, 'A single missing F11 window sample must not flash the HUD');
    frame(false);
    shortcuts.get('CommandOrControl+B')();
    desktop.emit({ type: 'snapshot', snapshot: { state: 'error' } });
    assert.equal(
      window.visible,
      true,
      'A hosting error remains visible in a manually opened panel',
    );
    desktop.emit({ type: 'snapshot', snapshot: { state: 'joined' } });
    desktop.expand(false);
    const writes = window.boundsWrites;
    frame(false);
    assert.equal(window.boundsWrites, writes, 'Unchanged frames must not resize the overlay');
    frame(true);
    assert.equal(window.visible, false);
    assert.equal(window.ignored, true);
    shortcuts.get('CommandOrControl+B')();
    desktop.expand(true);
    assert.equal(
      window.focusable,
      true,
      'Explicitly opened panel accepts native pointer and report keyboard input',
    );
    desktop.open();
    assert.equal(window.visible, false, 'Shortcuts must not bring back an invisible click target');
    frame(true, false);
    assert.equal(window.visible, true, 'Monitor-sized composed windows support the HUD');
    assert.equal(window.ignored, true, 'Fullscreen compact HUD passes clicks through');
    cursor = { x: window.bounds.x + 10, y: window.bounds.y + 10 };
    frame(true, false);
    assert.equal(window.ignored, false, 'HUD buttons accept clicks when hovered');
    const briefFocusBefore = window.contentFocusWrites;
    lostFocus();
    frame(false, false);
    assert.ok(
      window.contentFocusWrites > briefFocusBefore,
      'Brief Alt+Tab must rebind input even when visibility debounce keeps HUD shown',
    );
    const focusBefore = window.contentFocusWrites;
    lostFocus();
    lostFocus();
    frame(false, false);
    assert.ok(
      window.contentFocusWrites > focusBefore,
      'Restoring a hovered HUD restores Chromium input without activating Minecraft or launcher',
    );
    const focused = window.contentFocusWrites;
    frame(false, false);
    assert.equal(
      window.contentFocusWrites,
      focused,
      'Unchanged frames must not repeatedly reset input focus',
    );
    cursor = { x: -100, y: -100 };
    frame(true, false);
    assert.equal(window.ignored, true, 'Gameplay clicks pass through outside HUD');
    frame(true, true);
    assert.equal(window.visible, false, 'Known exclusive fullscreen stays hidden');
    frame(false, false);
    assert.equal(window.visible, true);
    assert.equal(window.ignored, true, 'Pointer outside HUD passes through in windowed mode too');
    window.webContents.emit('render-process-gone');
    assert.equal(window.visible, false);
    assert.equal(window.ignored, true);
    desktop.gameStopped();
  });

const { minecraftLanPortFromLog } = require('../dist/main/minecraft/launch-events');
test('LAN detection recognizes the actual 26.3 log and older versions', () => {
  for (const message of [
    '[13:01:59] [Client thread/INFO]: Started on 55542',
    '<log4j:Message><![CDATA[Started on 55542]]></log4j:Message>',
    '[12:23:03] [Render thread/INFO]: Published LAN server on port 35381',
    'Started serving on 25565',
    'Local game hosted on port 50000',
  ])
    assert.ok(minecraftLanPortFromLog(message) > 0);
  for (const message of [
    '[CHAT] Started on 55542',
    '[CHAT] Published LAN server on port 35381',
    'Started on 0',
    'Started on 65536',
    'Started on 100000',
    'Published LAN server on port 0',
    'Published LAN server on port 65536',
    'Published LAN server on port 100000',
    'Connecting to example.com, 25565',
  ])
    assert.equal(minecraftLanPortFromLog(message), null);
});

test('slow Minecraft startup stays native, LAN popup survives fallback, and next game retries native mode', () => {
  const timers = new Set();
  let window, tracker;
  const sent = [],
    shortcuts = new Map();
  class Window extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.options = options;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.send = (...a) => sent.push(a);
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() {
      return false;
    }
    isVisible() {
      return this.visible;
    }
    setMenu() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    setFocusable(v) {
      this.focusable = v;
    }
    hide() {
      this.visible = false;
    }
    showInactive() {
      this.visible = true;
    }
    show() {
      throw Error('Must not activate');
    }
    moveTop() {}
    destroy() {
      this.visible = false;
    }
    focus() {
      throw Error('Must not focus over Minecraft');
    }
    getBounds() {
      return this.bounds || { x: 0, y: 0, width: 340, height: 310 };
    }
    setBounds(r) {
      this.bounds = r;
    }
    getNativeWindowHandle() {
      return Buffer.alloc(8);
    }
    loadURL() {
      return Promise.resolve();
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync('dist/main/social/worlds-desktop.js', 'utf8'), {
    module,
    exports: module.exports,
    require: (id) =>
      id === 'electron'
        ? {
            BrowserWindow: Window,
            Notification: { isSupported: () => false },
            globalShortcut: {
              register: (key, fn) => {
                shortcuts.set(key, fn);
                return true;
              },
              unregister() {},
            },
            screen: {
              getCursorScreenPoint: () => ({ x: -100, y: -100 }),
              screenToDipRect: (_, r) => r,
            },
          }
        : id === 'node:child_process'
          ? {
              spawn: () => {
                tracker = new EventEmitter();
                tracker.stdout = new PassThrough();
                tracker.kill = () => {};
                return tracker;
              },
            }
          : require('node:module').createRequire(
              path.resolve('dist/main/social/worlds-desktop.js'),
            )(id),
    process: { ...process, platform: 'win32' },
    setTimeout: (fn, delay) => {
      const t = { fn, delay, unref() {} };
      timers.add(t);
      return t;
    },
    clearTimeout: (t) => timers.delete(t),
    setInterval,
    clearInterval,
    Buffer,
    URL,
  });
  const d = new module.exports.WorldsDesktop(() => null, process.cwd(), path.resolve('dist'));
  d.gameStarted(123, '26.3');
  const native = window;
  tracker.stdout.write('{"visible":false}\n');
  assert.equal(
    [...timers].some((t) => t.delay === 20000),
    false,
    'A live tracker waiting for the game must not trigger fallback',
  );
  tracker.emit('error', Error('fixture failure'));
  assert.equal(window.options.frame, true);
  assert.equal(window.options.backgroundColor, '#0f1724');
  window.webContents.emit('did-finish-load');
  shortcuts.get('CommandOrControl+B')();
  assert.equal(window.focusable, true, 'Explicit companion panel accepts input');
  shortcuts.get('CommandOrControl+B')();
  d.lanOpened();
  [...timers].find((t) => t.delay === 3500).fn();
  assert.ok(sent.some(([channel, value]) => channel === 'worlds:lan-prompt' && value === true));
  assert.equal(window.visible, true, 'Fallback still shows the LAN confirmation');
  d.gameStopped();
  d.gameStarted(124, '26.3');
  assert.equal(window.options.frame, false, 'Next launch retries native overlay');
  d.stop();
});
