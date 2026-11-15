export function userErrorMessage(
  value: unknown,
  fallback = 'No se pudo completar la acción. Vuelve a intentarlo.',
): string {
  const raw = (
    value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  ).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
  if (/BATTLY_OFFLINE|ENETUNREACH/.test(raw)) {
    return 'Estás sin conexión';
  }
  if (/CurseForge pack has no valid manifest\.json/i.test(raw)) {
    return 'El archivo no contiene un modpack válido de CurseForge. Descarga el ZIP del modpack o importa un archivo .mrpack de Modrinth.';
  }
  if (/manifest|modrinth\.index\.json|invalid.*(?:archive|zip|mrpack)|invalid.*pack/i.test(raw)) {
    return 'El modpack está incompleto o tiene un formato no compatible. Vuelve a descargarlo desde Modrinth o CurseForge.';
  }
  if (/ENOSPC|disk.*full/i.test(raw)) {
    return 'No queda espacio suficiente en el disco. Libera espacio y vuelve a intentarlo.';
  }
  if (/EACCES|EPERM|permission denied/i.test(raw)) {
    return 'Battly no tiene acceso a la carpeta. Cierra los programas que la estén usando y comprueba sus permisos.';
  }
  if (/ENOTFOUND|ECONN|fetch failed|network|timed? ?out|timeout/i.test(raw)) {
    return 'No se pudo conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.';
  }
  if (/checksum|hash mismatch|size mismatch/i.test(raw)) {
    return 'La descarga está incompleta o dañada. Vuelve a descargar el archivo.';
  }
  if (/ENOENT|no such file/i.test(raw)) {
    return 'El archivo o la carpeta ya no existe. Selecciónalo de nuevo.';
  }
  if (/\b429\b/.test(raw)) {
    return 'El servidor ha recibido demasiadas solicitudes. Espera unos minutos y vuelve a intentarlo.';
  }
  if (/\b(?:401|403)\b/.test(raw)) {
    return 'El servidor ha rechazado el acceso. Comprueba tu sesión y los permisos de la cuenta.';
  }
  if (
    /Error invoking remote method|(?:Type|Range|Syntax|Reference)Error|\bat .*:\d+|[A-Z]:\\/.test(
      raw,
    )
  ) {
    return fallback;
  }
  return /^(?:No |El |La |Los |Las |Se |Necesitas|Debes|Selecciona|Comprueba)/.test(raw) &&
    raw.length < 350
    ? raw
    : fallback;
}
