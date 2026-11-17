const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { stripElectronErrorPrefix } = require('../dist/shared/ipc-errors');
function declaration(file, name) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), 99, true);
  return source.statements
    .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
    .getText(source)
    .replace(/^export\s+/, '');
}
function fixture(startAuth) {
  const statuses = Array.from({ length: 4 }, () => ({ textContent: 'stale' }));
  const controls = [{ disabled: false }];
  const notices = [];
  const pending = [];
  const scope = {
    Error,
    stripElectronErrorPrefix,
    document: {
      querySelectorAll: (selector) =>
        selector.includes('[data-login-status]') ? statuses : controls,
      querySelector: () => null,
    },
    window: { battly: { startAuth } },
    showToast: (...args) => {
      notices.push(args);
      return {
        close() {
          pending.push('popup-closed');
        },
      };
    },
    setLoginPending: (value) => pending.push(value),
  };
  vm.createContext(scope);
  vm.runInContext(
    ts.transpile(
      declaration('src/renderer/ui/user-error.ts', 'userErrorMessage') +
        '\n' +
        declaration('src/renderer/index.ts', 'startAuthentication'),
    ),
    scope,
  );
  return { scope, statuses, controls, notices, pending };
}
test('Electron rejection becomes a readable popup and leaves no embedded status', async () => {
  const f = fixture(async () => {
    throw new Error(
      "Error invoking remote method 'auth:start': Error: No se pudo conectar con el servidor",
    );
  });
  const result = await f.scope.startAuthentication({ method: 'battly-password' });
  assert.equal(result.ok, false);
  assert.equal(f.notices.at(-1)[1], 'No se pudo conectar con el servidor');
  assert.equal(f.notices.at(-1)[2], 'error');
  assert.ok(f.statuses.every((status) => status.textContent === ''));
  assert.deepEqual(f.pending, [true, 'popup-closed', false]);
});
test('business failures remain useful, technical stacks are hidden, and cancellation stays quiet', async () => {
  for (const [message, expected] of [
    [
      'Esta cuenta ya está añadida. Puedes seleccionarla en el selector de cuentas.',
      'Esta cuenta ya está añadida. Puedes seleccionarla en el selector de cuentas.',
    ],
    [
      "No se pudo iniciar sesión: Error invoking remote method 'auth:start': TypeError: broken",
      'No se pudo iniciar sesión',
    ],
  ]) {
    const f = fixture(async () => ({ ok: false, code: 'failed', message }));
    await f.scope.startAuthentication({ method: 'microsoft' });
    assert.equal(f.notices.at(-1)[1], expected);
  }
  const f = fixture(async () => ({
    ok: false,
    code: 'cancelled',
    message: 'Inicio de sesión cancelado',
  }));
  await f.scope.startAuthentication({ method: 'battly-google' });
  assert.equal(f.notices.length, 1);
});
test('two factor failure restores its controls and reports the error in a popup', async () => {
  const f = fixture(async () => ({
    ok: false,
    code: 'failed',
    message: 'El código no es válido o ha expirado',
  }));
  await f.scope.startAuthentication({ method: 'battly-two-factor', mode: 'totp', code: '123456' });
  assert.equal(f.controls[0].disabled, false);
  assert.equal(f.notices.at(-1)[1], 'El código no es válido o ha expirado');
  assert.ok(f.statuses.every((status) => status.textContent === ''));
});
