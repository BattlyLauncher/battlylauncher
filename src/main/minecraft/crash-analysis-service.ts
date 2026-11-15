import { LaunchModDuplicatesError } from './launch-mod-preflight';
import { randomUUID } from 'node:crypto';
import { readBoundedRegularFile } from '../files/atomic-file';
import { isProtectedDataPath } from '../storage/protected-data';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { readCrashModInventory } from './crash-mod-inventory';
import { inspectLocalMod } from '../mods/local-mod-compatibility';
import { fabricNamespaceContext } from './fabric-crash-context';
import {
  analyzeDependencyFacts,
  planDependencySolutions,
  dependencyRuntime,
  dependencyEngineVersion,
} from './dependency-intelligence';
import {
  additionalDiagnostics,
  normalizeDiagnosticText,
  rankDiagnostics,
  diagnosticFingerprint,
} from './local-crash-diagnostics';

import type {
  MinecraftCrashEvidence,
  MinecraftCrashIssue,
  MinecraftCrashRepair,
  MinecraftCrashRepairResult,
  MinecraftCrashReport,
  MinecraftCrashSource,
} from '../../shared/minecraft/crash-report-contract';
import type { MinecraftLaunchExit } from './launcher-adapter';
import type { InstanceStore } from './instance-store';
import type { SettingsStore } from '../settings/settings-store';
import { normalizeInstanceDraft } from '../../shared/minecraft/instance';
import { isMinecraftGracefulShutdownMessage } from '../../shared/minecraft/launch-contract';

const maximumSourceBytes = 2 * 1024 * 1024;
const maximumCombinedCharacters = 180_000;
const maximumEvidenceLineCharacters = 420;

// Forge can display its loading error screen and then exit with code zero.
// Ordinary ERROR lines (for example Realms authentication) are not fatal evidence.
const fatalFailurePattern =
  /---- Minecraft Crash Report ----|Crash report saved to\b|ModLoadingException:|java\.lang\.Exception: Mod Loading has failed|\[[^\r\n]*?FATAL\][^\r\n]*Error during pre-loading phase/i;

type RepairOperation =
  | { readonly kind: 'adjust-memory'; readonly maximumGb: number }
  | { readonly kind: 'disable-mod'; readonly path: string }
  | {
      readonly kind: 'install-mod-dependency';
      readonly dependencyId: string;
      readonly owners: readonly string[];
      readonly requiredVersion: string;
      readonly gameVersion: string;
      readonly loader: string;
    }
  | { readonly kind: 'resolve-mod-conflict'; readonly paths: readonly string[] }
  | { readonly kind: 'quarantine-file'; readonly path: string }
  | { readonly kind: 'remove-jvm-argument'; readonly argument: string }
  | { readonly kind: 'install-mesa' };

interface StoredRepair extends MinecraftCrashRepair {
  readonly operation: RepairOperation;
}

interface StoredReport {
  readonly gameDirectory: string;
  readonly instanceId: string | null;
  readonly repairs: Map<string, StoredRepair>;
  readonly expiresAt: number;
  readonly files: ReadonlyMap<string, string>;
}

interface AppliedRepair {
  readonly undo: () => Promise<void>;
}

export interface CrashAnalysisInput {
  readonly exit: MinecraftLaunchExit | null;
  readonly gameDirectory: string;
  readonly instanceId: string | null;
  readonly launchLogPath: string;
  readonly launchStartedAt: number;
  readonly launchError?: unknown;
}

export interface CrashModDependencyInstallRequest {
  readonly onProgress?: (phase: 'searching' | 'installing', mod: string) => void;
  readonly dependencyId: string;
  readonly requiredVersion: string;
  readonly gameVersion: string;
  readonly loader: string;
  readonly gameDirectory: string;
}

export type CrashModDependencyInstaller = (
  request: CrashModDependencyInstallRequest,
) => Promise<readonly string[]>;

interface LoadedSource extends MinecraftCrashSource {
  readonly content: string;
}

function safeId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(resolve(root), resolve(candidate));
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

async function safeRepairPath(root: string, target: string): Promise<void> {
  if (!isInside(root, target) || resolve(root) === resolve(target)) {
    throw new Error('Ruta de reparación no válida');
  }
  const canonicalRoot = await realpath(root);
  let current = dirname(target);
  while (isInside(root, current)) {
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (info && !isInside(canonicalRoot, await realpath(current))) {
      throw new Error('La ruta sale de la instancia');
    }
    if (info?.isSymbolicLink()) {
      throw new Error('La reparación no admite enlaces simbólicos');
    }
    if (resolve(current) === resolve(root)) {
      break;
    }
    current = dirname(current);
  }
}
async function fileStamp(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('El archivo no es regular');
  }
  return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`;
}
async function requireAbsent(path: string): Promise<void> {
  const exists = await lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    },
  );
  if (exists) {
    throw new Error(
      'El archivo ya existe. No se sobrescribirá; conserva o mueve el archivo nuevo antes de deshacer.',
    );
  }
}

function cleanLine(value: string): string {
  return [...value.replaceAll('\0', '')]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code >= 32;
    })
    .join('')
    .trim()
    .slice(0, maximumEvidenceLineCharacters);
}

function redact(content: string): string {
  return content
    .replace(/\b(access[_-]?token|client[_-]?token)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]{12,}/gi, 'Bearer [redacted]')
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      '[uuid]',
    );
}

function errorText(value: unknown, depth = 0): string {
  if (depth > 5) {
    return '[cause truncated]';
  }
  if (value instanceof Error && value.cause !== undefined) {
    return `${value.message}\n${value.stack ?? ''}\nCaused by: ${errorText(value.cause, depth + 1)}`;
  }
  if (value instanceof Error) {
    return `${value.message}\n${value.stack ?? ''}`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return 'Error desconocido durante el lanzamiento';
}

async function readTail(path: string): Promise<string> {
  if (isProtectedDataPath(path)) {
    const content = await readBoundedRegularFile(path, 128 * 1024 * 1024);
    if (content.length <= maximumSourceBytes) {
      return redact(content.toString('utf8'));
    }
    const head = Math.floor(maximumSourceBytes / 3);
    return redact(
      content.subarray(0, head).toString('utf8') +
        '\n[log truncated]\n' +
        content.subarray(-(maximumSourceBytes - head)).toString('utf8'),
    );
  }
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new TypeError('Unsafe crash source');
  }
  const length = Math.min(metadata.size, maximumSourceBytes);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    if (metadata.size <= length) {
      await handle.read(buffer, 0, length, 0);
      return redact(buffer.toString('utf8'));
    }
    const headLength = Math.floor(length / 3);
    await handle.read(buffer, 0, headLength, 0);
    await handle.read(
      buffer,
      headLength,
      length - headLength,
      metadata.size - (length - headLength),
    );
    return redact(
      buffer.subarray(0, headLength).toString('utf8') +
        '\n[registro recortado]\n' +
        buffer.subarray(headLength).toString('utf8'),
    );
  } finally {
    await handle.close();
  }
}

async function newestFiles(directory: string, pattern: RegExp, limit: number): Promise<string[]> {
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      return [];
    }
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && pattern.test(entry.name))
        .slice(0, 200)
        .map(async (entry) => {
          const path = join(directory, entry.name);
          return { path, modifiedAt: (await stat(path)).mtimeMs };
        }),
    );
    return files
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, limit)
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

async function loadSource(path: string): Promise<LoadedSource | null> {
  try {
    const metadata = await stat(path);
    return {
      name: basename(path),
      path,
      modifiedAt: metadata.mtime.toISOString(),
      content: await readTail(path),
    };
  } catch {
    return null;
  }
}

function evidence(source: LoadedSource, pattern: RegExp): MinecraftCrashEvidence[] {
  const match = source.content.split(/\r?\n/).find((line) => pattern.test(line));
  if (!match) {
    return [];
  }
  let displayLine = match;
  try {
    const parsed = JSON.parse(match) as { readonly event?: { readonly message?: unknown } };
    if (typeof parsed.event?.message === 'string') {
      displayLine = parsed.event.message;
    }
  } catch {
    // Plain Minecraft logs are not JSON and should be shown as-is.
  }
  return [{ file: source.name, line: cleanLine(displayLine) }];
}

function matchingEvidence(
  sources: readonly LoadedSource[],
  pattern: RegExp,
): MinecraftCrashEvidence[] {
  return sources.flatMap((source) => evidence(source, pattern)).slice(0, 4);
}

function repair(
  kind: StoredRepair['kind'],
  label: string,
  description: string,
  operation: RepairOperation,
  requiresFileSelection = false,
): StoredRepair {
  return { id: safeId('repair'), kind, label, description, operation, requiresFileSelection };
}

function publicRepair(value: StoredRepair): MinecraftCrashRepair {
  return {
    id: value.id,
    kind: value.kind,
    label: value.label,
    description: value.description,
    requiresFileSelection: value.requiresFileSelection,
    ...(value.mod ? { mod: value.mod } : {}),
  };
}

function issue(
  id: string,
  title: string,
  description: string,
  severity: MinecraftCrashIssue['severity'],
  confidence: MinecraftCrashIssue['confidence'],
  evidence: readonly MinecraftCrashEvidence[],
  repairs: readonly StoredRepair[] = [],
): MinecraftCrashIssue {
  return { id, title, description, severity, confidence, evidence, repairs };
}

function classVersionToJava(value: number): number | null {
  const major = value - 44;
  return major >= 8 && major <= 30 ? major : null;
}

function unrecognizedJvmArgument(content: string): string | null {
  const match = content.match(/Unrecognized VM option ['“]?([^'”\r\n]+)['”]?/i);
  if (!match) {
    return null;
  }
  const argument = match[1].trim();
  return /^-?[A-Za-z0-9:+._=/-]{1,180}$/.test(argument) ? argument : null;
}

function referencedConfigPath(content: string, gameDirectory: string): string | null {
  const patterns = [
    /(?:Failed loading|Failed to load|Parsing error in) config(?:uration)? file[: ]+['"]?([^'"\r\n]+\.(?:toml|json|cfg|properties))/i,
  ];
  for (const pattern of patterns) {
    const value = content.match(pattern)?.[1] ?? content.match(pattern)?.[0];
    if (!value) {
      continue;
    }
    const candidate = resolve(gameDirectory, value.trim().replaceAll(/[\\/]/g, '/'));
    if (isInside(join(gameDirectory, 'config'), candidate)) {
      return candidate;
    }
  }
  return null;
}

async function detectIssues(
  sources: readonly LoadedSource[],
  gameDirectory: string,
  currentMemoryGb: number,
  inventoryLoader?: string,
): Promise<{ readonly issues: MinecraftCrashIssue[]; readonly repairs: StoredRepair[] }> {
  const content = sources.map((source) => source.content).join('\n');
  const issues: MinecraftCrashIssue[] = [];
  const allRepairs: StoredRepair[] = [];
  const add = (value: MinecraftCrashIssue): void => {
    issues.push(value);
    allRepairs.push(...(value.repairs as StoredRepair[]));
  };

  let inventory: Awaited<ReturnType<typeof readCrashModInventory>> = {
    filesById: new Map(),
    complete: false,
  };
  let inventoryPending: Promise<typeof inventory> | undefined;
  const getInventory = (): Promise<typeof inventory> =>
    (inventoryPending ??= readCrashModInventory(gameDirectory, inventoryLoader).then(
      (value) => (inventory = value),
    ));
  const matchingFiles = async (ids: ReadonlySet<string>): Promise<string[]> => {
    if (!ids.size) {
      return [];
    }
    const current = await getInventory();
    return [...new Set([...ids].flatMap((id) => current.filesById.get(id) ?? []))].sort();
  };
  // Quilt lists mandatory duplicates separately from its dependency solver errors.
  // Only offer local files whose own metadata declares the reported ID.
  const duplicateIds = new Set(
    [...content.matchAll(/Duplicate mandatory mod ids\s*\[([^\]\r\n]+)\]/gi)]
      .flatMap((match) => match[1].split(/[,\s]+/))
      .filter((id) => /^[a-z0-9_.-]{1,128}$/i.test(id))
      .map((id) => id.toLowerCase()),
  );
  if (
    /Invalid Services found OptiFine|Error loading OptiFine ZIP file|Service failed to load OptiFine/i.test(
      content,
    )
  ) {
    const current = await getInventory();
    if ((current.filesById.get('optifine')?.length ?? 0) > 1) {
      duplicateIds.add('optifine');
    }
  }
  if (duplicateIds.size) {
    const current = await getInventory();
    const groups = [...duplicateIds].map((id) => ({
      id,
      files: current.filesById.get(id) ?? [],
    }));
    const files = [
      ...new Set(groups.filter((group) => group.files.length > 1).flatMap((group) => group.files)),
    ];
    add(
      issue(
        'duplicate-mods',
        'Hay identificadores de mods duplicados',
        'El loader ha encontrado varias versiones del mismo mod: {0}. Conserva una sola versión compatible. Elige qué archivo desactivar; Battly guardará una copia para deshacer el cambio.'.replace(
          '{0}',
          [...duplicateIds].join(', '),
        ),
        'critical',
        'high',
        matchingEvidence(sources, /Duplicate mandatory mod ids/i),
        await Promise.all(
          files.map(async (path, index) => {
            const action = repair(
              'disable-mod',
              'Desactivar ' + basename(path),
              'Desactivar {0}. Las otras versiones se conservarán. Battly guardará una copia para deshacer el cambio.'.replace(
                '{0}',
                basename(path),
              ),
              { kind: 'disable-mod', path },
            );
            if (index >= 24) {
              return action;
            }
            const metadata = await inspectLocalMod(
              path,
              {
                filename: basename(path),
                enabled: true,
                size: 0,
                modifiedAt: '',
              },
              inventoryLoader,
            );
            return metadata.readable
              ? {
                  ...action,
                  mod: {
                    name:
                      metadata.name === basename(path)
                        ? (metadata.id ?? metadata.name)
                        : metadata.name,
                    version: metadata.version,
                    gameVersion: metadata.gameVersion,
                  },
                }
              : action;
          }),
        ),
      ),
    );
  }
  const dependencyFacts = [...analyzeDependencyFacts(content)];
  if (dependencyFacts.some((fact) => fact.kind === 'unsatisfied')) {
    await getInventory();
    for (let index = 0; index < dependencyFacts.length; index++) {
      const fact = dependencyFacts[index];
      if (fact.kind === 'unsatisfied' && fact.dependency) {
        if (inventory.filesById.has(fact.dependency)) {
          dependencyFacts[index] = { ...fact, kind: 'mismatch' };
        } else if (inventory.complete) {
          dependencyFacts[index] = { ...fact, kind: 'missing' };
        }
      }
    }
  }
  for (let index = 0, checked = 0; index < dependencyFacts.length && checked < 8; index++) {
    const fact = dependencyFacts[index];
    if (fact.family !== 'quilt' || !fact.sourceFile || fact.owner) {
      continue;
    }
    await getInventory();
    const path = join(gameDirectory, 'mods', fact.sourceFile);
    if (![...inventory.filesById.values()].some((paths) => paths.includes(path))) {
      continue;
    }
    checked++;
    const info = await lstat(path);
    if (info.size > 32 * 1024 * 1024 || !info.isFile() || info.isSymbolicLink()) {
      continue;
    }
    const metadata = await inspectLocalMod(path, {
      filename: fact.sourceFile,
      enabled: true,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
    if (
      metadata.id &&
      (!fact.displayOwner || fact.displayOwner === metadata.name) &&
      metadata.requirements?.some(
        (requirement) => requirement.id === fact.dependency && requirement.kind === 'required',
      )
    ) {
      dependencyFacts[index] = { ...fact, owner: metadata.id };
    }
  }
  const dependencyPlans = planDependencySolutions(dependencyFacts);
  // NO_CANDIDATE also means an installed version is outside the accepted range.
  // Never add another copy just because the solver found no compatible candidate.
  const installIds = new Set(
    dependencyPlans.flatMap((plan) =>
      plan.kind === 'install' && plan.dependency ? [plan.dependency] : [],
    ),
  );
  if (installIds.size) {
    await getInventory();
  }
  const presentDependencies = new Set([...installIds].filter((id) => inventory.filesById.has(id)));
  const dependencyOwners = (dependency: string): string[] => [
    ...new Set(
      dependencyFacts.flatMap((fact) =>
        (fact.dependency === dependency ||
          (fact.dependency === 'fabric' && dependency === 'fabric-api')) &&
        fact.owner
          ? [fact.owner]
          : [],
      ),
    ),
  ];
  const canInstallDependency = (dependency: string): boolean =>
    inventory.complete &&
    !presentDependencies.has(dependency) &&
    dependencyOwners(dependency).length > 0 &&
    dependencyOwners(dependency).every((owner) => inventory.filesById.get(owner)?.length === 1);
  const runtime = dependencyRuntime(content);
  const runtimeGameVersion = runtime.gameVersion;
  const runtimeLoader = runtime.loader;

  if (
    /OutOfMemoryError: Java heap space|GC overhead limit exceeded|Java heap space/i.test(content)
  ) {
    const totalGb = Math.max(2, Math.floor(totalmem() / 1024 ** 3));
    const freeGb = Math.max(0.5, Math.floor((freemem() / 1024 ** 3) * 2) / 2);
    const recommended = Math.min(
      totalGb - 2,
      currentMemoryGb + Math.min(2, Math.max(0, freeGb - 2)),
    );
    const fixes =
      recommended > currentMemoryGb
        ? [
            repair(
              'adjust-memory',
              `Asignar ${recommended} GB`,
              'Aumenta el máximo de RAM dejando un margen de 2 GB para el sistema.',
              { kind: 'adjust-memory', maximumGb: recommended },
            ),
          ]
        : [];
    add(
      issue(
        'java-heap',
        'Minecraft se quedó sin memoria Java',
        'El heap alcanzó su límite. Battly puede ajustar la RAM del perfil sin tocar otros argumentos.',
        'critical',
        'high',
        matchingEvidence(sources, /OutOfMemoryError|GC overhead limit exceeded|Java heap space/i),
        fixes,
      ),
    );
  }

  if (/Could not reserve enough space/i.test(content)) {
    const recommended = Math.max(
      1,
      Math.min(currentMemoryGb - 1, Math.floor(freemem() / 1024 ** 3)),
    );
    const fixes =
      currentMemoryGb > recommended
        ? [
            repair(
              'adjust-memory',
              `Reducir a ${recommended} GB`,
              'Reduce la reserva para que la JVM pueda arrancar.',
              { kind: 'adjust-memory', maximumGb: recommended },
            ),
          ]
        : [];
    add(
      issue(
        'jvm-reservation',
        'Java no pudo reservar la memoria solicitada',
        'La reserva configurada supera la memoria que Java puede obtener en este momento. Cierra aplicaciones pesadas o reduce la RAM.',
        'critical',
        'high',
        matchingEvidence(sources, /Could not reserve enough space/i),
        fixes,
      ),
    );
  }

  const classVersion = Number(content.match(/class file version\s+(\d+)/i)?.[1]);
  const requiredJava = Number.isFinite(classVersion) ? classVersionToJava(classVersion) : null;
  if (/UnsupportedClassVersionError|class file version/i.test(content)) {
    add(
      issue(
        'wrong-java',
        'La versión de Java no es compatible',
        requiredJava
          ? `Este contenido necesita Java ${requiredJava} o superior. Selecciona esa versión en Ajustes > Java.`
          : 'El juego o un mod fue compilado para una versión de Java distinta. Revisa Ajustes > Java.',
        'critical',
        'high',
        matchingEvidence(sources, /UnsupportedClassVersionError|class file version/i),
      ),
    );
  }

  if (
    /(?:NoClassDefFoundError:\s*joptsimple\/OptionSpec|ClassNotFoundException:\s*joptsimple\.OptionSpec)/i.test(
      content,
    )
  ) {
    add(
      issue(
        'loader-inheritance',
        'Faltan librerías base de Minecraft',
        'Falta joptsimple en el classpath. Repara o reinstala el loader para recuperar las librerías de la versión base; este diagnóstico no demuestra que ya estén reparadas.',
        'critical',
        'high',
        matchingEvidence(
          sources,
          /NoClassDefFoundError:\s*joptsimple\/OptionSpec|ClassNotFoundException:\s*joptsimple\.OptionSpec/i,
        ),
      ),
    );
  }

  const badArgument = unrecognizedJvmArgument(content);
  if (badArgument) {
    const fix = repair(
      'remove-jvm-argument',
      `Quitar ${badArgument}`,
      'Elimina únicamente el argumento que Java ha rechazado.',
      { kind: 'remove-jvm-argument', argument: badArgument },
    );
    add(
      issue(
        'bad-jvm-argument',
        'Java rechazó un argumento JVM',
        'Hay un argumento no reconocido en la configuración de la instancia.',
        'critical',
        'high',
        matchingEvidence(sources, /Unrecognized VM option/i),
        [fix],
      ),
    );
  }

  const loaderFacts = dependencyFacts.filter(
    (fact) =>
      ['fml', 'legacy-forge', 'quilt'].includes(fact.family) &&
      ['missing', 'mismatch', 'runtime', 'conflict'].includes(fact.kind) &&
      (fact.owner || fact.family === 'quilt'),
  );
  if (loaderFacts.length) {
    const owners = new Set(loaderFacts.flatMap((fact) => (fact.owner ? [fact.owner] : [])));
    const files = await matchingFiles(owners);
    const fixes: StoredRepair[] = files.length
      ? [
          repair(
            'resolve-mod-conflict',
            'Resolver incompatibilidad automáticamente',
            'Desactiva temporalmente el mod incompatible detectado y conserva una copia reversible.',
            { kind: 'resolve-mod-conflict', paths: files },
          ),
        ]
      : [];
    if (runtimeGameVersion && runtimeLoader) {
      for (const plan of dependencyPlans) {
        if (
          plan.kind !== 'install' ||
          !plan.dependency ||
          !canInstallDependency(plan.dependency) ||
          !plan.constraint ||
          !loaderFacts.some(
            (fact) => fact.kind === 'missing' && fact.dependency === plan.dependency,
          )
        ) {
          continue;
        }
        fixes.push(
          repair(
            'install-mod-dependency',
            `Instalar ${plan.dependency} (${plan.constraint})`,
            `Busca e instala desde Modrinth una edición de ${plan.dependency} compatible con Minecraft ${runtimeGameVersion} y ${runtimeLoader}.`,
            {
              kind: 'install-mod-dependency',
              dependencyId: plan.dependency,
              owners: dependencyOwners(plan.dependency),
              requiredVersion: plan.constraint,
              gameVersion: runtimeGameVersion,
              loader: runtimeLoader,
            },
          ),
        );
      }
    }
    add(
      issue(
        'fml-incompatible-mods',
        'Mods incompatibles con esta versión de Minecraft',
        'El loader ha detectado requisitos incompatibles o dependencias ausentes. Revisa los requisitos indicados antes de instalar otros mods.',
        'critical',
        'high',
        loaderFacts.slice(0, 12).map((fact) => ({
          file:
            sources.find((source) => source.content.includes(fact.evidence.split('\n')[0]))?.name ??
            'Minecraft',
          line: fact.evidence.slice(0, maximumEvidenceLineCharacters),
        })),
        fixes,
      ),
    );
  }

  const fabricVersionConflicts: string[][] = [
    ...content.matchAll(
      /HARD_DEP_INCOMPATIBLE_PRESELECTED\s+([a-z0-9_.-]+)\s+([^\s{]+)\s+\{depends minecraft @ \[([^\]]+)\]\}/gi,
    ),
  ];
  const readableRequirements = [
    ...content.matchAll(
      /(?:El mod|Mod)\s+['"]([^'"\r\n]+)['"]\s+\(([a-z0-9_.-]+)\)\s+(\S+)\s+(?:requires|needs|necesita)\s+([^\r\n]+?)(?=,\s*(?:but|pero|which|que)\b|$)/gim,
    ),
  ];
  if (
    fabricVersionConflicts.length ||
    /Incompatible mods found!|Mod resolution failed/i.test(content) ||
    readableRequirements.length ||
    dependencyFacts.some((fact) => fact.family === 'fabric')
  ) {
    const implicatedIds = new Set(fabricVersionConflicts.map((match) => match[1].toLowerCase()));
    const missingDependencies = new Map<string, Set<string>>();
    for (const match of readableRequirements) {
      const requirement = match[4];
      const dependency = /['"]\s*\(([a-z0-9_.-]+)\)/i.exec(requirement)?.[1]?.toLowerCase();
      if (!dependency) {
        continue;
      }
      if (dependency === 'minecraft') {
        implicatedIds.add(match[2].toLowerCase());
        if (
          !fabricVersionConflicts.some(
            (conflict) => conflict[1].toLowerCase() === match[2].toLowerCase(),
          )
        ) {
          fabricVersionConflicts.push([match[0], match[2], match[3], requirement]);
        }
      } else if (!['java', 'fabricloader', 'quilt_loader'].includes(dependency)) {
        // Retain unknown predicates verbatim: they must never become an unrestricted install.
        const constraint =
          /(?:version|versión)\s+['"]?(\d+(?:\.\d+){1,2})(?=['"\s,]|$)/i.exec(requirement)?.[1] ??
          requirement;
        const ranges = missingDependencies.get(dependency) ?? new Set<string>();
        ranges.add(
          /or later|o superior|at least|al menos/i.test(requirement) ? requirement : constraint,
        );
        missingDependencies.set(dependency, ranges);
      }
    }
    for (const match of content.matchAll(
      /HARD_DEP(?:_NO_CANDIDATE)?\s+([a-z0-9_.-]+)\s+[^\s{]+\s+\{depends ([a-z0-9_.-]+) @ \[([^\]]+)\]\}/gi,
    )) {
      if (['minecraft', 'java', 'fabricloader', 'quilt_loader'].includes(match[2])) {
        continue;
      }
      implicatedIds.add(match[1].toLowerCase());
      const ranges = missingDependencies.get(match[2]) ?? new Set<string>();
      ranges.add(match[3].trim());
      missingDependencies.set(match[2], ranges);
    }
    for (const fact of dependencyFacts.filter((fact) => fact.family === 'fabric')) {
      if (fact.owner) {
        implicatedIds.add(fact.owner);
      }
      if (fact.dependency && ['missing', 'mismatch'].includes(fact.kind) && fact.required) {
        const ranges = missingDependencies.get(fact.dependency) ?? new Set<string>();
        ranges.add(fact.required);
        missingDependencies.set(fact.dependency, ranges);
      }
    }
    const files = await matchingFiles(implicatedIds);
    const individualFixes = files.map((path) =>
      repair(
        'disable-mod',
        `Desactivar ${basename(path)}`,
        'Aparta temporalmente el mod incompatible; la acción se puede deshacer.',
        { kind: 'disable-mod', path },
      ),
    );
    const dependencyFixes =
      runtimeGameVersion && runtimeLoader
        ? dependencyPlans
            .filter(
              (plan) =>
                plan.kind === 'install' &&
                plan.dependency &&
                canInstallDependency(plan.dependency) &&
                plan.constraint &&
                dependencyFacts.some(
                  (fact) =>
                    fact.family === 'fabric' &&
                    (fact.dependency === plan.dependency ||
                      (fact.dependency === 'fabric' && plan.dependency === 'fabric-api')),
                ),
            )
            .map((plan) => {
              const dependencyId = plan.dependency!,
                requiredVersion = plan.constraint!;
              return repair(
                'install-mod-dependency',
                `Instalar ${dependencyId} (${requiredVersion})`,
                `Busca e instala desde Modrinth una edición de ${dependencyId} compatible con Minecraft ${runtimeGameVersion} y ${runtimeLoader}.`,
                {
                  kind: 'install-mod-dependency',
                  dependencyId,
                  owners: dependencyOwners(dependencyId),
                  requiredVersion,
                  gameVersion: runtimeGameVersion,
                  loader: runtimeLoader,
                },
              );
            })
        : [];
    const fixes = files.length
      ? [
          repair(
            'resolve-mod-conflict',
            'Resolver incompatibilidad automáticamente',
            files.length === 1
              ? 'Desactiva temporalmente el mod incompatible detectado y conserva una copia reversible.'
              : `Desactiva temporalmente los ${files.length} mods incompatibles detectados y conserva una copia reversible.`,
            { kind: 'resolve-mod-conflict', paths: files },
          ),
          ...individualFixes,
          ...dependencyFixes,
        ]
      : dependencyFixes;
    const conflictText = fabricVersionConflicts.length
      ? fabricVersionConflicts
          .map(
            (match) =>
              `${match[1]} ${match[2]} necesita Minecraft ${match[3].replaceAll(',', '–')}`,
          )
          .join('. ')
      : 'Fabric no pudo resolver el conjunto de mods instalado';
    const dependencyText = missingDependencies.size
      ? ` También faltan dependencias: ${[...missingDependencies].map(([id, ranges]) => `${id} (${[...ranges].join(' ∧ ')})`).join(', ')}.`
      : '';
    add(
      issue(
        'fabric-incompatible-mods',
        'Mods incompatibles con esta versión de Minecraft',
        `${conflictText}.${dependencyText} Instala ediciones de esos mods compatibles con la versión de la instancia o cambia la versión de Minecraft.`,
        'critical',
        fabricVersionConflicts.length || missingDependencies.size ? 'high' : 'medium',
        matchingEvidence(
          sources,
          /HARD_DEP_INCOMPATIBLE_PRESELECTED|Incompatible mods found!|Mod resolution failed/i,
        ),
        fixes,
      ),
    );
  }

  const namespace = fabricNamespaceContext(sources);
  if (namespace) {
    const ownerIds = new Set(namespace.owners.keys());
    if (!ownerIds.size && namespace.moduleId) {
      ownerIds.add(namespace.moduleId);
    }
    const files = await matchingFiles(ownerIds);
    const fixes = files.length
      ? [
          repair(
            'resolve-mod-conflict',
            'Apartar los mods que incluyen el módulo incompatible',
            `Desactiva ${files.map((path) => basename(path)).join(', ')} de forma reversible. Después instala ediciones compatibles; otros mods pueden necesitar estas dependencias.`,
            { kind: 'resolve-mod-conflict', paths: files },
          ),
        ]
      : [];
    const owners = [...namespace.owners].map(([id, version]) => `${id} ${version}`).join(', ');
    const older = namespace.olderMods.map(([id, version]) => `${id} ${version}`).join(', ');
    add(
      issue(
        'fabric-namespace-mismatch',
        'Un mod usa nombres de clases incompatibles con Minecraft',
        `El módulo ${namespace.moduleId ?? '—'} usa ${namespace.from}, pero Minecraft ${namespace.gameVersion ?? '—'} necesita ${namespace.to}.` +
          (owners ? ` El inventario lo sitúa dentro de: ${owners}.` : '') +
          (older
            ? ` También aparecen versiones etiquetadas para Minecraft 1.x: ${older}. Revisa todas antes de volver a iniciar.`
            : '') +
          (namespace.from === 'named'
            ? ' Parece una compilación de desarrollo: instala el JAR publicado para jugar.'
            : ' Instala versiones de los mods para este Minecraft y loader, o usa una instancia con la versión que requieren.') +
          ' Cambiar Java, aumentar RAM o renombrar el namespace del archivo no corrige esta incompatibilidad.',
        'critical',
        'high',
        namespace.evidence,
        fixes,
      ),
    );
  }

  const sodiumRuntime = sources
    .map((source) => {
      if (
        !/Sodium-EarlyDriverScanner|sodium\.client\.compatibility\.checks\.PreLaunchChecks\.checkLwjglRuntimeVersion/i.test(
          source.content,
        )
      ) {
        return null;
      }
      return source.content.match(
        /currently active LWJGL version is not compatible\.[\s\S]{0,160}?Installed version:\s*([a-z0-9_.+-]{1,80})\s*Required version:\s*([a-z0-9_.+-]{1,80})/i,
      );
    })
    .find((match) => match && match[1] !== match[2]);
  if (sodiumRuntime) {
    const files = await matchingFiles(new Set(['sodium']));
    add(
      issue(
        'sodium-lwjgl-conflict',
        'Sodium no es compatible con las librerías del juego',
        'Esta edición de Sodium requiere LWJGL {0}, pero el juego está usando {1}. Battly puede desactivar Sodium de forma reversible. Después podrás instalar una edición compatible con esta versión de Minecraft.'
          .replace('{0}', sodiumRuntime[2])
          .replace('{1}', sodiumRuntime[1]),
        'critical',
        'high',
        matchingEvidence(
          sources,
          /Sodium-EarlyDriverScanner|Installed version:|Required version:|checkLwjglRuntimeVersion/i,
        ),
        files.length === 1
          ? [
              repair(
                'disable-mod',
                'Desactivar Sodium',
                'Desactiva temporalmente Sodium y guarda una copia para deshacer el cambio. Las librerías de Minecraft se conservarán.',
                { kind: 'disable-mod', path: files[0] },
              ),
            ]
          : [],
      ),
    );
  }

  if (/Found \d+ non-fabric mods?:/i.test(content)) {
    add(
      issue(
        'fabric-ignored-jars',
        'Fabric ha ignorado archivos que no reconoce como mods',
        'Revisa los JAR del aviso e instala su edición para Fabric y esta versión de Minecraft. Este aviso, por sí solo, no demuestra la causa del cierre y no requiere borrar esos archivos.',
        'warning',
        'high',
        matchingEvidence(sources, /Found \d+ non-fabric mods?:/i),
        [],
      ),
    );
  }

  const modIds = new Set<string>();
  for (const match of content.matchAll(/Mixin apply for mod\s+([a-z0-9_.-]+)\s+failed/gi)) {
    modIds.add(match[1].toLowerCase());
  }
  for (const line of content.split(/\r?\n/)) {
    if (
      !/Mixin.*(?:failed|Error|Exception)|(?:InvalidMixinException|MixinApplyError)/i.test(line)
    ) {
      continue;
    }
    for (const match of line.matchAll(/from mod\s+([a-z0-9_.-]+)(?:\s|$)/gi)) {
      modIds.add(match[1].toLowerCase());
    }
  }
  modIds.delete('minecraft');
  modIds.delete('fabricloader');
  if (modIds.size || /InvalidMixinException|MixinApplyError/i.test(content)) {
    const files = await matchingFiles(modIds);
    const fixes = files.map((path) =>
      repair(
        'disable-mod',
        `Desactivar ${basename(path)}`,
        'Mueve el mod a la copia de seguridad del reporter; se puede deshacer.',
        { kind: 'disable-mod', path },
      ),
    );
    add(
      issue(
        'mixin-conflict',
        'Conflicto entre mods o mixins',
        modIds.size
          ? `El error señala: ${[...modIds].join(', ')}. Desactiva sólo el mod implicado y vuelve a probar.`
          : 'Un mixin no pudo aplicarse. Revisa los últimos mods añadidos o actualizados.',
        'critical',
        modIds.size ? 'high' : 'medium',
        matchingEvidence(
          sources,
          /Mixin apply|InvalidMixinException|MixinApplyError|Critical injection failure|Mixin transformation.*failed/i,
        ),
        fixes,
      ),
    );
  }

  const configPath = referencedConfigPath(content, gameDirectory);
  if (configPath) {
    try {
      const info = await lstat(configPath);
      if (info.isFile() && !info.isSymbolicLink()) {
        const fix = repair(
          'quarantine-file',
          `Restablecer ${basename(configPath)}`,
          'Aparta el archivo corrupto para que el mod genere uno nuevo; conserva una copia.',
          { kind: 'quarantine-file', path: configPath },
        );
        add(
          issue(
            'broken-config',
            'Archivo de configuración dañado',
            'El parser falló al leer una configuración concreta.',
            'warning',
            'high',
            matchingEvidence(sources, /Failed loading|Failed to load|Parsing error/i),
            [fix],
          ),
        );
      }
    } catch {
      // The referenced file may already have been removed.
    }
  }

  if (
    /GLFW error 65542|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated/i.test(
      content,
    )
  ) {
    add(
      issue(
        'opengl-driver',
        'OpenGL no está disponible',
        'El controlador gráfico no ofrece el contexto OpenGL requerido. Battly dispone de recuperación automática con Mesa3D para fallos compatibles en Windows, limitada a un reintento. Si sigue fallando, revisa el controlador del fabricante.',
        'critical',
        'high',
        matchingEvidence(sources, /GLFW error 65542|WGL:|OpenGL|Pixel format not accelerated/i),
      ),
    );
  }

  if (/There is not enough space on the disk|No space left on device|ENOSPC/i.test(content)) {
    add(
      issue(
        'disk-full',
        'No queda espacio suficiente en el disco',
        'Libera espacio en la unidad de Battly y vuelve a iniciar. No se modifica ningún archivo automáticamente.',
        'critical',
        'high',
        matchingEvidence(sources, /not enough space|No space left|ENOSPC/i),
      ),
    );
  }

  if (
    /ZipException|zip END header not found|invalid LOC header|invalid distance too far back/i.test(
      content,
    )
  ) {
    add(
      issue(
        'corrupt-jar',
        'Hay un JAR corrupto o incompleto',
        'El log contiene un error ZIP. Reinstala el mod o la versión nombrada en la misma línea.',
        'warning',
        'high',
        matchingEvidence(
          sources,
          /ZipException|zip END header|invalid LOC header|invalid distance/i,
        ),
      ),
    );
  }

  if (/InvalidModuleDescriptorException|Invalid module-info:/i.test(content)) {
    const paths = [
      ...new Set(
        [...content.matchAll(/Failed to create secure jar for "([^"\r\n]+\.jar)"/gi)].map((match) =>
          resolve(gameDirectory, match[1].replaceAll('\\', '/')),
        ),
      ),
    ].slice(0, 8);
    const fixes: StoredRepair[] = [];
    for (const path of paths) {
      // Only the exact local JAR named by the loader may be offered for repair.
      if (resolve(dirname(path)) !== resolve(join(gameDirectory, 'mods'))) {
        continue;
      }
      try {
        await safeRepairPath(gameDirectory, path);
        await fileStamp(path);
        fixes.push(
          repair(
            'disable-mod',
            `Desactivar ${basename(path)}`,
            'Aparta este mod para poder volver a iniciar. Puedes deshacer el cambio.',
            { kind: 'disable-mod', path },
          ),
        );
      } catch {
        // Missing files and links never authorize a repair.
      }
    }
    add(
      issue(
        'invalid-mod-module',
        'No se puede cargar uno de tus mods',
        `El loader ha rechazado ${paths.length ? paths.map((path) => basename(path)).join(', ') : 'el módulo de un mod'}. Desactiva el archivo indicado y descarga una edición compatible con tu versión de Minecraft y tu loader.`,
        'critical',
        'high',
        matchingEvidence(
          sources,
          /Failed to create secure jar|InvalidModuleDescriptorException|Invalid module-info:/i,
        ),
        fixes,
      ),
    );
  }

  if (dependencyFacts.some((fact) => fact.kind === 'wrong-loader')) {
    add(
      issue(
        'ignored-wrong-loader',
        'Hay mods de otro loader que no se han cargado',
        'Estos archivos se han ignorado. Usa ediciones para el loader seleccionado; este aviso por sí solo no demuestra la causa del cierre.',
        'warning',
        'high',
        dependencyFacts
          .filter((fact) => fact.kind === 'wrong-loader')
          .slice(0, 6)
          .map((fact) => ({ file: 'Minecraft', line: fact.evidence.slice(0, 420) })),
      ),
    );
  }
  if (dependencyPlans.some((plan) => plan.reason === 'empty-intersection')) {
    add(
      issue(
        'dependency-unsatisfiable',
        'Las dependencias exigen versiones que se contradicen',
        'No existe una versión que cumpla todos los rangos detectados. Cambia una de las versiones de los mods que la necesitan antes de instalar la dependencia.',
        'critical',
        'high',
        matchingEvidence(sources, /requires|HARD_DEP|Expected range/i),
      ),
    );
  }
  const expertGuidance = {
    runtime: [
      'dependency-loader-installation',
      'La instalación del loader está incompleta',
      'Repara o reinstala el loader antes de añadir dependencias. Sus archivos principales no son mods normales.',
    ],
    language: [
      'dependency-language',
      'Falta un proveedor de lenguaje para cargar los mods',
      'Comprueba la versión del loader y la dependencia de lenguaje indicada. No es un problema de RAM.',
    ],
    cycle: [
      'dependency-cycle',
      'Los mods tienen un ciclo en el orden de carga',
      'Los requisitos de orden se contradicen. Cambia una de las versiones implicadas; añadir más dependencias no resuelve este ciclo.',
    ],
    environment: [
      'dependency-environment',
      'Un mod o dependencia es para otro entorno',
      'Usa una edición para cliente o servidor según esta instalación. No se descarga ni se elimina un mod solo por el nombre de una clase.',
    ],
    nested: [
      'dependency-nested',
      'Las librerías incluidas dentro de los mods no coinciden',
      'Comprueba las versiones de los mods que incluyen estas librerías. No extraigas ni sustituyas archivos dentro de los JAR.',
    ],
    duplicate: [
      'duplicate-mods',
      'Hay identificadores de mods duplicados',
      'Conserva una sola versión de cada mod indicado. No se elige un archivo automáticamente: dos archivos pueden declarar el mismo identificador.',
    ],
    linkage: [
      'binary-mod-conflict',
      'Una librería o mod no coincide con sus dependencias',
      'Instala versiones del mod y sus dependencias compatibles entre sí y con este loader. La clase que recibe la llamada no identifica por sí sola al mod culpable.',
    ],
  } as const;
  for (const [kind, [id, title, description]] of Object.entries(expertGuidance)) {
    const facts = dependencyFacts.filter((fact) => fact.kind === kind && !fact.owner);
    if (!facts.length || issues.some((entry) => entry.id === id)) {
      continue;
    }
    add(
      issue(
        id,
        title,
        description,
        'critical',
        facts.every((fact) => fact.confidence === 'high') ? 'high' : 'medium',
        facts.slice(0, 6).map((fact) => ({
          file:
            sources.find((source) => source.content.includes(fact.evidence))?.name ?? 'Minecraft',
          line: fact.evidence.slice(0, maximumEvidenceLineCharacters),
        })),
      ),
    );
  }
  for (const diagnostic of additionalDiagnostics(sources)) {
    if (!issues.some((issue) => issue.id === diagnostic.id)) {
      add(diagnostic);
    }
  }
  return { issues: rankDiagnostics(issues, sources), repairs: allRepairs };
}

export class CrashAnalysisService {
  readonly #instances: InstanceStore;
  readonly #settings: SettingsStore;
  readonly #reports = new Map<string, StoredReport>();
  readonly #applied = new Map<string, AppliedRepair>();
  #repairBusy = false;
  readonly #installModDependency: CrashModDependencyInstaller | null;

  constructor(
    settings: SettingsStore,
    instances: InstanceStore,
    installModDependency: CrashModDependencyInstaller | null = null,
  ) {
    this.#settings = settings;
    this.#instances = instances;
    this.#installModDependency = installModDependency;
  }

  async analyze(input: CrashAnalysisInput): Promise<MinecraftCrashReport | null> {
    const numericCleanExit =
      input.exit !== null &&
      input.exit.code === 0 &&
      input.exit.signal === null &&
      !input.launchError;
    const preflight = input.launchError instanceof LaunchModDuplicatesError;
    const gameDirectory = resolve(input.gameDirectory);
    const candidates = new Set<string>(
      preflight ? [] : [input.launchLogPath, join(gameDirectory, 'logs', 'latest.log')],
    );
    if (!preflight) {
      for (const path of await newestFiles(
        join(gameDirectory, 'crash-reports'),
        /\.(?:txt|log)$/i,
        3,
      )) {
        candidates.add(path);
      }
      for (const path of await newestFiles(gameDirectory, /^hs_err_pid\d+\.log$/i, 2)) {
        candidates.add(path);
      }
    }
    const loaded = (await Promise.all([...candidates].map(loadSource))).filter(
      (value): value is LoadedSource => value !== null,
    );
    const recent = loaded.filter(
      (source) =>
        source.path === input.launchLogPath ||
        Date.parse(source.modifiedAt) >= input.launchStartedAt - 2_000,
    );
    if (input.launchError) {
      recent.push({
        name: preflight ? 'battly-mod-preflight.txt' : 'battly-launch-error.txt',
        path: 'Battly',
        modifiedAt: new Date().toISOString(),
        content: redact(preflight ? input.launchError.message : errorText(input.launchError)),
      });
    }
    const perSource = Math.floor(maximumCombinedCharacters / Math.max(1, recent.length));
    for (let index = 0; index < recent.length; index++) {
      const source = recent[index];
      const bounded =
        source.content.length > perSource
          ? source.content.slice(0, Math.floor(perSource / 3)) +
            '\n[registro recortado]\n' +
            source.content.slice(-Math.floor((perSource * 2) / 3) + 30)
          : source.content;
      recent[index] = { ...source, content: normalizeDiagnosticText(bounded) };
    }
    const combinedRecentLogs = recent.map((source) => source.content).join('\n');
    const hasFatalFailure = fatalFailurePattern.test(combinedRecentLogs);
    if (numericCleanExit && !hasFatalFailure) {
      return null;
    }
    const coreReportedGracefulExit =
      input.exit !== null &&
      input.exit.code === null &&
      input.exit.signal === null &&
      !input.launchError &&
      !hasFatalFailure &&
      isMinecraftGracefulShutdownMessage(combinedRecentLogs);
    if (coreReportedGracefulExit) {
      return null;
    }
    const settings = await this.#settings.snapshot();
    const currentMemoryGb = input.instanceId
      ? (normalizeInstanceDraft(await this.#instances.readInternal(input.instanceId)).launchProfile
          ?.ramMaxGb ?? settings.runtime.ramMaxGb)
      : settings.runtime.ramMaxGb;
    const detected = await detectIssues(
      recent,
      gameDirectory,
      currentMemoryGb,
      preflight ? input.launchError.loader : undefined,
    );
    if (hasFatalFailure && !detected.issues.some((entry) => entry.severity === 'critical')) {
      detected.issues.unshift(
        issue(
          'reported-game-crash',
          'Minecraft ha registrado un fallo',
          'Minecraft ha guardado un informe de error aunque el proceso haya cerrado con normalidad. Revisa los detalles del registro antes de volver a iniciar.',
          'critical',
          'high',
          matchingEvidence(recent, fatalFailurePattern),
        ),
      );
    }
    const abnormalExit =
      input.exit !== null && (input.exit.code !== 0 || input.exit.signal !== null);
    if (
      !abnormalExit &&
      !input.launchError &&
      !detected.issues.some((issue) => issue.severity === 'critical')
    ) {
      return null;
    }
    const id = safeId('crash');
    const files = new Map<string, string>();
    for (const fix of detected.repairs) {
      const paths =
        fix.operation.kind === 'resolve-mod-conflict'
          ? fix.operation.paths
          : 'path' in fix.operation
            ? [fix.operation.path]
            : [];
      for (const path of paths) {
        try {
          await safeRepairPath(gameDirectory, path);
          files.set(path, await fileStamp(path));
        } catch {
          /* Unsafe or changed targets will be rejected when applying. */
        }
      }
    }
    this.#reports.set(id, {
      expiresAt: Date.now() + 30 * 60 * 1000,
      files,
      gameDirectory,
      instanceId: input.instanceId,
      repairs: new Map(detected.repairs.map((entry) => [entry.id, entry])),
    });
    while (this.#reports.size > 12) {
      this.#reports.delete(this.#reports.keys().next().value as string);
    }
    const rawLog = recent
      .map((source) => `===== ${source.name} =====\n${source.content}`)
      .join('\n\n')
      .slice(-maximumCombinedCharacters);
    return {
      id,
      createdAt: new Date().toISOString(),
      exitCode: input.exit?.code ?? null,
      ...(preflight ? { stage: 'preflight' as const } : {}),
      instanceId: input.instanceId,
      issues: detected.issues.map((entry) => ({
        ...entry,
        repairs: (entry.repairs as readonly StoredRepair[]).map(publicRepair),
      })),
      sources: recent
        .filter((source) => source.path !== 'Battly')
        .map((source) => ({
          name: source.name,
          path: source.path,
          modifiedAt: source.modifiedAt,
        })),
      fingerprint: diagnosticFingerprint(detected.issues),
      engineVersion: dependencyEngineVersion,
      summary: detected.issues.length
        ? `Revisar primero: ${detected.issues[0].title}. ${detected.issues.length} diagnóstico(s) con evidencia local.`
        : 'Minecraft terminó de forma inesperada, pero no hay una firma conocida en los registros.',
      rawLog,
    };
  }

  async apply(
    reportId: string,
    repairId: string,
    mesaLibraryPath?: string,
    onProgress?: CrashModDependencyInstallRequest['onProgress'],
  ): Promise<MinecraftCrashRepairResult> {
    const report = this.#reports.get(reportId);
    const repair = report?.repairs.get(repairId);
    if (!report || !repair) {
      throw new TypeError('Crash repair is no longer available');
    }
    if (this.#repairBusy) {
      throw new Error('Ya hay una reparación en curso');
    }
    if (Date.now() > report.expiresAt) {
      throw new Error(
        'El diagnóstico ha caducado. Inicia de nuevo para analizar el estado actual.',
      );
    }
    this.#repairBusy = true;
    try {
      const paths =
        repair.operation.kind === 'resolve-mod-conflict'
          ? repair.operation.paths
          : 'path' in repair.operation
            ? [repair.operation.path]
            : [];
      for (const path of paths) {
        await safeRepairPath(report.gameDirectory, path);
        if (!report.files.has(path) || (await fileStamp(path)) !== report.files.get(path)) {
          throw new Error('El archivo cambió después del diagnóstico. No se aplicó la reparación.');
        }
      }
      const appliedId = safeId('applied');
      let applied: AppliedRepair;
      if (repair.operation.kind === 'adjust-memory') {
        applied = await this.#adjustMemory(report, repair.operation.maximumGb);
      } else if (repair.operation.kind === 'remove-jvm-argument') {
        applied = await this.#removeJvmArgument(report, repair.operation.argument);
      } else if (
        repair.operation.kind === 'disable-mod' ||
        repair.operation.kind === 'quarantine-file'
      ) {
        applied = await this.#quarantine(report, repair.operation.path, reportId);
      } else if (repair.operation.kind === 'resolve-mod-conflict') {
        applied = await this.#quarantineMany(report, repair.operation.paths, reportId);
      } else if (repair.operation.kind === 'install-mod-dependency') {
        applied = await this.#installDependency(report, repair.operation, reportId, onProgress);
      } else {
        applied = await this.#installMesa(report, mesaLibraryPath, reportId);
      }
      report.repairs.delete(repairId);
      this.#applied.set(appliedId, applied);
      while (this.#applied.size > 50) {
        this.#applied.delete(this.#applied.keys().next().value as string);
      }
      return {
        ok: true,
        message: 'Solución aplicada. Puedes deshacerla antes de volver a iniciar.',
        repairId: appliedId,
      };
    } finally {
      this.#repairBusy = false;
    }
  }

  async rollback(repairId: string): Promise<MinecraftCrashRepairResult> {
    const applied = this.#applied.get(repairId);
    if (!applied) {
      return {
        ok: false,
        message: 'Esta reparación ya no se puede deshacer en esta sesión.',
        repairId: null,
      };
    }
    if (this.#repairBusy) {
      throw new Error('Ya hay una reparación en curso');
    }
    this.#repairBusy = true;
    try {
      await applied.undo();
      this.#applied.delete(repairId);
    } finally {
      this.#repairBusy = false;
    }
    return { ok: true, message: 'La reparación se ha deshecho.', repairId: null };
  }

  async #adjustMemory(report: StoredReport, maximumGb: number): Promise<AppliedRepair> {
    if (report.instanceId) {
      const original = normalizeInstanceDraft(
        await this.#instances.readInternal(report.instanceId),
      );
      const profile = original.launchProfile ?? {
        javaPath: '',
        javaVersion: 'global' as const,
        jvmArgs: '',
        ramMinGb: null,
        ramMaxGb: null,
      };
      await this.#instances.update(report.instanceId, {
        ...original,
        launchProfile: {
          ...profile,
          ramMinGb: Math.min(profile.ramMinGb ?? 1, maximumGb),
          ramMaxGb: maximumGb,
        },
      });
      return {
        undo: async () => {
          const latest = normalizeInstanceDraft(
            await this.#instances.readInternal(report.instanceId as string),
          );
          if (latest.launchProfile?.ramMaxGb !== maximumGb) {
            throw new Error('La RAM cambió después de reparar. No se sobrescribirá.');
          }
          await this.#instances.update(report.instanceId as string, {
            ...latest,
            launchProfile: {
              ...latest.launchProfile,
              ramMinGb: profile.ramMinGb,
              ramMaxGb: profile.ramMaxGb,
            },
          });
        },
      };
    }
    const original = await this.#settings.snapshot();
    const privacy = {
      telemetryEnabled: original.privacy.telemetryEnabled,
      analyticsLogsEnabled: original.privacy.analyticsLogsEnabled,
      presenceShareStatus: original.privacy.presenceShareStatus,
      presenceShareServer: original.privacy.presenceShareServer,
      discordShareStatus: original.privacy.discordShareStatus,
      discordShareServer: original.privacy.discordShareServer,
    };
    await this.#settings.save({
      visual: original.visual,
      privacy,
      autoSyncEnabled: original.autoSyncEnabled,
      runtime: {
        ...original.runtime,
        autoRamEnabled: false,
        ramMinGb: Math.min(original.runtime.ramMinGb, maximumGb),
        ramMaxGb: maximumGb,
      },
    });
    return {
      undo: async () => {
        const latest = await this.#settings.snapshot();
        if (latest.runtime.ramMaxGb !== maximumGb) {
          throw new Error('La RAM cambió después de reparar. No se sobrescribirá.');
        }
        await this.#settings.save({
          visual: latest.visual,
          privacy: {
            telemetryEnabled: latest.privacy.telemetryEnabled,
            analyticsLogsEnabled: latest.privacy.analyticsLogsEnabled,
            presenceShareStatus: latest.privacy.presenceShareStatus,
            presenceShareServer: latest.privacy.presenceShareServer,
            discordShareStatus: latest.privacy.discordShareStatus,
            discordShareServer: latest.privacy.discordShareServer,
          },
          autoSyncEnabled: latest.autoSyncEnabled,
          runtime: {
            ...latest.runtime,
            ramMinGb: original.runtime.ramMinGb,
            ramMaxGb: original.runtime.ramMaxGb,
            autoRamEnabled: original.runtime.autoRamEnabled,
          },
        });
      },
    };
  }

  async #removeJvmArgument(report: StoredReport, argument: string): Promise<AppliedRepair> {
    if (!report.instanceId) {
      throw new Error('Abre Ajustes > Java para editar los argumentos globales');
    }
    const original = normalizeInstanceDraft(await this.#instances.readInternal(report.instanceId));
    const profile = original.launchProfile;
    if (!profile) {
      throw new Error('La instancia no tiene argumentos JVM propios');
    }
    const variants = new Set([argument, argument.startsWith('-') ? argument : `-${argument}`]);
    const nextArgs = profile.jvmArgs
      .split(/\s+/)
      .filter((value) => value && !variants.has(value))
      .join(' ');
    if (nextArgs === profile.jvmArgs) {
      throw new Error('El argumento ya no está en la instancia');
    }
    await this.#instances.update(report.instanceId, {
      ...original,
      launchProfile: { ...profile, jvmArgs: nextArgs },
    });
    return {
      undo: async () => {
        const latest = normalizeInstanceDraft(
          await this.#instances.readInternal(report.instanceId as string),
        );
        if (latest.launchProfile?.jvmArgs !== nextArgs) {
          throw new Error('Los argumentos cambiaron después de reparar. No se sobrescribirán.');
        }
        await this.#instances.update(report.instanceId as string, {
          ...latest,
          launchProfile: { ...latest.launchProfile, jvmArgs: profile.jvmArgs },
        });
      },
    };
  }

  async #quarantine(
    report: StoredReport,
    target: string,
    reportId: string,
  ): Promise<AppliedRepair> {
    if (!isInside(report.gameDirectory, target)) {
      throw new TypeError('Repair target escapes the game directory');
    }
    await safeRepairPath(report.gameDirectory, target);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new TypeError('Repair target must be a regular file');
    }
    const relativePath = relative(report.gameDirectory, target);
    const backup = join(report.gameDirectory, '.battly-crash-backups', reportId, relativePath);
    await safeRepairPath(report.gameDirectory, backup);
    await mkdir(dirname(backup), { recursive: true });
    await requireAbsent(backup);
    await rename(target, backup);
    return {
      undo: async () => {
        await safeRepairPath(report.gameDirectory, target);
        await mkdir(dirname(target), { recursive: true });
        await safeRepairPath(report.gameDirectory, backup);
        await requireAbsent(target);
        await rename(backup, target);
      },
    };
  }

  async #quarantineMany(
    report: StoredReport,
    targets: readonly string[],
    reportId: string,
  ): Promise<AppliedRepair> {
    if (!targets.length) {
      throw new Error('No quedan mods incompatibles que desactivar');
    }
    const uniqueTargets = [...new Set(targets.map((target) => resolve(target)))];
    for (const target of uniqueTargets) {
      if (!isInside(report.gameDirectory, target)) {
        throw new TypeError('Repair target escapes the game directory');
      }
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TypeError('Repair target must be a regular file');
      }
    }
    const applied: AppliedRepair[] = [];
    try {
      for (const target of uniqueTargets) {
        applied.push(await this.#quarantine(report, target, reportId));
      }
    } catch (error) {
      for (const entry of applied.reverse()) {
        await entry.undo().catch(() => undefined);
      }
      throw error;
    }
    return {
      undo: async () => {
        for (const entry of [...applied].reverse()) {
          await entry.undo();
        }
      },
    };
  }

  async #installDependency(
    report: StoredReport,
    operation: Extract<RepairOperation, { readonly kind: 'install-mod-dependency' }>,
    reportId: string,
    onProgress?: CrashModDependencyInstallRequest['onProgress'],
  ): Promise<AppliedRepair> {
    if (!this.#installModDependency) {
      throw new Error('La instalación automática de dependencias no está disponible');
    }
    for (const [path, stamp] of report.files) {
      if (
        isInside(join(report.gameDirectory, 'mods'), path) &&
        (await fileStamp(path).catch(() => '')) !== stamp
      ) {
        throw new Error('El archivo cambió después del diagnóstico. No se aplicó la reparación.');
      }
    }
    const currentInventory = await readCrashModInventory(report.gameDirectory);
    if (
      !currentInventory.complete ||
      currentInventory.filesById.has(operation.dependencyId) ||
      !operation.owners.length ||
      operation.owners.some((owner) => currentInventory.filesById.get(owner)?.length !== 1)
    ) {
      throw new Error(
        'La lista de mods ha cambiado o no se pudo comprobar completa. Vuelve a analizar antes de instalar dependencias.',
      );
    }
    const installed = [
      ...new Set(
        (
          await this.#installModDependency({
            onProgress,
            dependencyId: operation.dependencyId,
            requiredVersion: operation.requiredVersion,
            gameVersion: operation.gameVersion,
            loader: operation.loader,
            gameDirectory: report.gameDirectory,
          })
        ).map((path) => resolve(path)),
      ),
    ];
    if (!installed.length) {
      throw new Error('Modrinth no devolvió ningún archivo instalable');
    }
    const modsDirectory = join(report.gameDirectory, 'mods');
    for (const target of installed) {
      if (!isInside(modsDirectory, target)) {
        throw new TypeError('Installed dependency escapes the mods directory');
      }
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new TypeError('Installed dependency must be a regular file');
      }
    }
    return {
      undo: async () => {
        for (const target of installed) {
          try {
            const backup = join(
              report.gameDirectory,
              '.battly-crash-backups',
              reportId,
              'installed-dependencies',
              basename(target),
            );
            await mkdir(dirname(backup), { recursive: true });
            await rename(target, backup);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
          }
        }
      },
    };
  }

  async #installMesa(
    report: StoredReport,
    selectedPath: string | undefined,
    reportId: string,
  ): Promise<AppliedRepair> {
    if (process.platform !== 'win32') {
      throw new Error('Mesa3D local sólo está disponible en Windows');
    }
    if (
      !selectedPath ||
      !isAbsolute(selectedPath) ||
      basename(selectedPath).toLowerCase() !== 'opengl32.dll'
    ) {
      throw new CrashRepairFileRequiredError();
    }
    const info = await lstat(selectedPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size < 100_000 ||
      info.size > 100 * 1024 * 1024
    ) {
      throw new TypeError('El DLL de Mesa3D no es válido');
    }
    const handle = await open(selectedPath, 'r');
    try {
      const signature = Buffer.alloc(2);
      await handle.read(signature, 0, 2, 0);
      if (signature.toString('ascii') !== 'MZ') {
        throw new TypeError('El archivo no es una biblioteca de Windows');
      }
    } finally {
      await handle.close();
    }
    const target = join(report.gameDirectory, 'opengl32.dll');
    const backup = join(report.gameDirectory, '.battly-crash-backups', reportId, 'opengl32.dll');
    let previous = false;
    try {
      const targetInfo = await lstat(target);
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) {
        throw new TypeError('El opengl32.dll actual no es seguro');
      }
      await mkdir(dirname(backup), { recursive: true });
      await rename(target, backup);
      previous = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await copyFile(selectedPath, target);
    } catch (error) {
      if (previous) {
        await rename(backup, target);
      }
      throw error;
    }
    return {
      undo: async () => {
        await unlink(target).catch(() => undefined);
        if (previous) {
          await rename(backup, target);
        }
      },
    };
  }
}

export class CrashRepairFileRequiredError extends Error {
  constructor() {
    super('Selecciona el archivo opengl32.dll de Mesa3D');
    this.name = 'CrashRepairFileRequiredError';
  }
}
