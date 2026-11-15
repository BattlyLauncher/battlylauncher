const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { ServerSharingService } = require('../dist/main/servers/server-sharing-service');
const { battlyTunnelRuntimeOptions } = require('../dist/main/servers/battly-tunnel-runtime');

test('the pinned CA accepts Windows line endings but rejects modified certificate bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'battly-ca-line-endings-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  let requests = 0;
  global.fetch = async () => {
    requests++;
    return new Response(null, { status: 503 });
  };
  await mkdir(join(root, 'battly-tunnel'));
  const original = (
    await readFile(
      join(__dirname, '..', 'build-resources', 'battly-tunnel', 'latam-ca.pem'),
      'utf8',
    )
  ).replace(/\r\n/g, '\n');
  for (const certificate of [original, original.replace(/\n/g, '\r\n')]) {
    await writeFile(join(root, 'battly-tunnel', 'latam-ca.pem'), certificate);
    await assert.rejects(
      battlyTunnelRuntimeOptions(root, join(root, 'cache')).prepareFrpc(),
      /download failed/,
    );
  }
  assert.equal(requests, 2);
  await writeFile(join(root, 'battly-tunnel', 'latam-ca.pem'), original + 'modified');
  await assert.rejects(
    battlyTunnelRuntimeOptions(root, join(root, 'cache')).prepareFrpc(),
    /certificado/,
  );
  assert.equal(requests, 2);
});

test('explicit rollout validates settings and client integrity before execution', async () => {
  const keys = [
    'BATTLY_TUNNEL_TRANSPORT',
    'BATTLY_TUNNEL_CLIENT_PATH',
    'BATTLY_TUNNEL_CLIENT_SHA256',
    'BATTLY_TUNNEL_HOST',
    'BATTLY_TUNNEL_PORT',
    'BATTLY_TUNNEL_CA_FILE',
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(join(tmpdir(), 'battly-component-'));
  try {
    for (const key of keys) delete process.env[key];
    assert.deepEqual(battlyTunnelRuntimeOptions(), {});
    process.env.BATTLY_TUNNEL_TRANSPORT = 'battly';
    assert.throws(battlyTunnelRuntimeOptions, /Configura/);
    const path = join(root, 'client');
    const bytes = Buffer.from('client-integrity-fixture');
    await writeFile(path, bytes);
    process.env.BATTLY_TUNNEL_CLIENT_PATH = path;
    process.env.BATTLY_TUNNEL_CLIENT_SHA256 = 'a'.repeat(64);
    process.env.BATTLY_TUNNEL_HOST = 'tunnel.battly.test';
    process.env.BATTLY_TUNNEL_PORT = '7001';
    await assert.rejects(battlyTunnelRuntimeOptions().prepareFrpc(), /dañado/);
    process.env.BATTLY_TUNNEL_CLIENT_SHA256 = createHash('sha256').update(bytes).digest('hex');
    const options = battlyTunnelRuntimeOptions();
    await options.prepareFrpc();
    assert.equal(options.frpcPath, path);
    assert.equal(options.battlyTransport.serverPort, 7001);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('Battly transport keeps provider contract, verifies ready port and cleans credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-own-tunnel-'));
  let wrongPort = false;
  let child;
  const service = new ServerSharingService(
    {
      list: async () => [{ id: 'abc123', domain: 'qa', port: 25565 }],
      directoryPathInternal: async () => root,
    },
    {
      frpcPath: process.execPath,
      frpcSha256: 'a'.repeat(64),
      frpcUrl: 'https://fixture.test/client',
      oidcClientSecret: 'unused',
      temporaryRoot: root,
      tunnelApiUrl: 'https://fixture.test',
      prepareFrpc: async () => {},
      battlyTransport: { serverAddr: 'tunnel.battly.test', serverPort: 7001 },
      fetchImplementation: async (url) =>
        url.endsWith('/create-tunnel')
          ? Response.json({
              status: 'exists',
              hostname: 'qa.battlyservers.net',
              frps_domain: 'frp.battly.test',
              frps_port: 7000,
              remote_port: 30000,
              subdomain: 'qa',
            })
          : Response.json({ amigos: [] }),
      spawnTunnel: (_exe, args, opts) => {
        child = spawn(
          process.execPath,
          [
            '-e',
            `setTimeout(()=>console.log(${JSON.stringify(JSON.stringify({ event: 'ready', remotePort: wrongPort ? 30001 : 30000, tunnelName: 'qa', publicHost: 'tcp.battly.test' }))}),30);setInterval(()=>{},1000)`,
          ],
          opts,
        );
        return child;
      },
    },
  );
  try {
    const ready = (await service.startTunnel('abc123', 'fixture-token')).tunnel;
    assert.equal(ready.status, 'active');
    assert.equal(ready.remotePort, 30000);
    assert.equal(ready.publicHost, 'tcp.battly.test');
    const path = join(
      root,
      (await readdir(root)).find((x) => x.endsWith('.json')),
    );
    const config = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(config.token, 'fixture-token');
    assert.equal(config.serverPort, 7001);
    assert.equal(config.serverAddr, 'tunnel.battly.test');
    assert.equal(config.auth, undefined);
    assert.equal(config.proxies[0].remotePort, 30000);
    child.stdout.emit('data', Buffer.from('{"event":"reconnecting"}\n'));
    assert.equal((await service.snapshot('abc123', 'fixture-token')).tunnel.status, 'error');
    child.stdout.emit(
      'data',
      Buffer.from(
        '{"event":"ready","remotePort":30000,"tunnelName":"qa","publicHost":"tcp.battly.test"}\n',
      ),
    );
    assert.equal((await service.snapshot('abc123', 'fixture-token')).tunnel.status, 'active');
    await service.stopTunnel('abc123');
    assert.deepEqual(await readdir(root), []);
    wrongPort = true;
    await assert.rejects(service.startTunnel('abc123', 'fixture-token'), /distinto al autorizado/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await service.stopTunnel('abc123');
    service.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('LATAM defaults use GitHub release cache and pinned CA; FRP rollback remains available', async () => {
  const previous = process.env.BATTLY_TUNNEL_TRANSPORT;
  const previousFetch = global.fetch;
  const cache = await mkdtemp(join(tmpdir(), 'battly-release-runtime-'));
  try {
    delete process.env.BATTLY_TUNNEL_TRANSPORT;
    const root = join(__dirname, '..', 'build-resources');
    global.fetch = async () => new Response(null, { status: 503 });
    const options = battlyTunnelRuntimeOptions(root, cache);
    assert.equal(options.battlyTransport.serverAddr, 'frp.battly.org');
    assert.equal(options.battlyTransport.serverPort, 7000);
    assert.ok(options.frpcPath.startsWith(cache));
    await assert.rejects(options.prepareFrpc(), /download failed/);
    process.env.BATTLY_TUNNEL_TRANSPORT = 'frp';
    assert.deepEqual(battlyTunnelRuntimeOptions(root), {});
  } finally {
    global.fetch = previousFetch;
    await rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (previous === undefined) delete process.env.BATTLY_TUNNEL_TRANSPORT;
    else process.env.BATTLY_TUNNEL_TRANSPORT = previous;
  }
});
