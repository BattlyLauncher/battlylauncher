const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../dist/main/i18n/locales');
fs.mkdirSync(output, { recursive: true });
for (const language of require('../resources/locales/interface-translations.json').languages) {
  fs.copyFileSync(
    path.resolve(__dirname, `../src/renderer/i18n/locales/${language}.json`),
    path.join(output, `${language}.json`),
  );
}

const compatibilityOutput = path.resolve(__dirname, '../dist/main/minecraft/compatibility');
fs.mkdirSync(compatibilityOutput, { recursive: true });
fs.copyFileSync(
  path.resolve(__dirname, '../resources/compatibility/batmod-startup.class'),
  path.join(compatibilityOutput, 'batmod-startup.class'),
);
