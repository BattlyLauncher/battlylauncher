'use strict';
const crypto = require('node:crypto');
const PREFIX = 'public/updates/patches/';
const CDN = `https://cdn.battlylauncher.com/${PREFIX}`;
const API = 'https://api.github.com/repos/BattlyLauncher/battlylauncher';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
async function bounded(response, limit) {
  if (!response.ok || !response.body) throw Error(`Mirror request failed (${response.status})`);
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > limit)
      throw Error('Mirror response too large');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error('Mirror response too large');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts);
}
async function mirrorRelease(tag, { token, put, fetcher = fetch }) {
  if (!/^battly-patch-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-patch\d+$/.test(tag))
    throw Error('Expected a published patch tag');
  const api = async (suffix) =>
    JSON.parse(
      (
        await bounded(
          await fetcher(API + suffix, {
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            headers: {
              Accept: 'application/vnd.github+json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }),
          8_000_000,
        )
      ).toString('utf8'),
    );
  const release = await api(`/releases/tags/${tag}`);
  if (
    release.draft ||
    release.prerelease !== true ||
    release.tag_name !== tag ||
    !Number.isSafeInteger(release.id) ||
    release.id <= 0
  )
    throw Error('Patch must already be public');
  const rows = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await api(`/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw Error('Invalid assets');
    rows.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) throw Error('Too many assets');
  }
  if (!rows.length || !rows.some((a) => /^patch-.*\.json$/.test(a.name)))
    throw Error('Missing signed manifests');
  const index = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetcher(`${CDN}releases-${page}.json?sync=${Date.now()}`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404 && page === 1) break;
    const batch = JSON.parse((await bounded(response, 8_000_000)).toString('utf8'));
    if (!Array.isArray(batch)) throw Error('Invalid existing CDN index');
    index.push(...batch);
    if (batch.length < 10) break;
  }
  const write = async (resource, bytes, mutable = false) =>
    put(PREFIX + resource, bytes, {
      ContentType: resource.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      CacheControl: mutable
        ? 'public, max-age=30, must-revalidate'
        : 'public, max-age=31536000, immutable',
      Metadata: { sha256: sha256(bytes) },
    });
  let total = 0;
  const names = new Set();
  // All immutable files are verified and uploaded before any discovery index changes.
  const pending = [...rows];
  async function uploadAssets() {
    while (pending.length) {
      const asset = pending.shift();
      if (
        !Number.isSafeInteger(asset.id) ||
        asset.id <= 0 ||
        asset.state !== 'uploaded' ||
        names.has(asset.name)
      )
        throw Error('Invalid patch asset');
      names.add(asset.name);
      const blob = /^([a-f0-9]{64})\.blob$/.exec(asset.name);
      const manifest =
        /^patch-[a-f0-9]{64}-(stable|beta)-(win32|linux|darwin)-(x64|ia32|arm64)\.json$/.test(
          asset.name,
        );
      const baseline = /^patch-base-(win32|linux|darwin)-(x64|ia32|arm64)\.json$/.test(asset.name);
      if (!blob && !manifest && !baseline) throw Error('Unexpected patch asset');
      const limit = blob ? 64 * 1024 * 1024 : 2_100_000;
      if (
        !Number.isSafeInteger(asset.size) ||
        asset.size < 0 ||
        asset.size > limit ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')
      )
        throw Error('Missing trusted asset checksum');
      const url = `https://github.com/BattlyLauncher/battlylauncher/releases/download/${tag}/${asset.name}`;
      if (asset.browser_download_url !== url) throw Error('Unexpected asset URL');
      const bytes = await bounded(
        await fetcher(url, { signal: AbortSignal.timeout(120_000) }),
        limit,
      );
      if (
        bytes.length !== asset.size ||
        `sha256:${sha256(bytes)}` !== asset.digest ||
        (blob && sha256(bytes) !== blob[1])
      )
        throw Error('Patch asset integrity failure');
      total += bytes.length;
      if (total > 1024 * 1024 * 1024) throw Error('Patch mirror exceeds total size limit');
      await write(blob ? `blobs/${blob[1]}` : `manifests/${asset.id}.json`, bytes);
    }
  }
  await Promise.all(Array.from({ length: 4 }, uploadAssets));
  for (let page = 1; page <= Math.floor(rows.length / 100) + 1; page++)
    await write(
      `releases/${release.id}/assets-${page}.json`,
      Buffer.from(JSON.stringify(rows.slice((page - 1) * 100, page * 100))),
    );
  const mirrored = {
    id: release.id,
    tag_name: tag,
    draft: false,
    prerelease: true,
    assets: rows.filter((a) => a.name.startsWith('patch-')),
  };
  const releases = [mirrored, ...index.filter((r) => r.id !== release.id)].slice(0, 99);
  for (let page = 10; page >= 1; page--)
    await write(
      `releases-${page}.json`,
      Buffer.from(JSON.stringify(releases.slice((page - 1) * 10, page * 10))),
      true,
    );
  return { tag, assets: rows.length, bytes: total };
}
async function main() {
  const { S3Client, PutObjectCommand } = require('node:module').createRequire(
    require('node:path').join(__dirname, 'cdn-publisher/package.json'),
  )('@aws-sdk/client-s3');
  for (const key of [
    'WASABI_ENDPOINT',
    'WASABI_REGION',
    'WASABI_BUCKET',
    'WASABI_KEY',
    'WASABI_SECRET',
  ])
    if (!process.env[key]) throw Error(`Missing mirror setting ${key}`);
  const client = new S3Client({
    endpoint: process.env.WASABI_ENDPOINT,
    region: process.env.WASABI_REGION,
    credentials: {
      accessKeyId: process.env.WASABI_KEY,
      secretAccessKey: process.env.WASABI_SECRET,
    },
  });
  const put = (Key, Body, options) =>
    client.send(
      new PutObjectCommand({
        Bucket: process.env.WASABI_BUCKET,
        Key,
        Body,
        ACL: 'public-read',
        ...options,
      }),
    );
  console.log(
    JSON.stringify(await mirrorRelease(process.argv[2], { token: process.env.GH_TOKEN, put })),
  );
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'No se pudo completar la copia del parche en la CDN. Consulta el estado de GitHub y los permisos del almacenamiento.',
    );
    process.exitCode = 1;
  });
module.exports = { mirrorRelease, PREFIX, CDN };
