import type { BattlyDesktopApi } from '../../shared/desktop-api';
import type { PlayVersionLaunchRequest } from '../../shared/minecraft/play-version-contract';
import {
  findWorldsPlayVersion,
  parseWorldsVersion,
  worldsPlayRequest,
} from '../../shared/social/worlds-version';

/** Resolve only local files or the trusted Battly catalog, never an invitation URL. */
export async function prepareWorldsPlayRequest(
  api: Pick<BattlyDesktopApi, 'getPlayVersions' | 'getCustomClients' | 'installPlayClient'>,
  raw: string,
  address: string,
  isCurrent: () => boolean,
  progress: (message: string) => void,
): Promise<PlayVersionLaunchRequest> {
  const checkRoom = (): void => {
    if (!isCurrent()) {
      throw new Error('La sala cambió. Vuelve a entrar antes de iniciar Minecraft.');
    }
  };
  let installed = (await api.getPlayVersions()).installed;
  checkRoom();
  let versionId = raw;
  if (!parseWorldsVersion(raw) && !findWorldsPlayVersion(raw, installed)) {
    progress(`Buscando ${raw} en el catálogo de Battly…`);
    const clients = await api.getCustomClients();
    checkRoom();
    const client = clients.find(
      (item) => item.folderName === raw || item.id === raw || item.name === raw,
    );
    if (!client) {
      throw new Error(
        `La sala usa el cliente personalizado «${raw}», pero sus archivos no están instalados ni disponibles en el catálogo de Battly. El anfitrión debe compartir los archivos del cliente.`,
      );
    }
    versionId = client.folderName;
    if (!findWorldsPlayVersion(versionId, installed)) {
      progress(`Descargando ${client.name}…`);
      await api.installPlayClient(client.id);
      checkRoom();
      installed = (await api.getPlayVersions()).installed;
    }
  }
  checkRoom();
  return worldsPlayRequest(versionId, installed, address);
}
