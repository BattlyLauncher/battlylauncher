const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ModrinthClient } = require('../dist/main/mods/modrinth-client');

test('Modrinth changelogs retain Markdown line breaks and optional empty values', async () => {
  const markdown =
    "## What's Changed\n\n* Fix textures\n* Fix [EMF](https://example.com/issues/303)\n\n```java\nexample();\n```";
  const client = new ModrinthClient({
    fetchImplementation: async () =>
      Response.json(
        [markdown, '', null, undefined].map((changelog, index) => ({
          id: 'version' + index,
          project_id: 'project',
          name: 'Release',
          game_versions: ['1.21.1'],
          loaders: ['fabric'],
          files: [],
          dependencies: [],
          changelog,
        })),
      ),
  });
  const versions = await client.projectVersions('project', '', '');
  assert.equal(versions[0].changelog, markdown);
  assert.deepEqual(
    versions.slice(1).map((version) => version.changelog),
    [null, null, null],
  );
});
