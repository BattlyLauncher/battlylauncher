const { build } = require('esbuild');
const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const tooling = join(__dirname, 'core-worker-http');
const undiciPackage = require.resolve('undici/package.json', { paths: [tooling] });
const license = readFileSync(join(dirname(undiciPackage), 'LICENSE'), 'utf8');

// A patch contains dist files, so the worker must work with the base install's node_modules.
build({
  entryPoints: [join(__dirname, 'core-worker-http.cjs')],
  alias: { undici: require.resolve('undici', { paths: [tooling] }) },
  outfile: 'dist/main/minecraft/core-worker-http.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  minify: true,
  banner: { js: `/*\n${license.trimEnd()}\n*/` },
}).catch(() => {
  process.exitCode = 1;
});
