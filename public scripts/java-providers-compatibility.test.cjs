const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const AdmZip = require('adm-zip');
const { requires64BitMinecraft } = require('../dist/shared/minecraft/platform-compatibility');
const {
  resolveJavaArchive,
  installJavaArchive,
} = require('../dist/main/settings/java-provider-download');
const { ManagedJavaRuntimeService } = require('../dist/main/settings/managed-java-runtime-service');

test('Minecraft 32-bit boundary applies to releases, snapshots and loader profiles', () => {
  for (const version of ['1.8.9', '1.20.4', '24w13a', 'fabric-loader-0.15.0-1.20.4'])
    assert.equal(requires64BitMinecraft(version), false, version);
  for (const version of [
    '1.20.5',
    '1.20.5-pre1',
    '1.21.11',
    '24w14a',
    '25w01a',
    '26.1',
    '26.1.2',
    '26.2-snapshot-1',
    '1.21.1-forge-52.0.0',
    'quilt-loader-0.27.0-1.21',
  ])
    assert.equal(requires64BitMinecraft(version), true, version);
  assert.equal(requires64BitMinecraft('custom-client', '25'), true);
});

test('Mojang remains the default and a failed provider change preserves the installed Java', async () => {
  const root = await mkdtemp(join(tmpdir(), 'battly-managed-provider-test-'));
  const binary = Buffer.from('original Mojang runtime');
  const sha1 = createHash('sha1').update(binary).digest('hex');
  let selected = '';
  const store = {
    snapshot: async () => ({ runtime: { javaPath: selected } }),
    recordManagedJavaRuntime: async () => {},
    selectManagedJavaRuntime: async (_major, path) => {
      selected = path;
    },
  };
  const fetcher = async (url) => {
    if (String(url).includes('index'))
      return Response.json({
        'windows-x64': {
          'java-runtime-gamma': [
            { version: { name: '17-test' }, manifest: { url: 'https://fixture.test/manifest' } },
          ],
        },
      });
    if (String(url).endsWith('/manifest'))
      return Response.json({
        files: {
          'bin/javaw.exe': {
            type: 'file',
            downloads: { raw: { sha1, size: binary.length, url: 'https://fixture.test/java' } },
          },
        },
      });
    if (String(url).endsWith('/java')) return new Response(binary);
    if (String(url).includes('api.adoptium.net')) return Response.json([]);
    throw Error('Unexpected request');
  };
  try {
    const service = new ManagedJavaRuntimeService(join(root, 'runtime'), store, {
      platform: 'win32',
      architecture: 'x64',
      fetchImplementation: fetcher,
      runtimeIndexUrl: 'https://fixture.test/index',
    });
    await service.install(17);
    const snapshot = await service.select(17);
    const runtime = snapshot.runtimes.find((x) => x.major === 17);
    assert.equal(runtime.installed, true);
    await assert.rejects(service.install(17, 'adoptium'), /no está disponible/);
    assert.equal(await readFile(runtime.path, 'utf8'), binary.toString());
    assert.equal((await service.snapshot()).runtimes.find((x) => x.major === 17).selected, true);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('provider packages require architecture and checksum; extraction verifies bytes', async () => {
  const zip = new AdmZip();
  zip.addFile('jdk/bin/javaw.exe', Buffer.from('test runtime'));
  const bytes = zip.toBuffer();
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const fetcher = async (url) => {
    if (String(url).includes('/assets/latest/'))
      return Response.json([
        {
          binary: {
            architecture: 'x64',
            os: 'windows',
            package: { link: 'https://github.com/adoptium/test.zip', checksum, size: bytes.length },
          },
          version: { semver: '17.0.1' },
        },
      ]);
    return new Response(bytes);
  };
  const archive = await resolveJavaArchive('adoptium', 17, 'win32', 'x64', fetcher);
  await assert.rejects(
    resolveJavaArchive('adoptium', 17, 'win32', 'ia32', fetcher),
    /architecture mismatch/,
  );
  const root = await mkdtemp(join(tmpdir(), 'battly-java-provider-test-'));
  try {
    const runtime = await installJavaArchive(archive, root, fetcher, () => {});
    assert.equal(await readFile(join(runtime, 'bin/javaw.exe'), 'utf8'), 'test runtime');
    const advisory = join(root, 'advisory');
    await mkdir(advisory);
    await installJavaArchive(
      { ...archive, size: archive.size + 15, sizeIsExact: false },
      advisory,
      fetcher,
      () => {},
    );
    const invalid = join(root, 'invalid');
    await mkdir(invalid);
    await assert.rejects(
      installJavaArchive({ ...archive, sha256: '0'.repeat(64) }, invalid, fetcher, () => {}),
      /checksum mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
const { randomBytes } = require('node:crypto');
test('buffered downloads preserve chunk boundaries and throttle progress', async () => {
  const payload = randomBytes(2 * 1024 * 1024 + 173);
  const zip = new AdmZip();
  zip.addFile('jdk/bin/javaw.exe', payload);
  const bytes = zip.toBuffer();
  const root = await mkdtemp(join(tmpdir(), 'battly-buffer-test-'));
  let offset = 0;
  let events = 0;
  let extracted = false;
  try {
    const fetcher = async () =>
      new Response(
        new ReadableStream({
          pull(c) {
            if (offset === bytes.length) return c.close();
            const end = Math.min(offset + 8191, bytes.length);
            c.enqueue(bytes.subarray(offset, end));
            offset = end;
          },
        }),
      );
    const runtime = await installJavaArchive(
      {
        url: 'https://github.com/adoptium/test.zip',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        zip: true,
        version: '17',
      },
      root,
      fetcher,
      () => events++,
      () => {
        extracted = true;
      },
    );
    assert.deepEqual(await readFile(join(runtime, 'bin/javaw.exe')), payload);
    assert.equal(extracted, true);
    assert.ok(events < 20, `Too many progress events: ${events}`);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
