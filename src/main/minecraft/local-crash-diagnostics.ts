import { formatLog4jText } from '../../shared/minecraft/log4j-log';
import { createHash } from 'node:crypto';
import type { MinecraftCrashIssue } from '../../shared/minecraft/crash-report-contract';

export interface DiagnosticSource {
  readonly name: string;
  readonly content: string;
}
interface Rule {
  id: string;
  title: string;
  pattern: RegExp;
  advice: string;
}
// Independent rules: logs are evidence, never executable instructions.
const rules: readonly Rule[] = [
  {
    id: 'optifine-forge-unavailable',
    title: 'OptiFine no está disponible para esta combinación',
    pattern: /OptiFine no tiene una edición compatible con Forge para Minecraft/i,
    advice: 'Elige Forge sin OptiFine u OptiFine por separado. No hace falta reinstalar Minecraft.',
  },
  {
    id: 'optifine-service-load',
    title: 'Forge no pudo cargar OptiFine',
    pattern:
      /Invalid Services found OptiFine|Error loading OptiFine ZIP file|Service failed to load OptiFine/i,
    advice:
      'Deja una sola edición de OptiFine para la versión de Minecraft que estás abriendo. Una edición de otra versión o varias ediciones juntas pueden impedir el inicio.',
  },
  {
    id: 'bytecode-verification',
    title: 'Java ha rechazado una clase modificada',
    pattern: /java\.lang\.VerifyError:|Bad local variable type|Inconsistent stackmap frames/,
    advice:
      'El bytecode modificado no pasa la verificación de Java. Revisa los parches del loader antes de desactivar mods. No desactives la verificación de Java.',
  },
  {
    id: 'fabric-class-tweaker',
    title: 'Fabric no pudo leer las modificaciones de clases de un mod',
    pattern: /Failed to read (?:classTweaker|accessWidener) file from mod/i,
    advice:
      'Revisa la causa que aparece debajo de este error. Instala una edición del mod para tu Minecraft y loader; si el archivo está dañado, vuelve a descargar el mod. No se modifica ni se borra el JAR sin identificar su propietario.',
  },
  {
    id: 'native-memory',
    title: 'Java agotó la memoria nativa',
    pattern:
      /unable to create (?:new )?native thread|Native memory allocation .* failed|OutOfMemoryError: (?:Direct buffer memory|Cannot reserve)|insufficient memory for the Java Runtime/i,
    advice:
      'Cierra otras aplicaciones y reduce la RAM máxima de Minecraft para dejar espacio al sistema. Aumentar el heap puede empeorar este error.',
  },
  {
    id: 'metaspace',
    title: 'Se agotó la memoria de clases',
    pattern: /OutOfMemoryError: (?:Metaspace|Compressed class space)/i,
    advice:
      'Revisa límites como MaxMetaspaceSize y la compatibilidad de los mods. La RAM del heap no controla esta memoria.',
  },
  {
    id: 'duplicate-mods',
    title: 'Hay identificadores de mods duplicados',
    pattern:
      /Duplicate mandatory mod ids\s*\[|DuplicateModsFoundException|Found duplicate mods|Duplicate mod(?:s| ID| id)/i,
    advice:
      'Conserva una sola versión de cada mod indicado. No se elige un archivo automáticamente: dos archivos pueden declarar el mismo identificador.',
  },
  {
    id: 'binary-mod-conflict',
    title: 'Una librería o mod no coincide con sus dependencias',
    pattern: /NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError/i,
    advice:
      'Instala versiones del mod y sus dependencias compatibles entre sí y con este loader. La clase que recibe la llamada no identifica por sí sola al mod culpable.',
  },
  {
    id: 'missing-class',
    title: 'Falta una clase necesaria para iniciar',
    pattern: /(?:NoClassDefFoundError|ClassNotFoundException):/i,
    advice:
      'Comprueba las dependencias del mod señalado y su versión de Minecraft. Si la clase pertenece al juego o al loader, repara esa instalación.',
  },
  {
    id: 'native-architecture',
    title: 'Java y una librería nativa tienen arquitecturas distintas',
    pattern:
      /Can't load (?:AMD 64-bit|IA 32-bit|AARCH64).*platform|wrong ELF class|not a valid Win32 application|%1 is not a valid Win32|incompatible architecture/i,
    advice:
      'Usa Java y librerías nativas de la misma arquitectura. Reinstala las librerías desde el launcher; no descargues DLL sueltas de sitios desconocidos.',
  },
  {
    id: 'native-library',
    title: 'No se pudo cargar una librería nativa',
    pattern:
      /UnsatisfiedLinkError|Failed to load library:.*(?:lwjgl|glfw|OpenAL)|LWJGL native metadata does not match the selected platform and architecture/i,
    advice:
      'Revisa el archivo indicado, la arquitectura de Java y los archivos en cuarentena del antivirus. No desactives la protección global del equipo.',
  },
  {
    id: 'access-denied',
    title: 'El juego no puede acceder a un archivo',
    pattern:
      /AccessDeniedException|Permission denied|\bEACCES\b|\bEPERM:|being used by another process/i,
    advice:
      'Cierra otras instancias que utilicen esa carpeta y comprueba sus permisos. El diagnóstico no cambia permisos ni ejecuta Battly como administrador.',
  },
  {
    id: 'world-lock',
    title: 'El mundo está abierto en otro proceso',
    pattern:
      /session\.lock.*(?:locked|used|denied)|already locked|Failed to check session lock|WorldConflictException/i,
    advice:
      'Cierra el otro Minecraft o servidor antes de abrir el mundo. No borres session.lock mientras siga abierto.',
  },
  {
    id: 'world-corruption',
    title: 'Hay datos del mundo que no se pueden leer',
    pattern:
      /RegionFile.*(?:corrupt|invalid)|ReportedException: (?:Loading NBT data|Exception reading)|Failed to (?:read|load).*level\.dat/i,
    advice:
      'Haz una copia completa del mundo y restaura una copia conocida. Battly no borra regiones, chunks ni datos del jugador automáticamente.',
  },
  {
    id: 'tls-certificate',
    title: 'La conexión segura no pudo validarse',
    pattern:
      /SSLHandshakeException|PKIX path building failed|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i,
    advice:
      'Comprueba la fecha del equipo, los certificados de Java y cualquier proxy. No desactives la validación TLS.',
  },
  {
    id: 'dns-failure',
    title: 'No se pudo resolver la dirección del servicio',
    pattern: /UnknownHostException|ENOTFOUND|EAI_AGAIN/i,
    advice:
      'Comprueba la conexión y la resolución DNS del dominio indicado. Reinstalar mods no soluciona un fallo de DNS.',
  },
  {
    id: 'session-expired',
    title: 'La sesión de Minecraft no es válida',
    pattern:
      /Invalid session|InvalidCredentialsException|Failed to verify username|AuthenticationException:.*(?:invalid|expired)/i,
    advice:
      'Vuelve a iniciar sesión con la cuenta seleccionada. No compartas los tokens del registro.',
  },
  {
    id: 'stack-overflow',
    title: 'El juego entró en una cadena de llamadas excesiva',
    pattern: /StackOverflowError/i,
    advice:
      'Revisa las clases que se repiten en la traza y los mods que las modifican. Aumentar la RAM no corrige una recursión infinita.',
  },
  {
    id: 'watchdog',
    title: 'Un tick quedó bloqueado demasiado tiempo',
    pattern: /A single server tick took|ServerHangWatchdog|Watching Server.*(?:crash|hang)/i,
    advice:
      'Revisa el hilo del servidor en el informe y los mods o entidades que estaba procesando. No desactives el watchdog como solución.',
  },
  {
    id: 'gpu-native-crash',
    title: 'El controlador gráfico falló dentro de código nativo',
    pattern: /(?:C {2}\[|Problematic frame:).*?(?:nvoglv|atio6axx|ig(?:7|9|4)icd|libGL|libnvidia)/i,
    advice:
      'Actualiza o reinstala el controlador del fabricante y prueba sin shaders ni overlays. Este fallo nativo no demuestra que Mesa3D vaya a resolverlo.',
  },
];

export function normalizeDiagnosticText(content: string): string {
  return formatLog4jText(
    content
      .split(/\r?\n/)
      .map((line) => {
        try {
          const data = JSON.parse(line) as { event?: { message?: unknown }; message?: unknown };
          const message = data?.event?.message ?? data?.message;
          return typeof message === 'string' ? message : line;
        } catch {
          return line;
        }
      })
      .join('\n'),
  );
}

export function additionalDiagnostics(sources: readonly DiagnosticSource[]): MinecraftCrashIssue[] {
  const lines = sources.flatMap((source) =>
    source.content.split(/\r?\n/).map((line, index, all) => ({
      file: source.name,
      line,
      backgroundAuth: all
        .slice(Math.max(0, index - 3), index + 1)
        .some((previous) =>
          /Failed to fetch user properties|Realms.*(?:authorize|authentication)/i.test(previous),
        ),
    })),
  );
  return rules.flatMap((rule) => {
    const evidence = lines
      .filter(
        (entry) =>
          rule.pattern.test(entry.line) &&
          !(
            rule.id === 'missing-class' &&
            /\bWARN\b.*(?:Error loading class|@Mixin target)/i.test(entry.line)
          ) &&
          !(rule.id === 'session-expired' && entry.backgroundAuth),
      )
      .slice(-3)
      .map((entry) => ({ file: entry.file, line: entry.line.slice(0, 420) }));
    return evidence.length
      ? [
          {
            id: rule.id,
            title: rule.title,
            description: rule.advice,
            severity: 'critical' as const,
            confidence: 'high' as const,
            evidence,
            repairs: [],
          },
        ]
      : [];
  });
}

export function rankDiagnostics(
  issues: readonly MinecraftCrashIssue[],
  sources: readonly DiagnosticSource[],
): MinecraftCrashIssue[] {
  const ids = new Set(issues.map((issue) => issue.id));
  const suppressed = new Set<string>();
  if (
    issues.some((issue) => issue.id === 'duplicate-mods' && /\boptifine\b/i.test(issue.description))
  ) {
    suppressed.add('optifine-service-load');
  }
  if (ids.has('sodium-lwjgl-conflict')) {
    suppressed.add('binary-mod-conflict');
    suppressed.add('unclassified-exception');
    suppressed.add('missing-class');
  }
  if (ids.has('native-architecture') || ids.has('opengl-driver')) {
    suppressed.add('native-library');
  }
  if (ids.has('world-lock')) {
    suppressed.add('access-denied');
  }
  if (ids.has('loader-inheritance')) {
    suppressed.add('missing-class');
  }
  if (ids.has('wrong-java')) {
    suppressed.add('missing-class');
  }
  if (ids.has('fabric-namespace-mismatch')) {
    suppressed.add('fabric-class-tweaker');
  }
  const causalLines = sources.flatMap((source) =>
    source.content
      .split(/\r?\n/)
      .filter((line) => /Caused by:/.test(line))
      .slice(-8),
  );
  const score = (issue: MinecraftCrashIssue): number =>
    (issue.confidence === 'high' ? 20 : 0) +
    (issue.severity === 'critical' ? 10 : 0) +
    (issue.evidence.some((e) => causalLines.some((line) => line.includes(e.line))) ? 15 : 0) +
    ([
      'disk-full',
      'native-memory',
      'wrong-java',
      'native-architecture',
      'dependency-loader-installation',
      'dependency-language',
      'dependency-unsatisfiable',
    ].includes(issue.id)
      ? 10
      : 0);
  if (!issues.some((issue) => issue.severity === 'critical')) {
    const cause = sources
      .flatMap((source) =>
        source.content
          .split(/\r?\n/)
          .filter((line) => /(?:Caused by:|Exception in thread)\s/.test(line))
          .slice(-1)
          .map((line) => ({ file: source.name, line: line.slice(0, 420) })),
      )
      .slice(-2);
    if (cause.length) {
      return [
        {
          id: 'unclassified-exception',
          title: 'Excepción sin una reparación conocida',
          description:
            'Se ha localizado la última causa declarada por Java. Conserva esta traza para el reporte; no hay evidencia suficiente para modificar archivos automáticamente.',
          severity: 'warning',
          confidence: 'medium',
          evidence: cause,
          repairs: [],
        },
        ...issues,
      ];
    }
  }
  return [...issues]
    .filter((issue) => !suppressed.has(issue.id))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 20);
}

export function diagnosticFingerprint(issues: readonly MinecraftCrashIssue[]): string {
  return createHash('sha256')
    .update(
      issues
        .map((issue) => issue.id)
        .sort()
        .join('|'),
    )
    .digest('hex')
    .slice(0, 16);
}
