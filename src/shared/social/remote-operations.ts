import { desktopChannels } from '../desktop-api';
export const remoteOperations = {
  instances: desktopChannels.getInstances,
  'create-instance': desktopChannels.createInstance,
  'update-instance': desktopChannels.updateInstance,
  'archive-instance': desktopChannels.archiveInstance,
  'instance-content': desktopChannels.getInstanceContent,
  'act-instance-content': desktopChannels.actInstanceContent,
  catalog: desktopChannels.getPlayVersions,
  'loader-builds': desktopChannels.getLoaderBuilds,
  'start-version': desktopChannels.startPlayVersion,
  'start-instance': desktopChannels.startInstance,
  java: desktopChannels.getManagedJava,
  'install-java': desktopChannels.installManagedJava,
  'select-java': desktopChannels.selectManagedJava,
  'automatic-java': desktopChannels.clearManagedJava,
  'search-mods': desktopChannels.searchMods,
  'install-mod': desktopChannels.installMod,
  mods: desktopChannels.getLocalMods,
  'toggle-mod': desktopChannels.toggleLocalMod,
  'archive-mod': desktopChannels.archiveLocalMod,
  cancel: desktopChannels.cancelLaunch,
} as const;
export const remoteReadOperations = new Set([
  'instances',
  'instance-content',
  'catalog',
  'loader-builds',
  'java',
  'search-mods',
  'mods',
]);
export function remoteOperation(value: unknown): keyof typeof remoteOperations {
  if (typeof value !== 'string' || !Object.hasOwn(remoteOperations, value)) {
    throw new TypeError('Unsupported remote operation');
  }
  return value as keyof typeof remoteOperations;
}
