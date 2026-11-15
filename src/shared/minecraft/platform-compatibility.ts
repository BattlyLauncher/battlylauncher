export function is32BitArchitecture(architecture?: string): boolean {
  return architecture === 'ia32' || architecture === 'arm';
}

export const minecraft32BitNotice =
  'Tu sistema operativo es de 32 bits. Minecraft 1.20.5 y posteriores requieren un sistema de 64 bits (Java 21; desde 26.1, Java 25). También afecta a Forge, Fabric, Quilt, NeoForge y otros loaders. Puedes seguir descargando versiones hasta 1.20.4. Instalar otro Java no convierte tu sistema en uno de 64 bits: para jugar a versiones nuevas necesitas un sistema operativo de 64 bits y un procesador compatible.';

/** Use the Minecraft version, never the modloader build number. */
export function requires64BitMinecraft(
  version: string,
  requiredJava?: string | number | null,
): boolean {
  if (Number(requiredJava) >= 21) {
    return true;
  }
  const snapshot = /(?:^|[^\d])(\d{2})w(\d{2})[a-z]/i.exec(version);
  if (snapshot) {
    return Number(snapshot[1]) > 24 || (Number(snapshot[1]) === 24 && Number(snapshot[2]) >= 14);
  }
  const release =
    /(?:^|[^\d.])(1\.(\d+)(?:\.(\d+))?|(?:2[6-9]|[3-9]\d)\.\d+(?:\.\d+)?)(?=$|[^\d.])/.exec(
      version,
    );
  if (!release) {
    return false;
  }
  if (!release[1].startsWith('1.')) {
    return true;
  }
  return Number(release[2]) > 20 || (Number(release[2]) === 20 && Number(release[3] ?? 0) >= 5);
}
