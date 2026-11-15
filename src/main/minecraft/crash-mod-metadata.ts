import * as yauzl from 'yauzl';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Fabric accepts literal line breaks in JSON strings. Normalize only those
// characters; keep structural syntax strict and never infer an ID from a filename.
function metadataJson(text: string): unknown {
  let quoted = false;
  let escaped = false;
  let normalized = '';
  for (const char of text) {
    if (quoted && char.charCodeAt(0) < 32) {
      normalized += JSON.stringify(char).slice(1, -1);
      escaped = false;
      continue;
    }
    normalized += char;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
    }
  }
  return JSON.parse(normalized);
}

// Read only metadata, never inflate every file in a mod archive.
export function readCrashModIds(path: string, loader?: string): Promise<ReadonlySet<string>> {
  return new Promise((resolve) => {
    const ids = new Set<string>();
    let archive: yauzl.ZipFile | undefined;
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      archive?.close();
      resolve(ids);
    };
    const timer = setTimeout(finish, 2000);
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (settled) {
        zip?.close();
        return;
      }
      if (error || !zip) {
        finish();
        return;
      }
      archive = zip;
      let entries = 0;
      let quiltMetadata = false;
      let bytes = 0;
      zip.on('error', finish);
      zip.on('end', finish);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) {
          return;
        }
        if (++entries > 10000) {
          finish();
          return;
        }
        if (
          ![
            'fabric.mod.json',
            'quilt.mod.json',
            'META-INF/mods.toml',
            'META-INF/neoforge.mods.toml',
            'mcmod.info',
          ].includes(entry.fileName)
        ) {
          zip.readEntry();
          return;
        }
        if (loader) {
          const allowed =
            loader === 'fabric'
              ? ['fabric.mod.json']
              : loader === 'quilt'
                ? ['fabric.mod.json', 'quilt.mod.json']
                : loader === 'forge'
                  ? ['META-INF/mods.toml', 'mcmod.info']
                  : ['META-INF/neoforge.mods.toml'];
          if (
            !allowed.includes(entry.fileName) ||
            (quiltMetadata && entry.fileName === 'fabric.mod.json')
          ) {
            zip.readEntry();
            return;
          }
          if (loader === 'quilt' && entry.fileName === 'quilt.mod.json') {
            quiltMetadata = true;
            ids.clear();
          }
        }
        if (entry.uncompressedSize > 262144 || entry.generalPurposeBitFlag & 1) {
          finish();
          return;
        }
        zip.openReadStream(entry, (readError, stream) => {
          if (readError || !stream) {
            finish();
            return;
          }
          if (settled) {
            stream.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('error', finish);
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1048576 || settled) {
              stream.destroy();
              finish();
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            if (settled) {
              return;
            }
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              const add = (value: unknown): void => {
                if (typeof value === 'string' && /^[a-z0-9_.-]{1,120}$/i.test(value)) {
                  ids.add(value.toLowerCase());
                }
              };
              if (entry.fileName.endsWith('.toml')) {
                // Only mod declarations, never dependency modId fields.
                for (const section of text.split(/(?=^\s*\[)/m)) {
                  if (!/^\s*\[\[mods\]\]/.test(section)) {
                    continue;
                  }
                  add(section.match(/^\s*modId\s*=\s*["']([a-z0-9_.-]+)["']/im)?.[1]);
                }
              } else {
                const data: unknown = metadataJson(text);
                if (entry.fileName === 'fabric.mod.json') {
                  add(record(data).id);
                } else if (entry.fileName === 'quilt.mod.json') {
                  add(record(record(data).quilt_loader).id);
                } else {
                  const mods: unknown = Array.isArray(data) ? data : record(data).modList;
                  if (Array.isArray(mods)) {
                    for (const mod of mods as unknown[]) {
                      add(record(mod).modid);
                    }
                  }
                }
              }
            } catch {
              /* Invalid metadata cannot justify disabling a mod. */
            }
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}
