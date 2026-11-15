const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  yaml = require('js-yaml');
test('Actions publication is opt-in and depends on successful builds plus complete verification', () => {
  const w = yaml.load(fs.readFileSync('.github/workflows/battly-updates.yml', 'utf8'));
  assert.equal(w.on.workflow_dispatch.inputs.dry_run.default, true);
  assert(w.on.push.branches.includes('main'));
  assert(w.jobs.publish.if.includes("vars.BATTLY_RELEASE_PUBLISH_ENABLED == 'true'"));
  assert(w.jobs.publish.needs.includes('verify'));
  assert(w.jobs.publish.needs.includes('build'));
  assert.equal(w.permissions.contents, 'read');
  assert.equal(w.jobs.publish.permissions.contents, 'write');
  assert.equal(w.jobs.build.strategy.matrix.include.length, 5);
  assert.equal(w.jobs.flatpak.uses, './.github/workflows/flatpak.yml');
  assert(w.jobs.verify.needs.includes('flatpak'));
  assert(w.env.BATTLY_RELEASE_NOT_BEFORE.includes('vars.BATTLY_RELEASE_NOT_BEFORE'));
  const keys = w.jobs.build.steps.find(
    (s) => s.name === 'Prepare public configuration and signing key',
  );
  assert(keys.env.PATCH_PRIVATE_KEY.includes("needs.plan.outputs.type == 'patch'"));
  const commands = w.jobs.build.steps
    .filter((s) => s.run)
    .map((s) => s.run)
    .join('\n');
  for (const check of [
    'npm run lint',
    'npm run typecheck',
    'npm audit',
    'npm run build',
    'npm run patches:test',
    'patch-electron-smoke.cjs',
  ])
    assert(commands.includes(check));
  assert(commands.includes('BATTLY_PATCH_BASE_CONFIG_FILE'));
  assert(commands.includes('SOURCE_DATE_EPOCH'));
  const uploads = w.jobs.build.steps.find(
    (s) =>
      s.uses?.startsWith('actions/upload-artifact') &&
      s.with?.name === 'update-${{ matrix.platform }}-${{ matrix.arch }}',
  );
  assert.equal(uploads.with.path, 'artifacts/patch-ci/github-assets/*');
});
test('only the canonical workflow automatically publishes a desktop release', () => {
  const legacy = yaml.load(fs.readFileSync('.github/workflows/windows-release.yml', 'utf8'));
  assert(!legacy.on.push && !legacy.on.release);
  const flatpak = yaml.load(fs.readFileSync('.github/workflows/flatpak.yml', 'utf8'));
  assert(Object.hasOwn(flatpak.on, 'workflow_call'));
  assert(!flatpak.on.push);
  assert.equal(flatpak.jobs.flatpak.environment, 'battly-updates-build');
  const upload = flatpak.jobs.flatpak.steps.find((s) =>
    s.uses?.startsWith('actions/upload-artifact'),
  );
  assert.equal(upload.with.name, 'update-flatpak-linux-x64');
});
test('all patch transports and private keys remain outside the patchable runtime tree', () => {
  const source = fs.readFileSync('public scripts/build-patches.cjs', 'utf8');
  assert(source.includes("'bootstrap/github-patch-feed.cjs'"));
  assert(source.includes("files(path.join(root, 'dist'), 'dist/')"));
  const prep = fs.readFileSync('public scripts/prepare-patch-ci.cjs', 'utf8');
  assert(prep.includes('process.env.RUNNER_TEMP'));
  assert(!prep.includes('console.log(secret)'));
});
