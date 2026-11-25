const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const AdmZip = require('adm-zip');
const { CurseForgeCatalog } = require('../dist/main/mods/curseforge-catalog');
const { CurseForgeModpackInstaller } = require('../dist/main/mods/curseforge-modpack-installer');
const { MrpackInstaller } = require('../dist/main/mods/mrpack-installer');
const { ServerModloaderCatalog } = require('../dist/main/servers/server-modloader-catalog');
const {
  acceptServerModpackPath,
  installServerModpackContents,
  serverModpackSoftware,
} = require('../dist/main/servers/server-modpack-service');

async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'battly-server-modpack-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('the CurseForge catalog downloads the linked server ZIP for server installs', async (t) => {
  const directory = await temporaryDirectory(t);
  const base = 'https://api.battlylauncher.com/curseforge/';
  const clientBytes = Buffer.from('client ZIP');
  const serverBytes = Buffer.from('server ZIP');
  const makeFile = (id, bytes, data) => ({
    id,
    modId: 150,
    gameId: 432,
    gameVersions: ['1.18.2', 'Forge'],
    fileLength: bytes.length,
    hashes: [{ algo: 1, value: createHash('sha1').update(bytes).digest('hex') }],
    downloadUrl: 'https://edge.forgecdn.net/files/1234/' + id + '/' + data.fileName,
    ...data,
  });
  const client = makeFile(200, clientBytes, { fileName: 'client.zip', serverPackFileId: 201 });
  const server = makeFile(201, serverBytes, {
    fileName: 'server.zip',
    isServerPack: true,
    parentProjectFileId: 200,
  });
  const files = new Map([
    [base + 'mod/150', { id: 150, name: 'Isle of Berk', gameId: 432, classId: 4471 }],
    [base + 'mod/150/file/200', client],
    [base + 'mod/150/file/201', server],
  ]);
  const catalog = new CurseForgeCatalog(base, async (url) => {
    if (files.has(String(url))) {
      return Response.json({ data: { data: files.get(String(url)) } });
    }
    assert.equal(String(url), server.downloadUrl);
    return new Response(serverBytes);
  });
  const destination = join(directory, 'server.zip');
  const filename = await catalog.downloadPack(
    {
      projectId: 'curseforge-150',
      projectType: 'modpack',
      gameVersion: '1.18.2',
      loader: 'forge',
      versionId: '200',
    },
    destination,
    undefined,
    undefined,
    true,
  );
  assert.equal(filename, 'server.zip');
  assert.deepEqual(await fs.readFile(destination), serverBytes);
});

test('reads Forge from a dedicated CurseForge server pack and imports only server content', async (t) => {
  const directory = await temporaryDirectory(t);
  const archive = join(directory, 'server.zip');
  const staged = join(directory, 'staged');
  const target = join(directory, 'server');
  const zip = new AdmZip();
  zip.addFile(
    'pack/manifest.json',
    Buffer.from(
      JSON.stringify({
        serverPackCreatorVersion: '9.4.0',
        minecraftVersion: '1.18.2',
        modloader: 'Forge',
        modloaderVersion: '40.3.12',
      }),
    ),
  );
  for (const path of [
    'mods/server.jar',
    'config/default.toml',
    'patchouli_books/book.json',
    'start.ps1',
    'server.properties',
    'world/level.dat',
  ]) {
    zip.addFile('pack/' + path, Buffer.from('pack'));
  }
  zip.writeZip(archive);
  await fs.mkdir(join(target, 'world'), { recursive: true });
  await fs.writeFile(join(target, 'world/level.dat'), 'original world');
  let checked;
  const pack = await new CurseForgeModpackInstaller(staged, {
    fetchImplementation: () => assert.fail('server ZIP is self-contained'),
  }).install(archive, undefined, undefined, undefined, {
    acceptPath: acceptServerModpackPath,
    checkMetadata: async (entry) => {
      checked = serverModpackSoftware(entry, '1.18.2');
    },
  });
  assert.deepEqual(checked, { kind: 'forge', build: '40.3.12' });
  assert.throws(() => serverModpackSoftware(pack, '1.20.1'), /Minecraft 1.18.2/);
  await assert.rejects(
    installServerModpackContents(join(staged, pack.id), target, async () => {
      throw new Error('Forge installation failed');
    }),
    /Forge installation failed/,
  );
  await assert.rejects(fs.stat(join(target, 'mods')), { code: 'ENOENT' });
  await installServerModpackContents(join(staged, pack.id), target, async () => {});
  assert.equal(await fs.readFile(join(target, 'mods/server.jar'), 'utf8'), 'pack');
  assert.equal(await fs.readFile(join(target, 'patchouli_books/book.json'), 'utf8'), 'pack');
  assert.equal(await fs.readFile(join(target, 'world/level.dat'), 'utf8'), 'original world');
  await assert.rejects(fs.stat(join(target, 'start.ps1')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(join(target, 'server.properties')), { code: 'ENOENT' });
});

test('Modrinth installs server-only files and server overrides, skipping the client side', async (t) => {
  const directory = await temporaryDirectory(t);
  const archive = join(directory, 'pack.mrpack');
  const staged = join(directory, 'staged');
  const response = Buffer.from('server file');
  const hash = createHash('sha512').update(response).digest('hex');
  const zip = new AdmZip();
  const file = (name, env) => ({
    path: 'mods/' + name,
    hashes: { sha512: hash },
    env,
    fileSize: response.length,
    downloads: ['https://cdn.modrinth.com/' + name],
  });
  zip.addFile(
    'modrinth.index.json',
    Buffer.from(
      JSON.stringify({
        formatVersion: 1,
        game: 'minecraft',
        name: 'Demo',
        dependencies: { minecraft: '1.18.2', forge: '40.3.12' },
        files: [
          file('server.jar', { client: 'unsupported', server: 'required' }),
          file('client.jar', { client: 'required', server: 'unsupported' }),
        ],
      }),
    ),
  );
  zip.addFile('overrides/config/settings.toml', Buffer.from('common'));
  zip.addFile('server-overrides/config/settings.toml', Buffer.from('server'));
  zip.addFile('client-overrides/config/settings.toml', Buffer.from('client'));
  zip.writeZip(archive);
  const downloaded = [];
  const installer = new MrpackInstaller(
    staged,
    () => 'demo',
    async (url) => {
      downloaded.push(String(url));
      return new Response(response);
    },
  );
  await installer.install(
    archive,
    undefined,
    undefined,
    {},
    {
      acceptPath: acceptServerModpackPath,
      checkMetadata: async (pack) =>
        assert.equal(serverModpackSoftware(pack, '1.18.2').build, '40.3.12'),
    },
  );
  assert.deepEqual(downloaded, ['https://cdn.modrinth.com/server.jar']);
  assert.equal(await fs.readFile(join(staged, 'demo/config/settings.toml'), 'utf8'), 'server');
  await assert.rejects(fs.stat(join(staged, 'demo/mods/client.jar')), { code: 'ENOENT' });
});

test('resolves an explicit Forge build without falling back to the recommended build', async () => {
  const urls = [];
  const catalog = new ServerModloaderCatalog({
    fetchImplementation: async (url) => {
      urls.push(String(url));
      return new Response('a'.repeat(40));
    },
  });
  const result = await catalog.resolve('forge', '1.18.2', '40.3.12');
  assert.equal(result.build, '1.18.2-40.3.12');
  assert.deepEqual(urls, [
    'https://maven.minecraftforge.net/net/minecraftforge/forge/1.18.2-40.3.12/forge-1.18.2-40.3.12-installer.jar.sha1',
  ]);
  await assert.rejects(catalog.resolve('forge', '1.18.2', '1.20.1-47.0.0'));
});
