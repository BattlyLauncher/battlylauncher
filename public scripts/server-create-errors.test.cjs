const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serverAccountRegistry } = require('../dist/main/servers/server-account-registry');
const {
  serverErrorMessage,
  serverDomainTakenMessage,
} = require('../dist/shared/servers/server-errors');

test('a taken domain keeps its friendly message across the API and IPC boundaries', async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  global.fetch = async () =>
    Response.json(
      { code: 'SERVER_DOMAIN_TAKEN', error: 'provider internal error' },
      { status: 409 },
    );
  const registry = serverAccountRegistry(async () => 'fixture', 'https://example.test');
  await assert.rejects(registry.create({}), { message: serverDomainTakenMessage });
  assert.equal(
    serverErrorMessage(
      new Error(
        `Error invoking remote method 'servers:create': Error: ${serverDomainTakenMessage}`,
      ),
      'fallback',
    ),
    serverDomainTakenMessage,
  );
  assert.equal(serverErrorMessage(new Error('Different failure'), 'fallback'), 'Different failure');
  assert.equal(serverErrorMessage(null, 'fallback'), 'fallback');
});

test('a different conflict or outage is never mislabeled as a taken domain', async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  for (const status of [409, 503]) {
    global.fetch = async () => Response.json({ error: 'Unavailable' }, { status });
    await assert.rejects(
      serverAccountRegistry(async () => 'fixture', 'https://example.test').create({}),
      { message: 'Unavailable' },
    );
  }
});
