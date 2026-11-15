const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { checkDocumentation } = require('./check-documentation.cjs');

test('comprueba que las referencias se puedan publicar en Git y respeta mayúsculas', async (t) => {
  const root = fixture(t, '[Código](../src/example.ts)\n[Pendiente](../src/local.ts)');
  fs.writeFileSync(path.join(root, 'src', 'local.ts'), 'export const local = 1;');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', 'docs/guide.md', 'src/example.ts'], { cwd: root });
  const report = await checkDocumentation(root, { tracked: true });
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0], /no está en Git.*local\.ts/);
});

function fixture(t, markdown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'battly-docs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'example.ts'), 'export const example = 1;');
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), markdown);
  return root;
}

test('revisa enlaces relativos y referencias de Markdown, sin interpretar ejemplos de código', async (t) => {
  const root = fixture(
    t,
    [
      '[Código](../src/example.ts#L1)',
      '[Desde raíz](/src/example.ts)',
      '[Por referencia][source]',
      '[source]: ../src/example.ts',
      '[Externo](https://example.com/no-existe)',
      '[Sección](#ejemplo)',
      '```md',
      '[Ejemplo](../no-es-un-enlace-real.ts)',
      '```',
    ].join('\n\n'),
  );
  const report = await checkDocumentation(root);
  assert.equal(report.files, 1);
  assert.equal(report.links, 3);
  assert.deepEqual(report.failures, []);
});

test('detecta archivos ausentes, rutas del equipo y enlaces que salen del proyecto', async (t) => {
  const root = fixture(
    t,
    [
      '[Ausente](../src/missing.ts)',
      '[Local](file:///C:/personal.txt)',
      '[Fuera](../../personal.txt)',
      '[Escape roto](../src/%ZZ.ts)',
      '![Imagen](missing.png)',
    ].join('\n'),
  );
  const report = await checkDocumentation(root);
  assert.equal(report.failures.length, 5);
  assert.match(report.failures.join('\n'), /no existe/);
  assert.match(report.failures.join('\n'), /no portable/);
  assert.match(report.failures.join('\n'), /fuera del repositorio/);
  assert.match(report.failures.join('\n'), /mal formado/);
});

test('incluye guías, tareas y READMEs propios; conserva avisos de terceros fuera de la revisión', async (t) => {
  const root = fixture(t, '[Código](../src/example.ts)');
  fs.mkdirSync(path.join(root, 'build-resources', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '[Guía](docs/guide.md)');
  fs.writeFileSync(
    path.join(root, 'build-resources', 'agent', 'README.md'),
    '[Código](../../src/example.ts)',
  );
  fs.writeFileSync(
    path.join(root, 'build-resources', 'agent', 'THIRD-PARTY-NOTICES.md'),
    '[Tercero](missing.md)',
  );
  const report = await checkDocumentation(root);
  assert.equal(report.files, 3);
  assert.deepEqual(report.failures, []);
});

test('la revisión pública no lee documentación interna que solo existe en local', async (t) => {
  const root = fixture(t, '[Nota interna](missing-local-file.md)');
  fs.writeFileSync(path.join(root, 'README.md'), '[Código](src/example.ts)');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', 'README.md', 'src/example.ts'], { cwd: root });
  const report = await checkDocumentation(root, { tracked: true });
  assert.equal(report.files, 1);
  assert.deepEqual(report.failures, []);
  assert.equal((await checkDocumentation(root)).failures.length, 1);
});
