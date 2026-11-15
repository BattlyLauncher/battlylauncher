const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { ServerSharingService } = require('../dist/main/servers/server-sharing-service');
test('registers the new domain, starts frpc with the local port, waits for proxy confirmation and cleans up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-tunnel-'));
  const calls = [];
  let registered = false,
    config = '',
    fail = false;
  const server = { id: 'abc123', domain: 'my-world', region: 'eu', port: 25570, version: '26.3' };
  const service = new ServerSharingService(
    { list: async () => [server], directoryPathInternal: async () => root },
    {
      frpcPath: process.execPath,
      frpcUrl: 'https://fixture.test/frpc',
      frpcSha256: 'a'.repeat(64),
      oidcClientSecret: 'fixture',
      temporaryRoot: root,
      prepareFrpc: async () => {},
      fetchImplementation: async (url, options) => {
        assert.equal(new URL(url).hostname, 'root.battly.org', 'Saved EU servers must use LATAM');
        if (url.endsWith('/regions'))
          return Response.json([{ id: 'latam', public_dns_domain: 'battlyservers.net' }]);
        const body = JSON.parse(options.body || '{}');
        calls.push([new URL(url).pathname, body]);
        if (url.endsWith('/servers'))
          return Response.json(
            registered
              ? [
                  {
                    _id: 'remote123',
                    subdomain: 'my-world',
                    hostname: 'my-world.battlyservers.net',
                  },
                ]
              : [],
          );
        if (url.endsWith('/check-if-available')) {
          assert.equal(body.subdomain, 'my-world.battlyservers.net');
          return Response.json({ available: true });
        }
        if (url.endsWith('/create-server')) {
          registered = true;
          assert.equal(body.subdomain, 'my-world.battlyservers.net');
          return Response.json({ status: 'success', _id: 'remote123' });
        }
        if (url.endsWith('/create-tunnel')) {
          assert.equal(body.serverId, 'remote123');
          return Response.json({
            status: 'success',
            hostname: 'my-world.battlyservers.net',
            frps_domain: 'root.battly.org',
            frps_port: 7000,
            remote_port: 30000,
            subdomain: 'my-world',
          });
        }
        return Response.json({ amigos: [] });
      },
      spawnTunnel: (exe, args, opts) => {
        if (process.env.BATTLY_VERIFY_FRPC) {
          const check = spawnSync(process.env.BATTLY_VERIFY_FRPC, ['verify', '-c', args[1]], {
            encoding: 'utf8',
            windowsHide: true,
          });
          assert.equal(check.status, 0, check.stderr || check.stdout);
        }
        return spawn(
          process.execPath,
          [
            '-e',
            fail
              ? fail === 'auth'
                ? `console.error('login to the server failed: oauth2: cannot fetch token: 422 client_secret fixture-token fixture');process.exit(1)`
                : 'process.exit(1)'
              : 'setTimeout(()=>console.log("start proxy success"),50);setInterval(()=>{},1000)',
          ],
          opts,
        );
      },
    },
  );
  try {
    const result = await service.startTunnel(server.id, 'fixture-token');
    assert.equal(result.tunnel.status, 'active');
    assert.equal(result.tunnel.publicAddress, 'my-world.battlyservers.net');
    const file = (await readdir(root)).find((x) => x.endsWith('.json'));
    config = await readFile(join(root, file), 'utf8');
    assert.equal(JSON.parse(config).serverAddr, 'frp.battly.org');
    assert.equal(JSON.parse(config).auth.oidc.tokenEndpointURL, 'https://root.battly.org/token');
    assert.equal(JSON.parse(config).proxies[0].localPort, 25570);
    assert.equal(JSON.parse(config).proxies[0].remotePort, 30000);
    assert.equal(
      calls.some(([path]) => path === '/welcome'),
      false,
    );
    await service.stopTunnel(server.id);
    assert.equal((await readdir(root)).filter((x) => x.endsWith('.json')).length, 0);
    await service.startTunnel(server.id, 'fixture-token');
    assert.equal(calls.filter(([path]) => path === '/create-server').length, 1);
    await service.stopTunnel(server.id);
    fail = true;
    await assert.rejects(service.startTunnel(server.id, 'fixture-token'), /frpc se cerró/);
    fail = 'auth';
    await assert.rejects(service.startTunnel(server.id, 'fixture-token'), (error) => {
      assert.match(error.message, /CLIENT_SECRET/);
      assert.ok(error.message.length < 400);
      assert.ok(!error.message.includes('fixture'));
      return true;
    });
    assert.equal((await service.snapshot(server.id, 'fixture-token')).tunnel.status, 'error');
    assert.equal((await readdir(root)).filter((x) => x.endsWith('.json')).length, 0);
  } finally {
    await service.stopTunnel(server.id);
    service.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('rejects a mismatched production region before creating a remote server or spawning frpc', async () => {
  const calls = [];
  const service = new ServerSharingService(
    { list: async () => [{ id: 'abc123', domain: 'test', region: 'eu' }] },
    {
      frpcPath: process.execPath,
      frpcUrl: 'https://fixture.test/frpc',
      frpcSha256: 'a'.repeat(64),
      oidcClientSecret: 'fixture',
      temporaryRoot: tmpdir(),
      prepareFrpc: async () => assert.fail('Must not prepare frpc for an incompatible provider'),
      fetchImplementation: async (url) => {
        calls.push(new URL(url).pathname);
        return Response.json([{ id: 'latam', public_dns_domain: 'servers.battly.org' }]);
      },
    },
  );
  try {
    await assert.rejects(
      service.startTunnel('abc123', 'fixture-token'),
      /no está configurada para battlyservers.net/,
    );
    assert.deepEqual(calls, ['/regions']);
  } finally {
    service.dispose();
  }
});
