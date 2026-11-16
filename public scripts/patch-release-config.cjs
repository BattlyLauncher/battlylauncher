'use strict';
const { repositoryName } = require('../bootstrap/github-patch-feed.cjs');
function releaseConfig(pkg) {
  const v = pkg.battlyUpdate;
  if (!v || !['full', 'patch'].includes(v.type) || !['stable', 'beta'].includes(v.channel))
    throw Error('battlyUpdate requires type full/patch and channel stable/beta');
  repositoryName(v.repository);
  if (v.notes !== undefined && (typeof v.notes !== 'string' || v.notes.length > 4000))
    throw Error('Update notes must be text, at most 4000 characters');
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version))
    throw Error('Invalid base version');
  if (v.channel === 'stable' && pkg.version.includes('-'))
    throw Error('A prerelease base cannot publish stable updates');
  if (!Number.isSafeInteger(pkg.battlyBuild) || pkg.battlyBuild < 1)
    throw Error('Invalid base build');
  if (v.type === 'full') return { ...v, tag: `v${pkg.version}`, version: pkg.version };
  if (
    !Number.isSafeInteger(v.build) ||
    v.build <= pkg.battlyBuild ||
    v.patchVersion !== `${pkg.version}-patch${v.build}`
  )
    throw Error('Patch version must be <package.version>-patch<build>, above battlyBuild');
  if (typeof v.baseTag !== 'string' || v.baseTag !== `v${pkg.version}`)
    throw Error('baseTag must reference the full base release');
  return { ...v, tag: `battly-patch-${v.patchVersion}`, version: pkg.version };
}
async function alreadyPublished(update, token, fetcher = globalThis.fetch) {
  const response = await fetcher(
    `https://api.github.com/repos/${update.repository}/releases/tags/${encodeURIComponent(update.tag)}`,
    {
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw Error(`Cannot inspect existing release (${response.status})`);
  const release = await response.json();
  if (typeof release.draft !== 'boolean') throw Error('Invalid existing release');
  return !release.draft;
}
function publicationWindow(notBefore, now = Date.now()) {
  if (!notBefore) return true;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(notBefore))
    throw Error('BATTLY_RELEASE_NOT_BEFORE must be an ISO timestamp with timezone');
  const start = Date.parse(notBefore);
  if (!Number.isFinite(start)) throw Error('Invalid release publication date');
  return now >= start;
}
if (require.main === module)
  void (async () => {
    const fs = require('node:fs'),
      value = releaseConfig(require('../package.json'));
    if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== value.repository)
      throw Error('Publishing from a different repository is not allowed');
    const tooEarly =
      process.env.BATTLY_CI_DRY_RUN !== 'true' &&
      !publicationWindow(process.env.BATTLY_RELEASE_NOT_BEFORE);
    const published =
      !tooEarly &&
      Boolean(
        process.env.GITHUB_OUTPUT &&
          process.env.GH_TOKEN &&
          process.env.BATTLY_CI_DRY_RUN !== 'true'
          ? await alreadyPublished(value, process.env.GH_TOKEN)
          : false,
      );
    const skip = tooEarly || published;
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        Object.entries({
          skip: String(skip),
          published: String(published),
          type: value.type,
          channel: value.channel,
          tag: value.tag,
          baseTag: value.baseTag || value.tag,
        })
          .map(([k, v]) => `${k}=${v}\n`)
          .join(''),
      );
    if (tooEarly) console.log('Release preparation is held until the configured launch date.');
    else if (skip)
      console.log(
        'This version is already published; increment build or version to publish another update.',
      );
    console.log(JSON.stringify(value, null, 2));
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { releaseConfig, alreadyPublished, publicationWindow };
