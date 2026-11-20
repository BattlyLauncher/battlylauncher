const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { YtDlpResolver } = require('../dist/main/music/yt-dlp-resolver');

const playlistUrl = 'https://www.youtube.com/playlist?list=PLfixture';

async function resolver(t, runner) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'battly-playlist-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'yt-dlp.exe');
  const content = 'fixture';
  await fs.writeFile(binary, content);
  await fs.writeFile(
    binary + '.verified.json',
    JSON.stringify({
      checkedAt: Date.now(),
      checksum: createHash('sha256').update(content).digest('hex'),
    }),
  );
  return new YtDlpResolver(directory, { platform: 'win32', runner });
}

test('imports the list from YouTube Music, skipping missing and private tracks', async (t) => {
  const importer = await resolver(t, async (_binary, args) => {
    assert.equal(args.at(-1), playlistUrl);
    return JSON.stringify({
      title: 'Unlisted playlist',
      availability: 'unlisted',
      entries: [
        { id: '12345678901', title: 'Public track' },
        { id: '12345678902', title: 'Hidden track', availability: 'private' },
        { id: '12345678903', title: '[Deleted video]' },
      ],
    });
  });
  const imported = await importer.playlist('https://music.youtube.com/watch?v=abc&list=PLfixture');
  assert.equal(imported.title, 'Unlisted playlist');
  assert.deepEqual(
    imported.songs.map((song) => song.id),
    ['12345678901'],
  );
});

test('only confirmed private playlists show the privacy notice', async (t) => {
  let response = { availability: 'private', entries: [] };
  const importer = await resolver(t, async () => {
    if (response instanceof Error) throw response;
    return JSON.stringify(response);
  });
  await assert.rejects(importer.playlist(playlistUrl), /es privada/);
  response = new Error('yt-dlp failed (1): ERROR: YouTube said: This playlist is private.');
  await assert.rejects(importer.playlist(playlistUrl), /es privada/);
  response = new Error('yt-dlp failed (1): ERROR: YouTube said: The playlist does not exist.');
  await assert.rejects(importer.playlist(playlistUrl), /no está disponible/);
  response = { availability: 'public', entries: [] };
  await assert.rejects(importer.playlist(playlistUrl), /está vacía/);
});
