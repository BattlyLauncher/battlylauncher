const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false });
    window.webContents.session.webRequest.onBeforeRequest((details, done) =>
      done({ cancel: !details.url.startsWith('data:') }),
    );
    await window.loadURL('data:text/html,<meta charset="utf-8"><body></body>');
    const run = (code) => window.webContents.executeJavaScript(code);
    await run(
      buildSync({
        entryPoints: ['src/renderer/i18n/ui-translator.ts'],
        bundle: true,
        format: 'iife',
        globalName: 'Locale',
        write: false,
      }).outputFiles[0].text,
    );
    await run(
      `window.t=new Locale.UiTranslator(${JSON.stringify(require('../src/renderer/i18n/locales/es.json'))});t.setStrings(${JSON.stringify(require('../src/renderer/i18n/locales/en.json'))});void 0`,
    );
    const records = [];
    for (const fragment of require('../artifacts/ui-markup.json')) {
      const result = await run(`
        (() => {
          const parsed = new DOMParser().parseFromString(${JSON.stringify(fragment.text.replace(/\{\d+\}/g, '2'))}, 'text/html');
          parsed
            .querySelectorAll('script,style,link,iframe,object,embed,svg')
            .forEach((element) => element.remove());
          parsed.querySelectorAll('*').forEach((element) => {
            for (const attribute of [...element.attributes])
              if (attribute.name.startsWith('on')) element.removeAttribute(attribute.name);
          });
          document.body.replaceChildren(...parsed.body.childNodes);
          const nodes = [],
            walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (
              !node.parentElement.closest(
                'pre,code,textarea,[translate=no],[data-i18n-dynamic],[data-string-id]',
              )
            )
              nodes.push({ node, source: node.textContent.trim() });
          }
          for (const element of document.querySelectorAll('*'))
            for (const attribute of ['alt', 'title', 'aria-label', 'placeholder', 'aria-description']) {
              if (!element.closest('[translate=no],[data-i18n-dynamic]') && element.hasAttribute(attribute))
                nodes.push({ node: element, attribute, source: element.getAttribute(attribute) });
            }
          t.apply(document.body);
          return nodes
            .filter((entry) => entry.node.isConnected && /[a-záéíóúñ]/i.test(entry.source))
            .map((entry) => ({
              source: entry.source,
              target: entry.attribute
                ? entry.node.getAttribute(entry.attribute)
                : entry.node.textContent.trim(),
              attribute: entry.attribute,
            }));
        })();
      `);
      records.push(
        ...result.map((entry) => ({ ...entry, file: fragment.file, line: fragment.line })),
      );
    }
    const allowed = new Set(require('../resources/locales/ui-unchanged-english.json').values);
    const spanish =
      /[ñ¿¡]|\b(?:encontrad[oa]s?|canciones|reproducir|volver|detalles|calidad|intensidad|seleccionar|importar|del|los|las|una|tus|para|conectar|sin|puedes|hay|servidor|mundo|jugador|amigos|guardar|cerrar|descargar|cargando|ancho|alto|opacidad|buscar|actualizaciones)\b/i;
    const findings = records.filter(
      (entry) =>
        (entry.source === entry.target && !allowed.has(entry.source)) || spanish.test(entry.target),
    );
    fs.writeFileSync('artifacts/ui-markup-rendered.json', JSON.stringify(records, null, 2));
    fs.writeFileSync('artifacts/ui-markup-findings.json', JSON.stringify(findings, null, 2));
    assert.deepEqual(
      findings,
      [],
      'Unreviewed unchanged UI or Spanish fragments; see artifacts/ui-markup-findings.json',
    );
    console.log(
      `PASS ${records.length} text/attribute occurrences across ${new Set(records.map((entry) => entry.file)).size} files; unchanged copy has explicit reviewed classification.`,
    );
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
