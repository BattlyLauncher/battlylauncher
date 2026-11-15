import { askBattly } from './ask-modal';

export async function toggleModWithDependents(
  filename: string,
  enabled: boolean,
  instanceId?: string,
): Promise<void> {
  const names = [filename];
  if (enabled) {
    const dependents = await window.battly.getModDisableDependents(filename, instanceId);
    if (
      dependents.length &&
      (await askBattly({
        title: 'Otros mods necesitan este mod',
        text: `${dependents.map((mod) => mod.name).join(', ')} necesitan ${filename}. Te recomendamos desactivarlos también para evitar errores al iniciar Minecraft.`,
        confirmText: 'Desactivar también',
        cancelText: 'Solo este mod',
      }))
    ) {
      names.push(...dependents.map((mod) => mod.filename));
    }
  }
  for (const name of names) {
    if (instanceId) {
      await window.battly.actInstanceContent(instanceId, 'mods', name, 'toggle');
    } else {
      await window.battly.toggleLocalMod(name);
    }
  }
}
