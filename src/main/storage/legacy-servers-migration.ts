import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import {
  normalizeServerDraft,
  normalizeServerProperties,
} from '../../shared/servers/server-contract';
import { pathExists, readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import { registerPrivateMetadataRoot } from './protected-data';

async function serverVersion(directory: string): Promise<string> {
  const jar = join(directory, 'server.jar');
  if (await pathExists(jar)) {
    const bytes = await readBoundedRegularFile(jar, 512 * 1024 * 1024);
    try {
      const zip = new AdmZip(bytes);
      const version = zip.getEntry('version.json');
      if (version && version.header.size < 16384) {
        const data = JSON.parse(version.getData().toString('utf8')) as { id?: unknown };
        if (typeof data.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+ -]{0,127}$/.test(data.id)) {
          return data.id;
        }
      }
    } catch {
      // A partially downloaded old JAR must not prevent access to the launcher.
      // Keep it untouched and try the old log, otherwise expose version unknown.
    }
  }
  const log = join(directory, 'logs', 'latest.log');
  if (await pathExists(log)) {
    const text = (await readBoundedRegularFile(log, 16 * 1024 * 1024)).toString('utf8');
    const version = text.match(/Starting minecraft server version ([a-zA-Z0-9._+-]+)/)?.[1];
    if (version) {
      return version;
    }
  }
  // Preserve and display an incomplete installation; never invent its game version.
  return 'unknown';
}

/** Adopt the actual 3.0.1 server tree without copying worlds or overwriting a new server. */
export async function migrate301Servers(
  contentRoot: string,
  destinationRoot: string,
  userData: string,
  legacyMemoryMb = 2048,
): Promise<void> {
  const sourceRoot = join(contentRoot, 'servers');
  if (resolve(sourceRoot) === resolve(destinationRoot) || !(await pathExists(sourceRoot))) {
    return;
  }
  const info = await lstat(sourceRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Invalid legacy server root');
  }
  registerPrivateMetadataRoot(sourceRoot, ['server.json']);
  registerPrivateMetadataRoot(destinationRoot, ['server.json', 'sharing.json']);
  await mkdir(destinationRoot, { recursive: true });
  const targetInfo = await lstat(destinationRoot);
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) {
    throw new Error('Invalid server destination');
  }
  const journalRoot = join(userData, 'migration-backups');
  await mkdir(journalRoot, { recursive: true });
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const source = join(sourceRoot, entry.name);
    if (
      !(await pathExists(join(source, 'server.jar'))) &&
      !(await pathExists(join(source, 'server.properties')))
    ) {
      continue;
    }
    const id = 'legacy-' + createHash('sha256').update(entry.name).digest('hex').slice(0, 16);
    const destination = join(destinationRoot, id);
    if (await pathExists(destination)) {
      continue;
    }
    const metadataPath = join(source, 'server.json');
    if (!(await pathExists(metadataPath))) {
      const raw: Record<string, string> = {};
      if (await pathExists(join(source, 'server.properties'))) {
        const text = (
          await readBoundedRegularFile(join(source, 'server.properties'), 1024 * 1024)
        ).toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          const match = line.match(/^\s*([^#!:=\s]+)\s*[=:]\s*(.*)$/);
          if (match) {
            raw[match[1]] = match[2];
          }
        }
      }
      const version = await serverVersion(source);
      const domain = entry.name.replace(/\.(?:battly\.org|battly\.eu|battlyservers\.net)$/i, '');
      const port = Number(raw['server-port'] || 25565);
      const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : 25565;
      let draft;
      try {
        draft = normalizeServerDraft({
          name: entry.name,
          domain,
          version,
          region: 'latam',
          port: safePort,
        });
      } catch {
        draft = normalizeServerDraft({
          name: entry.name.slice(0, 128),
          domain: id.slice(0, 20),
          version,
          region: 'latam',
          port: safePort,
        });
      }
      const properties: Record<string, unknown> = {};
      properties.maxMemoryMb = Math.max(512, Math.min(131072, Math.round(legacyMemoryMb)));
      if (/^https:\/\//i.test(raw['resource-pack'] ?? '') && raw['resource-pack'].length <= 2048) {
        properties.resourcePack = raw['resource-pack'];
      }
      if ((raw['resource-pack-prompt'] ?? '').length <= 256) {
        properties.resourcePackPrompt = raw['resource-pack-prompt'];
      }
      for (const [key, name] of Object.entries({
        'max-players': 'maxPlayers',
        'spawn-protection': 'spawnProtection',
        'view-distance': 'viewDistance',
        'simulation-distance': 'simulationDistance',
      })) {
        if (raw[key] !== undefined) {
          properties[name] = Number(raw[key]);
        }
      }
      for (const [key, name] of Object.entries({
        pvp: 'pvp',
        'spawn-animals': 'spawnAnimals',
        'allow-nether': 'allowNether',
        'enable-command-block': 'enableCommandBlock',
        'spawn-monsters': 'spawnMonsters',
        'force-gamemode': 'forceGamemode',
        'white-list': 'whitelist',
      })) {
        if (raw[key] !== undefined) {
          properties[name] = raw[key] === 'true';
        }
      }
      properties.gamemode =
        ['survival', 'creative', 'adventure', 'spectator'][Number(raw.gamemode)] ?? raw.gamemode;
      properties.difficulty =
        ['peaceful', 'easy', 'normal', 'hard'][Number(raw.difficulty)] ?? raw.difficulty;
      await writeFileAtomically(
        metadataPath,
        JSON.stringify({
          ...draft,
          properties: normalizeServerProperties(properties),
          legacy301: { directory: entry.name, domain, versionDetected: version !== 'unknown' },
        }),
      );
    }
    // Journal precedes the atomic rename; all server files keep their exact bytes.
    await writeFileAtomically(
      join(journalRoot, `${id}.json`),
      JSON.stringify({ source, destination, createdMetadata: true }),
    );
    await rename(source, destination);
  }
}
