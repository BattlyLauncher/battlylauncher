const { writeAuditReport } = require('./write-audit-report.cjs');
// Inventory candidates, not a claim that every matching literal is user-visible.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const languages = require('../resources/locales/interface-translations.json').languages;
const flatten = (tree, prefix = '', result = {}) => {
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix + key;
    if (typeof value === 'string') result[id] = value;
    else if (value && typeof value === 'object') flatten(value, id + '.', result);
  }
  return result;
};
const packs = Object.fromEntries(
  languages.map((language) => [
    language,
    flatten(require(`../src/renderer/i18n/locales/${language}.json`)),
  ]),
);
const normalize = (value) => value.replace(/\s+/g, ' ').trim();
const known = new Set(Object.values(packs.es).map(normalize));
for (const entry of require('../resources/locales/source-translations.json').entries)
  known.add(normalize(entry.source));
const spanish = /[áéíóúñ¿]|\b(para|puedes|tus|una|del|No se|Cargando)\b/;
const candidates = [];
const internalLogs = [];
const invalidPlaceholders = [];
const slots = (value) =>
  [...value.matchAll(/\{(?:\d+|[A-Za-z_]\w*)\}|%(?:\d+\$)?[sd]/g)]
    .map((match) => match[0])
    .sort()
    .join(',');
for (const language of languages) {
  for (const [key, source] of Object.entries(packs.es)) {
    const target = packs[language][key];
    if (target !== undefined && slots(source) !== slots(target))
      invalidPlaceholders.push({ language, key, source, target });
  }
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['legacy', 'assets', 'locales'].includes(entry.name)) walk(file);
    } else if (file.endsWith('.ts')) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node) {
        let text;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
        else if (ts.isTemplateExpression(node)) {
          text = node.head.text;
          node.templateSpans.forEach((span, index) => {
            text += `{${index}}${span.literal.text}`;
          });
        }
        let context = node;
        while (context.parent && ts.isConditionalExpression(context.parent))
          context = context.parent;
        const assignment = context.parent;
        const uiAssignment =
          assignment &&
          ts.isBinaryExpression(assignment) &&
          assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(assignment.left) &&
          ['textContent', 'innerText', 'placeholder', 'title', 'ariaLabel'].includes(
            assignment.left.name.text,
          );
        const nativeGreeting = file.endsWith('splash.ts') && text === 'Olá!';
        if (
          text &&
          text.length < 1000 &&
          !/[<>\n]/.test(text) &&
          !/^(-XX|\d)/.test(text) &&
          !nativeGreeting &&
          (spanish.test(text) || (uiAssignment && /\p{L}/u.test(text))) &&
          !known.has(normalize(text))
        ) {
          const item = {
            file: file.replaceAll('\\', '/'),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text,
          };
          // Only direct console arguments are diagnostic copy. Error messages,
          // notifications and strings assigned to UI still require translations.
          const call = node.parent;
          const diagnostic =
            ts.isCallExpression(call) &&
            ts.isPropertyAccessExpression(call.expression) &&
            ts.isIdentifier(call.expression.expression) &&
            call.expression.expression.text === 'console' &&
            ['log', 'warn', 'error', 'info', 'debug', 'trace'].includes(call.expression.name.text);
          (diagnostic ? internalLogs : candidates).push(item);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
walk('src/main');
walk('src/renderer');
walk('src/shared');
const report = {
  scope:
    'Source candidates include internal errors and logs. HTML panels and generated markup are checked by the Electron audits. Runtime/API text and concatenated sentences require flow verification.',
  invalidPlaceholders,
  internalLogs,
  untranslatedEnglishKeys: Object.entries(packs.es)
    .filter(
      ([key, source]) => packs.en[key] === source && spanish.test(source) && source !== 'Español',
    )
    .map(([key, source]) => ({ key, source })),
  candidates,
};
writeAuditReport('resources/locales/source-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  `${candidates.length} source candidates; ${invalidPlaceholders.length} invalid placeholders; ${report.untranslatedEnglishKeys.length} Spanish candidates unchanged in English.`,
);
if (invalidPlaceholders.length || (process.argv.includes('--require-known') && candidates.length)) {
  for (const item of candidates)
    console.error(`${item.file}:${item.line}: missing translation: ${JSON.stringify(item.text)}`);
  for (const item of invalidPlaceholders)
    console.error(`${item.language}:${item.key}: translation placeholders do not match`);
  console.error(
    'Localization verification failed. See resources/locales/source-audit.json for details.',
  );
  process.exitCode = 1;
}
