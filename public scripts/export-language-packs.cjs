const fs = require('node:fs'),
  path = require('node:path');
const standalone = process.argv[2] === '--out';
const apiRoot = standalone ? process.argv[3] : process.argv[2];
if (!apiRoot || (!standalone && !fs.existsSync(path.join(apiRoot, 'routes/launcher/index.js')))) {
  throw Error(
    'Usage: node public scripts/export-language-packs.cjs <BattlyAPIV3 checkout> | --out <deployment directory>',
  );
}
const output = path.resolve(apiRoot, 'BattlyLauncherPublic/launcher/locales');
fs.mkdirSync(output, { recursive: true });
for (const language of require('../resources/locales/interface-translations.json').languages) {
  const source = path.resolve(__dirname, `../src/renderer/i18n/locales/${language}.json`);
  JSON.parse(fs.readFileSync(source, 'utf8'));
  const target = path.join(output, `${language}.json`);
  const temporary = target + `.next-${process.pid}`;
  fs.copyFileSync(source, temporary);
  fs.renameSync(temporary, target);
}
console.log(`Exported 10 JSON packs to ${output}. No deployment performed.`);
