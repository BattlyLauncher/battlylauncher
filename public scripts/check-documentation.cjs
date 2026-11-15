const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

function documentationFiles(root) {
  const files = [];
  function visit(directory, readmesOnly = false) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, readmesOnly);
      else if (readmesOnly ? entry.name === 'README.md' : entry.name.endsWith('.md'))
        files.push(absolute);
    }
  }
  for (const directory of ['docs', 'tasks']) {
    const absolute = path.join(root, directory);
    if (fs.existsSync(absolute)) visit(absolute);
  }
  const readme = path.join(root, 'README.md');
  if (fs.existsSync(readme)) files.push(readme);
  // Resource READMEs belong to the project; licenses and font notices do not.
  for (const directory of ['build-resources', 'src/renderer/assets/audio']) {
    const absolute = path.join(root, directory);
    if (!fs.existsSync(absolute)) continue;
    visit(absolute, true);
  }
  return files.sort();
}

async function checkDocumentation(root = projectRoot, options = {}) {
  const { marked } = await import('marked');
  const trackedFiles = options.tracked
    ? new Set(
        execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
          .split('\0')
          .filter(Boolean),
      )
    : undefined;
  const failures = [];
  let links = 0;
  const files = documentationFiles(root).filter(
    (file) =>
      !trackedFiles || trackedFiles.has(path.relative(root, file).replaceAll(path.sep, '/')),
  );
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const references = [];
    marked.walkTokens(marked.lexer(markdown), (token) => {
      if (token.type === 'link' || token.type === 'image') references.push(token.href);
    });
    for (const href of references) {
      if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/i.test(href)) continue;
      links += 1;
      const source = path.relative(root, file).replaceAll(path.sep, '/');
      if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(href) || /^[a-z][a-z\d+.-]*:/i.test(href)) {
        failures.push(`${source}: enlace local no portable: ${href}`);
        continue;
      }
      let target;
      try {
        const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0]);
        target = path.resolve(
          href.startsWith('/') ? root : path.dirname(file),
          pathname.replace(/^\//, ''),
        );
      } catch {
        failures.push(`${source}: enlace mal formado: ${href}`);
        continue;
      }
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        failures.push(`${source}: enlace fuera del repositorio: ${href}`);
      } else if (!fs.existsSync(target)) {
        failures.push(`${source}: no existe ${href}`);
      } else if (trackedFiles) {
        const portablePath = relative.replaceAll(path.sep, '/');
        const available = fs.statSync(target).isDirectory()
          ? [...trackedFiles].some((file) => file.startsWith(`${portablePath}/`))
          : trackedFiles.has(portablePath);
        if (!available) failures.push(`${source}: el destino no está en Git: ${href}`);
      }
    }
  }
  return { files: files.length, links, failures };
}

if (require.main === module) {
  checkDocumentation(projectRoot, { tracked: process.argv.includes('--tracked') })
    .then((report) => {
      console.log(`${report.files} documentos; ${report.links} referencias locales.`);
      for (const failure of report.failures) console.error(failure);
      if (report.failures.length) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { checkDocumentation, documentationFiles };
