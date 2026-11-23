const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

app
  .whenReady()
  .then(async () => {
    const renderer = read('src/renderer/index.ts');
    const parsed = ts.createSourceFile('index.ts', renderer, ts.ScriptTarget.Latest, true);
    const render = parsed.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'showCrashReport',
    );
    const { outputText } = ts.transpileModule(render.getText(parsed), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    const markup = read('src/renderer/index.html').match(
      /<dialog\b[^>]*data-crash-report-dialog[^>]*>[\s\S]*?<\/dialog>/,
    )[0];
    const css = ['main', 'crash-report']
      .map((name) => read('src/renderer/styles/' + name + '.css'))
      .join('\n');
    const window = new BrowserWindow({ show: false, width: 960, height: 740 });
    const fixtureUrl = 'https://battly-crash.test/';
    const assets = new Map([
      ['/assets/fonts/Poppins-Regular.woff2', 'font/woff2'],
      ['/assets/fonts/Poppins-Bold.woff2', 'font/woff2'],
      ['/assets/fonts/Poppins-ExtraBoldItalic.woff2', 'font/woff2'],
      ['/assets/background/dark.webp', 'image/webp'],
    ]);
    window.webContents.session.protocol.handle('https', ({ url }) => {
      const asset = new URL(url).pathname;
      if (assets.has(asset)) {
        return new Response(fs.readFileSync(path.join(root, 'src/renderer', asset)), {
          headers: { 'content-type': assets.get(asset) },
        });
      }
      return new Response(
        '<!doctype html><meta charset="utf-8"><style>' + css + '</style>' + markup,
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy':
              "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self'",
          },
        },
      );
    });
    window.webContents.session.webRequest.onBeforeRequest((details, done) => {
      const url = new URL(details.url);
      done({
        cancel:
          details.url !== fixtureUrl &&
          !(url.href.startsWith(fixtureUrl) && assets.has(url.pathname)),
      });
    });
    await window.loadURL(fixtureUrl);

    const result = await window.webContents.executeJavaScript(`
    (() => {
      const closeMinecraftProgress = () => {};
      let crashLaunchAgain = null;
      const setUiText = (node, text) => { node.textContent = text; };
      const formatCrashLog = (value) => value;
      const renderLogLines = (node, value) => { node.textContent = value; };
      const crashIssueElement = (_report, entry) => {
        const article = document.createElement('article');
        article.textContent = entry.title;
        return article;
      };
      ${outputText}
      const dialog = document.querySelector('[data-crash-report-dialog]');
      const issues = dialog.querySelector('[data-crash-report-issues]');
      const capture = () => ({
        open: dialog.open,
        text: dialog.innerText,
        log: dialog.querySelector('[data-crash-report-log]').textContent,
        logVisible: getComputedStyle(dialog.querySelector('.crash-report-log-card')).display !== 'none',
        issuesVisible: getComputedStyle(issues).display !== 'none' &&
          getComputedStyle(issues.parentElement).display !== 'none',
        issues: issues.childElementCount,
        save: !!dialog.querySelector('[data-crash-save-logs]'),
        discord: !!dialog.querySelector('[data-crash-discord]'),
      });
      const report = {
        issues: [], summary: 'Battly no ha encontrado una solución automática. Guarda los registros y compártelos en Discord para que podamos ayudarte.',
        rawLog: 'Improperly specified VM option',
      };
      showCrashReport(report);
      const unknown = capture();
      showCrashReport({ ...report, issues: [{ title: 'Comprueba la versión de Java', repairs: [{}] }] });
      const recognized = capture();
      showCrashReport({ ...report, stage: 'preflight', issues: [{ title: 'Mods duplicados', repairs: [] }] });
      const preflight = capture();
      showCrashReport(report);
      return { unknown, recognized, preflight, unknownAgain: capture() };
    })()
  `);

    assert.equal(result.unknown.open, true);
    assert.match(result.unknown.text, /Battly no ha encontrado una solución automática/);
    assert.doesNotMatch(result.unknown.text, /Soluciones locales|firma del error/i);
    assert.equal(result.unknown.issues, 0);
    assert.equal(result.unknown.issuesVisible, false);
    assert.equal(result.unknown.logVisible, true);
    assert.equal(result.unknown.log, 'Improperly specified VM option');
    assert.ok(result.unknown.save && result.unknown.discord);
    assert.match(result.recognized.text, /Comprueba la versión de Java/);
    assert.doesNotMatch(result.recognized.text, /Soluciones locales/i);
    assert.equal(result.recognized.issuesVisible, true);
    assert.match(result.preflight.text, /Revisa los mods antes de iniciar/);
    assert.equal(result.preflight.logVisible, false);
    assert.deepEqual(result.unknownAgain, result.unknown);
    console.log('Crash dialog: unknown, recognized and preflight states verified in Electron.');
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
