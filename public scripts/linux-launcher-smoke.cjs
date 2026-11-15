const { spawn } = require('node:child_process'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
(async () => {
  assert.equal(process.platform, 'linux');
  // Startup verification must not depend on the live launch-day maintenance flag.
  const configServer = require('node:http').createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        maintenance: false,
        latestVersion: require('../package.json').version,
        client_id: 'linux-smoke',
        verify: true,
        java: true,
        game_args: [],
        loader: { type: 'release', build: 'stable', enable: true },
        christmasTheme: { enabled: false, songEnabled: false },
      }),
    );
  });
  await new Promise((resolve) => configServer.listen(0, '127.0.0.1', resolve));
  configServer.unref();
  const configUrl = `http://127.0.0.1:${configServer.address().port}/config.json`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-linux-profile-'));
  const child = spawn(
    process.env.BATTLY_LINUX_EXECUTABLE || require('electron'),
    [
      ...(process.env.BATTLY_LINUX_EXECUTABLE ? [] : ['.']),
      '--remote-debugging-port=19227',
      ...(process.env.BATTLY_TEST_WAYLAND ? ['--ozone-platform=wayland'] : []),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BATTLY_LAUNCHER_CONFIG_URL: configUrl,
        BATTLY_USER_DATA_PATH: profile,
        BATTLY_PROFILE_STORE_PATH: path.join(profile, 'battly-data.json'),
        BATTLY_LEGACY_STORE_PATH: path.join(profile, 'absent.json'),
        BATTLY_CONTENT_ROOT: path.join(profile, 'game'),
        BATTLY_INSTANCES_PATH: path.join(profile, 'game/instances'),
        BATTLY_DISABLE_SOCIAL_REALTIME: '1',
        BATTLY_DISABLE_SERVER_RUNTIME: '1',
        BATTLY_DISABLE_GAME_LAUNCH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  let processFailure;
  let processExit;
  fs.writeFileSync('/tmp/battly-linux-launcher.log', '');
  const record = (b) => {
    output += b;
    fs.appendFileSync('/tmp/battly-linux-launcher.log', b);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.once('error', (error) => {
    processFailure = error;
    console.error('Launcher process failed to start:', error.message);
  });
  child.once('exit', (code, signal) => {
    processExit = { code, signal };
    console.log('Launcher process exited:', JSON.stringify(processExit));
  });
  let socket;
  const watchdog = setTimeout(() => {
    socket?.close();
    child.kill('SIGKILL');
    fs.writeFileSync('/tmp/battly-linux-launcher.log', output);
    console.error('Launcher smoke exceeded its 120-second deadline.');
    process.exit(1);
  }, 120000);
  try {
    let page;
    let lastTargets = [];
    const startupDeadline = Date.now() + 60_000;
    for (; Date.now() < startupDeadline;) {
      if (processFailure || processExit) break;
      await new Promise((r) => setTimeout(r, 200));
      const pages = await fetch('http://127.0.0.1:19227/json', {
        signal: AbortSignal.timeout(1000),
      })
        .then((r) => r.json())
        .catch(() => []);
      lastTargets = Array.isArray(pages) ? pages : [];
      page = lastTargets.find((p) => typeof p.url === 'string' && p.url.includes('/index.html'));
      if (page) break;
    }
    if (!page) {
      const targetSummary = lastTargets.map((target) => {
        let url = '';
        try {
          const parsed = new URL(target.url);
          url =
            parsed.protocol === 'data:'
              ? 'data:'
              : parsed.protocol === 'file:'
                ? 'file:/' + parsed.pathname.split('/').pop()
                : parsed.origin + parsed.pathname.slice(0, 160);
        } catch {
          url = '(unavailable)';
        }
        return { type: target.type, title: String(target.title || '').slice(0, 160), url };
      });
      console.error('Startup DevTools targets:', JSON.stringify(targetSummary));
      console.error(
        'Startup process state:',
        JSON.stringify({
          pid: child.pid,
          exit: processExit ?? null,
          spawnError: processFailure
            ? { name: processFailure.name, code: processFailure.code }
            : null,
        }),
      );
      if (processFailure) throw processFailure;
    }
    assert(page, 'Launcher window did not load: ' + output.slice(-3000));
    console.log('Target:', page.url);
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      socket.onopen = r;
      socket.onerror = j;
    });
    let id = 0;
    const pending = new Map();
    socket.onmessage = (e) => {
      const v = JSON.parse(e.data);
      if (pending.has(v.id)) {
        pending.get(v.id)(v);
        pending.delete(v.id);
      }
    };
    const call = (method, params = {}) =>
      new Promise((r, j) => {
        const timer = setTimeout(() => j(Error('CDP timeout: ' + method)), 10000);
        const done = (v) => {
          clearTimeout(timer);
          r(v);
        };
        const next = ++id;
        pending.set(next, done);
        socket.send(JSON.stringify({ id: next, method, params }));
      });
    await new Promise((r) => setTimeout(r, 1000));
    let result = await call('Runtime.evaluate', {
      expression: `({title:document.title,text:document.body.innerText.slice(0,2500),bridge:typeof window.battly,errors:document.querySelectorAll('[data-error]').length})`,
      returnByValue: true,
    });
    for (
      let i = 0;
      i < 35 &&
      (!result.result.result.value.text.trim() ||
        result.result.result.value.text.includes('Cargando panel'));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      result = await call('Runtime.evaluate', {
        expression:
          '({title:document.title,text:document.body.innerText.slice(0,2500),bridge:typeof window.battly})',
        returnByValue: true,
      });
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      result = await call('Runtime.evaluate', {
        expression: `
          (async () => {
            const clickVisible = (selector) => {
              const button = document.querySelector(selector);
              if (button?.getClientRects().length) button.click();
            };
            clickVisible('.release-video-skip');
            return {
              title: document.title,
              text: document.body.innerText.slice(0, 2500),
              bridge: typeof window.battly,
              loginControls: [...document.querySelectorAll('[data-welcome-auth]')].filter(
                (button) => button.getClientRects().length,
              ).length,
              introVisible: Boolean(document.querySelector('.release-video-skip')?.getClientRects().length),
            };
          })();
        `,
        awaitPromise: true,
        returnByValue: true,
      });
      if (
        !result.result.result.value?.introVisible &&
        result.result.result.value?.text.length > 100
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.log('Post-intro snapshot:', JSON.stringify(result.result.result.value));
    const onboardingImage = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      '/tmp/battly-linux-postintro.png',
      Buffer.from(onboardingImage.result.data, 'base64'),
    );
    assert.equal(result.result.result.value.introVisible, false, 'Introduction did not close');

    assert.equal(result.result.result.value.bridge, 'object');
    console.log(JSON.stringify(result.result.result.value));
    assert(result.result.result.value.text.trim().length > 30, 'No visible launcher controls');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      '/tmp/battly-linux-launcher.png',
      Buffer.from(screenshot.result.data, 'base64'),
    );
    console.log('PASS: actual launcher startup and preload bridge on Linux');
  } finally {
    configServer.close();
    clearTimeout(watchdog);
    socket?.close();
    if (process.env.BATTLY_TEST_FLATPAK_ID) {
      await new Promise((resolve) =>
        require('node:child_process').execFile(
          'flatpak',
          ['kill', process.env.BATTLY_TEST_FLATPAK_ID],
          { timeout: 10000 },
          resolve,
        ),
      );
    }
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) {
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('exit', () => clearTimeout(killTimer));
    }
    fs.writeFileSync('/tmp/battly-linux-launcher.log', output);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
