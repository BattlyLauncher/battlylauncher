const { writeAuditReport } = require('./write-audit-report.cjs');
// Source-wide inventory: presence in a catalogue is not proof of correct runtime localization.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const ts = require('typescript');
const languages = require('../resources/locales/interface-translations.json').languages;
const flatten = (tree, prefix = '', result = {}) => {
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'string') result[prefix + key] = value;
    else if (value && typeof value === 'object') flatten(value, prefix + key + '.', result);
  }
  return result;
};
const packs = Object.fromEntries(
  languages.map((language) => [
    language,
    flatten(require(`../src/renderer/i18n/locales/${language}.json`)),
  ]),
);
const normalize = (text) =>
  text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const known = new Set(Object.values(packs.es).map(normalize));
const sourceTranslations = require('../resources/locales/source-translations.json');
for (const entry of sourceTranslations.entries)
  if (languages.every((language) => entry.translations[language]?.trim()))
    known.add(normalize(entry.source));
const exclusions = require('../resources/locales/source-exclusions.json');
const prose = (text) =>
  /\p{L}/u.test(text) && /\s/.test(text) && !/^(?:https?:|[.#/\\]|-D|-XX)/.test(text);
const spanish =
  /[ñ¿¡]|\b(?:tienes|puedes|quieres|selecciona|cargando|ajustes|contraseña|iniciar sesión|descargando|no se pudo|tu cuenta|jugando|añadir|pantalla|segundo plano|Guardar|Ver amigos|Cargando versiones|Ajustes de Java)\b/iu;
const mixedEnglish =
  /[ñ¿¡]|\b(?:encontrad[oa]s?|el|los|las|una|tus|tu|del|para|con|sin|este|esta|esto|por|hay|tienes|puedes|quieres|debes|cargando|enviar|amigo|cuenta|guardar|borrar|descargar|descarga|archivo|archivos|carpeta|carpetas|solicitud|nombre|ajustes|canciones|correctamente|versión|sesión|selecciona|error al|no se|ya tienes|panel de)\b/iu;
const files = [],
  literals = [],
  unbound = [],
  staticCss = [],
  classified = [],
  markup = [];
function record(file, line, text, context, directUi = false) {
  if (!text.trim()) return;
  const entry = {
    file: file.replaceAll('\\', '/'),
    line,
    text,
    context,
    catalogued: known.has(normalize(text)),
  };
  literals.push(entry);
  if (
    !entry.catalogued &&
    (prose(text) || (directUi && /^[\p{L}][\p{L} -]*[\p{L}]$/u.test(text))) &&
    !/[<>]/.test(text) &&
    ['ui', 'error'].includes(context)
  ) {
    const exclusion = exclusions.find(
      (item) => item.file === entry.file && item.text === entry.text,
    );
    if (exclusion) classified.push({ ...entry, reason: exclusion.reason });
    else unbound.push(entry);
  }
  if (/<(?:div|section|label|button|p|h[1-6]|span|dialog|fieldset)\b/.test(text))
    markup.push({ file: entry.file, line, text });
}
function directUi(node) {
  let value = node;
  while (
    value.parent &&
    (ts.isParenthesizedExpression(value.parent) ||
      (ts.isConditionalExpression(value.parent) && value.parent.condition !== value))
  )
    value = value.parent;
  const parent = value.parent;
  if (!parent) return false;
  if (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === value &&
    /\.(?:textContent|innerText|title|ariaLabel|placeholder)$/.test(parent.left.getText())
  )
    return true;
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === value &&
    /^(?:title|label|message|detail|description|placeholder)$/.test(parent.name.getText())
  )
    return true;
  if (
    ts.isNewExpression(parent) &&
    parent.expression.getText() === 'Option' &&
    parent.arguments?.[0] === value
  )
    return true;
  if (ts.isCallExpression(parent)) {
    const name = parent.expression.getText();
    if (
      /\.setAttribute$/.test(name) &&
      parent.arguments[1] === value &&
      /^['"](?:aria-label|aria-description|title|alt|placeholder)['"]$/.test(
        parent.arguments[0]?.getText(),
      )
    )
      return true;
    if (
      /^(?:setUiText|translateUiText|translateNative)$/.test(name) &&
      parent.arguments[name === 'setUiText' ? 1 : 0] === value
    )
      return true;
  }
  return false;
}
function context(node) {
  for (let n = node, depth = 0; n.parent && depth < 5; n = n.parent, depth++) {
    const parent = n.parent;
    if (ts.isNewExpression(parent) && /(?:Error|Exception)$/.test(parent.expression.getText()))
      return 'error';
    if (ts.isCallExpression(parent)) {
      const name = parent.expression.getText();
      if (/^(?:console\.|.*\.(?:debug|log|trace)$)/.test(name)) return 'diagnostic';
      if (
        /(?:translate|legacyString|setUiText|alertBattly|askBattly|showToast|actionButton|setAttribute|insertAdjacentHTML|notify|showMessageBox|showOpenDialog|showSaveDialog)/i.test(
          name,
        )
      )
        return 'ui';
    }
    if (
      ts.isPropertyAssignment(parent) &&
      /^(?:label|title|message|detail|text|placeholder|ariaLabel|buttonLabel|description)$/.test(
        parent.name.getText(),
      )
    )
      return 'ui';
    if (
      ts.isBinaryExpression(parent) &&
      /\.(?:textContent|innerText|innerHTML|placeholder|title|ariaLabel)$/.test(
        parent.left.getText(),
      )
    )
      return 'ui';
  }
  return 'other';
}
function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.name === 'i18n-source-aliases.ts') continue; // generated from the separately checked catalogue
    if (item.isDirectory()) {
      if (!['assets', 'locales'].includes(item.name)) walk(file);
      continue;
    }
    if (!/\.(?:ts|tsx|js|cjs|html|css)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    files.push({
      file: file.replaceAll('\\', '/'),
      lines: source.split('\n').length,
      sha256: createHash('sha256').update(source).digest('hex'),
    });
    if (file.endsWith('.css')) {
      for (const match of source.matchAll(/(?<![-\w])content\s*:\s*(['"])(.*?)\1/gs)) {
        const text = match[2].replace(/\\[a-f\d]{1,6}\s?/gi, '');
        if (/\p{L}/u.test(text))
          staticCss.push({
            file: file.replaceAll('\\', '/'),
            line: source.slice(0, match.index).split('\n').length,
            text,
            reason: 'Static CSS text cannot follow the selected language',
          });
      }
      continue;
    }
    if (file.endsWith('.html')) {
      markup.push({ file: file.replaceAll('\\', '/'), line: 1, text: source });
      continue;
    }
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let text;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
      else if (ts.isTemplateExpression(node)) {
        text = node.head.text;
        node.templateSpans.forEach((span, index) => {
          text += `{${index}}${span.literal.text}`;
        });
      }
      if (text !== undefined)
        record(
          file,
          ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text,
          directUi(node) ? 'ui' : context(node),
          directUi(node),
        );
      if (
        ts.isTemplateExpression(node) &&
        markup.at(-1)?.file === file.replaceAll('\\', '/') &&
        markup.at(-1)?.line === ast.getLineAndCharacterOfPosition(node.getStart()).line + 1
      ) {
        node.templateSpans.forEach((span, index) => {
          if (/^(?:worldsIcon|icon|softwareIcon)\(/.test(span.expression.getText(ast)))
            markup.at(-1).text = markup.at(-1).text.replaceAll(`{${index}}`, '<!-- icon -->');
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
}
walk('src');
walk('bootstrap');
const quality = [...staticCss];
const slots = (value) =>
  [...value.matchAll(/\{(?:\d+|[A-Za-z_]\w*)\}|%(?:\d+\$)?[sd]/g)]
    .map((x) => x[0])
    .sort()
    .join('|');
for (const entry of sourceTranslations.entries)
  for (const language of languages) {
    const target = entry.translations[language];
    if (!target?.trim() || slots(target) !== slots(entry.source))
      quality.push({
        language,
        source: entry.source,
        target,
        reason: 'Missing sentence or changed placeholders',
      });
  }
for (const language of languages.filter((language) => language !== 'es')) {
  for (const [key, target] of Object.entries(packs[language])) {
    const source = packs.es[key];
    const sharedTechnical = [
      'custom.maxSize',
      'modalFallback.text1620',
      'runtimeCopy.text713',
      'sourceCopy.text203',
    ].includes(key);
    if (
      language !== 'en' &&
      !sharedTechnical &&
      target === packs.en[key] &&
      target !== source &&
      (target.match(/[A-Za-z]{2,}/g) ?? []).length >= 3
    )
      quality.push({
        language,
        key,
        source,
        target,
        reason: 'English sentence copied into another language',
      });
    if (language === 'en' && mixedEnglish.test(target))
      quality.push({ language, key, source, target, reason: 'Spanish fragments in English' });
    else if (
      ['de', 'fr', 'it', 'ru', 'ja', 'ar', 'zh'].includes(language) &&
      /\b(?:Guardar|Cargando versiones|Ver amigos|Ajustes de Java)\b/.test(target)
    )
      quality.push({ language, key, source, target, reason: 'Untranslated Spanish label' });
    // Guardar and Ver amigos are valid Portuguese; shared words are not proof of Spanish leakage.
    else if (language === 'pt' && /\b(?:Cargando|Descargando|Ajustes de Java)\b/.test(target))
      quality.push({ language, key, source, target, reason: 'Spanish wording in Portuguese' });
    if (/__BATTLY_KEEP_|ZXQI\d+QXZ|\uFFFD/.test(target))
      quality.push({ language, key, source, target, reason: 'Corrupt translation token' });
    if (source?.includes('Battly Worlds') && !target.includes('Battly Worlds'))
      quality.push({ language, key, source, target, reason: 'Translated product name' });
  }
}
const report = {
  scope:
    'Every TS/TSX/JS literal and template in main, renderer and shared, plus HTML documents and CSS content declarations; binary assets and locale JSON are inventoried separately. Candidate lists require review: technical errors and dynamic/user strings are not automatically translated. Heuristics cannot certify the grammar of every language.',
  files: files.map((file) => {
    const entries = literals.filter((entry) => entry.file === file.file);
    return {
      ...file,
      stringExpressions: entries.length,
      cataloguedExpressions: entries.filter((entry) => entry.catalogued).length,
      uiExpressions: entries.filter((entry) => entry.context === 'ui').length,
      errorExpressions: entries.filter((entry) => entry.context === 'error').length,
      markupFragments: markup.filter((entry) => entry.file === file.file).length,
      pendingCandidates: unbound.filter((entry) => entry.file === file.file).length,
    };
  }),
  summary: {
    files: files.length,
    lines: files.reduce((n, f) => n + f.lines, 0),
    sourceStrings: literals.length,
    htmlOrGeneratedFragments: markup.length,
    catalogueStrings: Object.values(packs).reduce((n, p) => n + Object.keys(p).length, 0),
    uncataloguedUiCandidates: unbound.length,
    lowLevelErrorCandidates: unbound.filter((entry) => entry.context === 'error').length,
    uiContextCandidates: unbound.filter((entry) => entry.context === 'ui').length,
    classifiedTechnicalCandidates: classified.length,
    qualityIssues: quality.length,
  },
  quality,
  classifiedTechnicalCandidates: classified,
  uncataloguedUiCandidates: unbound,
};
writeAuditReport('resources/locales/review-inventory.json', JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--markup-out'))
  writeAuditReport(process.argv[process.argv.indexOf('--markup-out') + 1], JSON.stringify(markup));
if (process.argv.includes('--literal-out'))
  writeAuditReport(
    process.argv[process.argv.indexOf('--literal-out') + 1],
    JSON.stringify(literals),
  );
console.log(JSON.stringify(report.summary, null, 2));
if (process.argv.includes('--require-quality') && (quality.length || unbound.length)) {
  console.error(
    `Localization quality failed: ${quality.length} findings, ${unbound.length} unclassified sources; see resources/locales/review-inventory.json`,
  );
  process.exitCode = 1;
}
