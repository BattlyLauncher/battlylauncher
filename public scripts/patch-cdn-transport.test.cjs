const test = require('node:test'),
  assert = require('node:assert/strict');
const { createCdnPatchFetch } = require('../dist/main/updates/patch-cdn-transport');
const API = 'https://api.github.com/repos/BattlyLauncher/battlylauncher';
const CDN = 'https://cdn.battlylauncher.com/public/updates/patches/';
const hash = 'a'.repeat(64);
const metadata = {
  id: 42,
  name: `${hash}.blob`,
  size: 4,
  state: 'uploaded',
  browser_download_url: `https://github.com/BattlyLauncher/battlylauncher/releases/download/battly-patch-3.1.0-patch7/${hash}.blob`,
};
test('CDN is primary for discovery, asset lists and blobs; no GitHub requests or credentials', async () => {
  const calls = [];
  const fetcher = createCdnPatchFetch({
    fetcher: async (url, options) => {
      calls.push(url);
      assert(url.startsWith(CDN));
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, 'error');
      if (url.endsWith('releases-1.json')) return Response.json([{ id: 5, assets: [metadata] }]);
      if (url.endsWith('assets-1.json')) return Response.json([metadata]);
      if (url.endsWith(hash)) return new Response('blob');
      throw Error(url);
    },
  });
  await fetcher(`${API}/releases?per_page=10&page=1`, {
    headers: { Authorization: 'fixture-secret' },
  });
  await fetcher(`${API}/releases/5/assets?per_page=100&page=1`);
  assert.equal(await (await fetcher(`${API}/releases/assets/42`)).text(), 'blob');
  assert.equal(calls.length, 3);
});
test('CDN outage falls back to GitHub and respects Retry-After without repeated quota requests', async () => {
  let now = 1000,
    github = 0,
    cdn = 0;
  const fetcher = createCdnPatchFetch({
    now: () => now,
    fetcher: async (url) => {
      if (url.startsWith(CDN)) {
        cdn++;
        return new Response(null, { status: 503 });
      }
      github++;
      return new Response(null, { status: 429, headers: { 'retry-after': '300' } });
    },
  });
  assert.equal((await fetcher(`${API}/releases?per_page=10&page=1`)).status, 429);
  for (let attempt = 0; attempt < 4; attempt++)
    await assert.rejects(fetcher(`${API}/releases?per_page=10&page=1`));
  assert.equal(github, 1);
  assert.equal(cdn, 5);
  now += 301_000;
  assert.equal((await fetcher(`${API}/releases?per_page=10&page=1`)).status, 429);
  assert.equal(github, 2);
});
test('fallback blob download uses its public GitHub URL instead of the asset API', async () => {
  const calls = [];
  const fetcher = createCdnPatchFetch({
    fetcher: async (url, options) => {
      calls.push(url);
      if (url.includes('assets-1.json')) return Response.json([metadata]);
      if (url.startsWith(CDN)) return new Response(null, { status: 404 });
      assert.equal(url, metadata.browser_download_url);
      assert.equal(options.headers.Authorization, undefined);
      return new Response('blob');
    },
  });
  await fetcher(`${API}/releases/5/assets?per_page=100&page=1`);
  assert.equal(await (await fetcher(`${API}/releases/assets/42`)).text(), 'blob');
  assert(!calls.includes(`${API}/releases/assets/42`));
});
test('foreign repositories and redirects are never rewritten to the CDN', async () => {
  let calls = 0;
  const fetcher = createCdnPatchFetch({
    fetcher: async (url, options) => {
      calls++;
      assert(url.startsWith('https://api.github.com/repos/private/other/'));
      return Response.json([]);
    },
  });
  await fetcher('https://api.github.com/repos/private/other/releases?per_page=10&page=1');
  assert.equal(calls, 1);
});
test('cancellation and oversized metadata cannot fall through to GitHub', async () => {
  let calls = 0;
  const fetcher = createCdnPatchFetch({
    fetcher: async () => {
      calls++;
      return new Response('x', { headers: { 'content-length': '99999999' } });
    },
  });
  await assert.rejects(
    fetcher(`${API}/releases?per_page=10&page=1`, { signal: AbortSignal.abort() }),
  );
  assert.equal(calls, 0);
  await assert.rejects(fetcher(`${API}/releases?per_page=10&page=1`), /grande|large/);
  assert.equal(calls, 1);
});

test('CDN stream failure retries through the public GitHub download; size violations do not', async () => {
  for (const oversized of [false, true]) {
    let github = 0;
    const transport = createCdnPatchFetch({
      fetcher: async (url) => {
        if (url.includes('assets-1.json')) return Response.json([metadata]);
        if (url.startsWith(CDN))
          return oversized
            ? new Response('corruptly oversized')
            : new Response(
                new ReadableStream({
                  start(controller) {
                    controller.error(new TypeError('connection reset'));
                  },
                }),
              );
        github++;
        return new Response('blob');
      },
    });
    await transport(`${API}/releases/5/assets?per_page=100&page=1`);
    if (oversized) {
      await assert.rejects(transport(`${API}/releases/assets/42`), /grande|large/);
      assert.equal(github, 0);
    } else {
      assert.equal(await (await transport(`${API}/releases/assets/42`)).text(), 'blob');
      assert.equal(github, 1);
    }
  }
});
test('GitHub cooldown does not block CDN recovery', async () => {
  let available = false,
    github = 0;
  const transport = createCdnPatchFetch({
    fetcher: async (url) => {
      if (url.startsWith(CDN))
        return available ? Response.json([]) : new Response(null, { status: 503 });
      github++;
      return new Response(null, { status: 403 });
    },
  });
  assert.equal((await transport(`${API}/releases?per_page=10&page=1`)).status, 403);
  available = true;
  assert.deepEqual(await (await transport(`${API}/releases?per_page=10&page=1`)).json(), []);
  assert.equal(github, 1);
});
