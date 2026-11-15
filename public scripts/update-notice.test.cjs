const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  { EventEmitter } = require('node:events');
function fixture(platform = 'win32', supported = true) {
  const created = [];
  class Native extends EventEmitter {
    static isSupported() {
      return supported;
    }
    constructor(options) {
      super();
      this.options = options;
      created.push(this);
    }
    show() {
      this.shown = true;
    }
    close() {
      this.closed = true;
    }
  }
  const exports = {};
  vm.runInNewContext(fs.readFileSync('dist/main/updates/update-notice.js', 'utf8'), {
    exports,
    process: { platform },
    require: (name) => {
      if (name === 'electron') return { Notification: Native };
      throw Error(name);
    },
  });
  const calls = [];
  const notifier = exports.createUpdateNotifier({
    text: (s) => s,
    icon: 'test.png',
    open: (a) => calls.push(a),
    later: () => calls.push('later'),
  });
  return { notifier, created, calls };
}
test('native Windows buttons route restart/later correctly; click opens Battly', () => {
  const f = fixture();
  f.notifier.ready({ target: '3.1.0-patch3' });
  const n = f.created[0];
  assert(n.shown);
  assert.equal(n.options.actions.length, 2);
  n.emit('click');
  n.emit('action', { actionIndex: 0 });
  n.emit('action', { actionIndex: 1 });
  assert.deepEqual(f.calls, ['open', 'restart', 'later']);
  f.notifier.close();
  assert(n.closed);
});
test('new native notice replaces the previous one; unsupported OS notifications fail softly', () => {
  const f = fixture();
  f.notifier.ready({ target: '2' });
  f.notifier.ready({ target: '3' });
  assert(f.created[0].closed);
  assert(f.created[1].shown);
  f.created[1].emit('failed');
  const unavailable = fixture('win32', false);
  unavailable.notifier.ready({});
  assert.equal(unavailable.created.length, 0);
});
test('Linux native click opens the same in-app actions without unsupported native buttons', () => {
  const f = fixture('linux');
  f.notifier.ready({});
  assert.equal(f.created[0].options.actions.length, 0);
  f.created[0].emit('click');
  assert.deepEqual(f.calls, ['open']);
});
