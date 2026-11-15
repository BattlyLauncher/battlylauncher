const { writeAuditReport } = require('./write-audit-report.cjs');
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../src/renderer/i18n/locales');
function flatten(tree, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[id] = value;
    else if (value && typeof value === 'object') flatten(value, id, result);
  }
  return result;
}
const languages = require('../resources/locales/interface-translations.json').languages;
const packs = Object.fromEntries(
  languages.map((language) => [
    language,
    flatten(JSON.parse(fs.readFileSync(path.join(root, `${language}.json`), 'utf8'))),
  ]),
);
const sourceKeys = [...new Set([...Object.keys(packs.es), ...Object.keys(packs.en)])].sort();
const report = {};
for (const language of languages) {
  const missing = sourceKeys.filter((key) => !(key in packs[language]));
  report[language] = {
    translatedKeysPresent: sourceKeys.length - missing.length,
    totalKeys: sourceKeys.length,
    missing,
  };
  console.log(
    `${language}: ${sourceKeys.length - missing.length}/${sourceKeys.length} keys; ${missing.length} using fallback`,
  );
}
const output = path.resolve(__dirname, '../resources/locales/coverage.json');
writeAuditReport(output, JSON.stringify(report, null, 2) + '\n');
// Completeness gate is explicit; never count fallback English as translated.
if (
  process.argv.includes('--require-complete') &&
  Object.values(report).some((item) => item.missing.length)
)
  process.exitCode = 1;
