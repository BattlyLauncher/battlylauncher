const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\0')
    .filter(Boolean);
} catch {
  // GitHub source archives have no Git index; build inputs are still checked below.
  tracked = [];
}
const forbidden = tracked.filter(
  (file) =>
    /^(scripts|server-staging|docs|tasks)\//.test(file) ||
    (/(?:^|\/)\.env(?:\..+)?$/.test(file) && !file.endsWith('.env.example')) ||
    /\.(?:pfx|p12|ppk|tlp|key|keystore|jks)$/i.test(file) ||
    /^build-resources\/battly-tunnel\/[^/]+\/battly-tunnel-client(?:\.exe)?$/.test(file) ||
    /^build-resources\/terracotta\/(?:terracotta(?:-battly)?\.exe|linux-x64\/terracotta)$/.test(
      file,
    ) ||
    file === 'build-resources/worlds-overlay/WindowTracker.exe' ||
    /^src\/renderer\/assets\/history\//.test(file) ||
    /\/launcher\.reference\.html$/.test(file) ||
    (/\.pem$/i.test(file) && file !== 'build-resources/battly-tunnel/latam-ca.pem'),
);
if (forbidden.length) {
  throw new Error('Internal or private files are tracked:\n' + forbidden.join('\n'));
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const commands = [...Object.values(pkg.scripts), pkg.build.beforePack, pkg.build.afterPack].filter(
  Boolean,
);
if (
  commands.some((value) => /(?:^|[\s"'])scripts\//.test(value.replaceAll('public scripts/', '')))
) {
  throw new Error('A build command still points to the private scripts directory');
}
console.log('Public source checked: internal scripts and private configuration are excluded.');
