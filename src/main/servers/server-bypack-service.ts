import { BypackService } from '../minecraft/bypack-service';
import type { ServerStore } from './server-store';

// A server root contains worlds, accounts, keys and runtime files: export only client content.
const sharedRoots = new Set([
  'mods',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts',
  'resourcepacks',
  'shaderpacks',
]);

export function createServerBypackService(
  store: Pick<ServerStore, 'list' | 'directoryPathInternal'>,
  root: string,
  options: ConstructorParameters<typeof BypackService>[2] = {},
): BypackService {
  return new BypackService(
    {
      directoryPathInternal: (id) => store.directoryPathInternal(id),
      readInternal: async (id) => {
        const server = (await store.list()).find((entry) => entry.id === id);
        if (!server) {
          throw new Error('Servidor no encontrado');
        }
        const loader = ['fabric', 'forge', 'neoforge'].includes(server.software.kind)
          ? server.software.kind
          : null;
        const build = server.software.build;
        const prefix = server.version + '-';
        return {
          name: server.name,
          description: 'Mods y configuración de ' + server.name,
          version: server.version,
          loader,
          loaderVersion: loader
            ? build?.startsWith(prefix)
              ? build.slice(prefix.length)
              : build
            : null,
        };
      },
    },
    root,
    { ...options, includePath: (path) => sharedRoots.has(path.split('/')[0].toLowerCase()) },
  );
}
