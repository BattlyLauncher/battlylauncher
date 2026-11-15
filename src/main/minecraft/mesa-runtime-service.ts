import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { path7za } from '7zip-bin';
import { VerifiedDownloader } from '../mods/verified-download';
import type { MinecraftLaunchEventSink, MinecraftLaunchOptions } from './launcher-adapter';
import { withJavaMemoryLimit } from './prepare-launch-java';

const version = '26.2.1';
const archive = {
  url: `https://github.com/pal1000/mesa-dist-win/releases/download/${version}/mesa3d-${version}-release-msvc.7z`,
  expectedSize: 71046553,
  expectedSha512:
    '4fb1d3c27f9ab8ae9fb815e22bba30d7ae7b06a3a6d5a1419d3120b33a3c085544d0e93788669403207464b1eab336727a9c7b2f88c766aaf3ce326233151767',
};
const dlls = ['opengl32.dll', 'libgallium_wgl.dll'];
const run = promisify(execFile);

export function isMesaCompatibleFailure(log: string): boolean {
  return /GLFW error 65542\b|WGL: The driver does not appear to support OpenGL|Pixel format not accelerated|GLFW error 65543[^\r\n]*(?:WGL|OpenGL)|WGL: Failed to create OpenGL context/i.test(
    log,
  );
}

export async function windowsBinaryArchitecture(path: string): Promise<'x64' | 'x86'> {
  const file = await open(path, 'r');
  try {
    const header = Buffer.alloc(64);
    if (
      (await file.read(header, 0, 64, 0)).bytesRead !== 64 ||
      header.toString('ascii', 0, 2) !== 'MZ'
    ) {
      throw new Error('Java no es un ejecutable de Windows válido');
    }
    const offset = header.readUInt32LE(60);
    if (offset > 1024 * 1024) {
      throw new Error('Cabecera PE inválida');
    }
    const pe = Buffer.alloc(6);
    if ((await file.read(pe, 0, 6, offset)).bytesRead !== 6 || pe.readUInt32LE(0) !== 0x4550) {
      throw new Error('Cabecera PE inválida');
    }
    const machine = pe.readUInt16LE(4);
    if (machine === 0x8664) {
      return 'x64';
    }
    if (machine === 0x14c) {
      return 'x86';
    }
    throw new Error('Mesa3D automático requiere Java x64 o x86');
  } finally {
    await file.close();
  }
}

/** Mesa lives in a private Java copy; never replace drivers or the user's Java. */
export class MesaRuntimeService {
  private readonly pending = new Map<string, Promise<string>>();
  constructor(private readonly root: string) {}

  async prepare(
    options: MinecraftLaunchOptions,
    emit: MinecraftLaunchEventSink,
    signal: AbortSignal,
  ): Promise<MinecraftLaunchOptions> {
    if (!options.javaPath) {
      throw new Error('No se encontró el runtime de Java para Mesa3D');
    }
    const java = resolve(options.javaPath);
    const info = await lstat(java);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !/^javaw?\.exe$/i.test(basename(java)) ||
      basename(dirname(java)).toLowerCase() !== 'bin'
    ) {
      throw new Error('La ruta de Java no permite preparar Mesa3D de forma aislada');
    }
    const architecture = await windowsBinaryArchitecture(java);
    // llvmpipe shares the 32-bit address space with the JVM. A 1 GiB heap
    // exhausted native metaspace while loading a world in the Windows x86 VM.
    if (architecture === 'x86') {
      options = withJavaMemoryLimit(
        options,
        32,
        (message) => emit({ type: 'log', stream: 'game', message: `[Battly] Mesa3D: ${message}` }),
        768,
      );
    }
    const home = dirname(dirname(java));
    const release = await readFile(join(home, 'release'), 'utf8');
    const cacheRelative = relative(home, resolve(this.root));
    if (
      !cacheRelative ||
      (!isAbsolute(cacheRelative) &&
        cacheRelative !== '..' &&
        !cacheRelative.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
    ) {
      throw new Error('La caché Mesa3D debe estar fuera del runtime de Java');
    }
    if (!/JAVA_VERSION=/.test(release)) {
      throw new Error('No se reconoce el runtime de Java');
    }
    const key = createHash('sha256')
      .update(`${version}|${java}|${info.mtimeMs}|${info.size}|${release}`)
      .digest('hex');
    let preparing = this.pending.get(key);
    if (!preparing) {
      preparing = this.install(home, architecture, key, emit, signal).finally(() =>
        this.pending.delete(key),
      );
      this.pending.set(key, preparing);
    }
    const bin = join(await preparing, 'bin');
    signal.throwIfAborted();
    return {
      ...options,
      environment: {
        ...options.environment,
        GALLIUM_DRIVER: 'llvmpipe',
        LIBGL_ALWAYS_SOFTWARE: 'true',
      },
      javaPath: join(bin, basename(java)),
      javaArguments: [
        ...options.javaArguments.filter((arg) => !arg.startsWith('-Dorg.lwjgl.opengl.libname=')),
        `-Dorg.lwjgl.opengl.libname=${join(bin, 'opengl32.dll')}`,
      ],
    };
  }

  private async install(
    home: string,
    architecture: string,
    key: string,
    emit: MinecraftLaunchEventSink,
    signal: AbortSignal,
  ): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const target = join(this.root, key);
    try {
      const hashes = JSON.parse(await readFile(join(target, 'mesa-ready.json'), 'utf8')) as Record<
        string,
        string
      >;
      for (const dll of dlls) {
        const digest = createHash('sha256')
          .update(await readFile(join(target, 'bin', dll)))
          .digest('hex');
        if (hashes[dll] !== digest) {
          throw new Error('Mesa cache changed');
        }
      }
      return target;
    } catch {
      /* Incomplete copies are never launched. */
    }
    const staging = await mkdtemp(join(this.root, '.preparing-'));
    try {
      const packagePath = join(staging, 'mesa.7z');
      await new VerifiedDownloader().download(
        archive,
        packagePath,
        AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        (current, total) =>
          emit({ type: 'progress', current, total, item: 'Mesa3D · compatibilidad gráfica' }),
      );
      const extracted = join(staging, 'drivers');
      await run(
        path7za.replace('app.asar', 'app.asar.unpacked'),
        ['x', packagePath, `-o${extracted}`, ...dlls.map((dll) => `${architecture}/${dll}`), '-y'],
        { windowsHide: true, signal, timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      signal.throwIfAborted();
      const runtime = join(staging, 'java');
      emit({
        type: 'log',
        stream: 'game',
        message: '[Battly] Preparando una copia aislada de Java con Mesa3D…',
      });
      await cp(home, runtime, {
        recursive: true,
        dereference: true,
        filter: () => {
          signal.throwIfAborted();
          return true;
        },
      });
      const hashes: Record<string, string> = {};
      for (const dll of dlls) {
        const source = join(extracted, architecture, dll);
        if ((await windowsBinaryArchitecture(source)) !== architecture) {
          throw new Error('Arquitectura de Mesa3D incorrecta');
        }
        await copyFile(source, join(runtime, 'bin', dll));
        hashes[dll] = createHash('sha256')
          .update(await readFile(source))
          .digest('hex');
      }
      await writeFile(join(runtime, 'mesa-ready.json'), JSON.stringify(hashes));
      signal.throwIfAborted();
      // Only the keyed cache directory is replaced, never the original Java directory.
      await rm(target, { recursive: true, force: true });
      await rename(runtime, target);
      return target;
    } finally {
      await rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    }
  }
}
