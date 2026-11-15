'use strict';
const fs = require('node:fs');
const { repositoryName } = require('../bootstrap/github-patch-feed.cjs');

function prepareRepository(pkg, env) {
  if (env.BATTLY_CI_DRY_RUN !== 'true') return pkg;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch')
    throw Error('Test repository redirection requires an Actions manual dry run');
  repositoryName(env.GITHUB_REPOSITORY);
  if (!pkg.battlyUpdate) throw Error('Missing update configuration');
  return {
    ...pkg,
    battlyUpdate: { ...pkg.battlyUpdate, repository: env.GITHUB_REPOSITORY },
  };
}

if (require.main === module) {
  const file = require('node:path').resolve('package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = prepareRepository(pkg, process.env);
  if (next !== pkg) {
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
    console.log('Dry-run packages target ' + next.battlyUpdate.repository);
  }
}
module.exports = { prepareRepository };
