const fs = require('fs'),
  path = require('path'),
  ts = require('typescript');
const es = require('../src/renderer/i18n/locales/es.json'),
  en = require('../src/renderer/i18n/locales/en.json');
function flatten(tree, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[id] = value;
    else if (value && typeof value === 'object') flatten(value, id, result);
  }
  return result;
}
const source = flatten(es),
  target = flatten(en),
  available = new Set(
    Object.entries(source)
      .filter(([key]) => target[key])
      .map(([, value]) => value),
  );
const ignored = new Set([
  'error',
  'success',
  'warning',
  'info',
  'Battly Music',
  'Battly AutoFix',
  'Battly × Google Drive',
  '{0}',
  '{0} × {1} px',
]);
const missing = new Map();
let checked = 0;
function scan(file) {
  const ast = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function phrase(node) {
    let text;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node))
      text =
        node.head.text + node.templateSpans.map((span, i) => `{${i}}` + span.literal.text).join('');
    else {
      ts.forEachChild(node, phrase);
      return;
    }
    if (!text || ignored.has(text)) return;
    checked++;
    if (!available.has(text)) missing.set(text, file);
  }
  function visit(node) {
    if (ts.isCallExpression(node) && /^(askBattly|showToast)$/.test(node.expression.getText(ast))) {
      node.arguments.forEach((arg) => {
        if (ts.isObjectLiteralExpression(arg))
          arg.properties.forEach((prop) => {
            if (
              ts.isPropertyAssignment(prop) &&
              ['title', 'text', 'confirmText', 'cancelText'].includes(prop.name.getText(ast))
            )
              phrase(prop.initializer);
          });
        else phrase(arg);
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith('.ts')) scan(file);
  }
}
walk(path.resolve(__dirname, '../src/renderer'));
for (const [text, file] of missing) console.error(`${path.relative(process.cwd(), file)}: ${text}`);
console.log(
  `${checked} alert/confirmation literals checked; ${missing.size} missing from English fallback.`,
);
if (missing.size) process.exitCode = 1;
