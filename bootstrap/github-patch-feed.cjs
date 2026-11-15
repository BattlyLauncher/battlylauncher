'use strict';
// Immutable transport. Only API requests to this repository receive credentials.
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
function repositoryName(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)
  ) {
    throw Error('Invalid patch repository');
  }
  return value;
}
function createGitHubFeed({
  repository,
  fetcher = globalThis.fetch,
  token = process.env.BATTLY_PATCH_GITHUB_TOKEN,
}) {
  const repo = repositoryName(repository),
    api = `https://api.github.com/repos/${repo}`;
  async function read(url, limit, signal, binary = false) {
    let next = url;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const target = new URL(next);
      if (
        target.protocol !== 'https:' ||
        !HOSTS.has(target.hostname) ||
        target.username ||
        target.password ||
        target.port
      ) {
        throw Error('Invalid GitHub patch URL');
      }
      const headers = {
        Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (
        token &&
        target.origin === 'https://api.github.com' &&
        target.pathname.startsWith(`/repos/${repo}/`)
      ) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetcher(target.href, { headers, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) {
          throw Error('Invalid GitHub patch redirect');
        }
        next = new URL(location, target).href;
        continue;
      }
      if (!response.ok || !response.body) {
        throw Error(`GitHub patch request failed (${response.status})`);
      }
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        if (Number(response.headers.get('content-length')) > limit) {
          throw Error('GitHub patch response too large');
        }
        for (;;) {
          const part = await reader.read();
          if (part.done) {
            break;
          }
          size += part.value.length;
          if (size > limit) {
            throw Error('GitHub patch response too large');
          }
          chunks.push(Buffer.from(part.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const bytes = Buffer.concat(chunks);
      return binary ? bytes : JSON.parse(bytes.toString('utf8'));
    }
    throw Error('Too many GitHub patch redirects');
  }
  async function assets(release, signal) {
    if (!Number.isSafeInteger(release) || release <= 0) {
      throw Error('Invalid GitHub release');
    }
    const result = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await read(
        `${api}/releases/${release}/assets?per_page=100&page=${page}`,
        2_100_000,
        signal,
      );
      if (!Array.isArray(rows)) {
        throw Error('Invalid GitHub assets');
      }
      result.push(...rows);
      if (rows.length < 100) {
        return result;
      }
    }
    throw Error('Too many GitHub patch assets');
  }
  async function candidates(config, channel, signal) {
    const name = `patch-${config.runtimeId}-${channel}-${config.platform}-${config.arch}.json`,
      result = [];
    for (let page = 1; page <= 10; page++) {
      const releases = await read(`${api}/releases?per_page=10&page=${page}`, 8_000_000, signal);
      if (!Array.isArray(releases)) {
        throw Error('Invalid GitHub releases');
      }
      for (const release of releases) {
        if (
          release.draft ||
          release.prerelease !== true ||
          typeof release.tag_name !== 'string' ||
          !release.tag_name.startsWith(`battly-patch-${config.version || ''}`) ||
          !Number.isSafeInteger(release.id)
        ) {
          continue;
        }
        // Reuse embedded manifest metadata; enumerate blobs only for the selected build.
        const embedded = Array.isArray(release.assets)
          ? release.assets.find((a) => a.name === name)
          : undefined;
        const rows = embedded ? undefined : await assets(release.id, signal),
          manifest = embedded || rows.find((a) => a.name === name);
        if (!manifest) {
          continue;
        }
        result.push({
          envelope: JSON.parse((await asset(manifest, 2_100_000, signal)).toString('utf8')),
          assets: rows,
          releaseId: release.id,
        });
        if (result.length >= 20) {
          return result;
        }
      }
      if (releases.length < 10) {
        return result;
      }
    }
    throw Error('Patch release search limit exceeded');
  }
  async function asset(value, limit, signal) {
    if (
      !value ||
      !Number.isSafeInteger(value.id) ||
      value.id <= 0 ||
      !Number.isSafeInteger(value.size) ||
      value.size < 0 ||
      value.size > limit ||
      value.state !== 'uploaded'
    ) {
      throw Error('Invalid GitHub patch asset');
    }
    return read(`${api}/releases/assets/${value.id}`, limit, signal, true);
  }
  return { candidates, asset, assets };
}
module.exports = { createGitHubFeed, repositoryName };
