import { normalizeServerSummary, type ServerSummary } from '../../shared/servers/server-contract';
import { readBoundedResponse } from '../network/read-bounded-response';
import { serverDomainTakenMessage } from '../../shared/servers/server-errors';

export interface ServerAccountRegistry {
  list(local: readonly ServerSummary[]): Promise<ServerSummary[]>;
  create(server: ServerSummary): Promise<ServerSummary>;
  update(server: ServerSummary): Promise<void>;
  remove(id: string): Promise<void>;
}

export function serverAccountRegistry(
  token: () => Promise<string>,
  api: string,
): ServerAccountRegistry {
  let cache: { token: string; until: number; servers: ServerSummary[] } | undefined;
  const request = async (
    method: string,
    suffix: string,
    body?: unknown,
  ): Promise<ServerSummary[]> => {
    const accessToken = await token();
    if (suffix === '/sync' && cache?.token === accessToken && cache.until > Date.now()) {
      return cache.servers;
    }
    if (suffix !== '/sync') {
      cache = undefined;
    }
    const response = await fetch(`${api.replace(/\/$/, '')}/launcher/account-servers${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await readBoundedResponse(
      response,
      1024 * 1024,
      'Respuesta de servidores demasiado grande',
    );
    const value = JSON.parse(raw) as { servers?: unknown[]; error?: string; code?: string };
    if (!response.ok) {
      if (response.status === 409 && value.code === 'SERVER_DOMAIN_TAKEN') {
        throw new Error(serverDomainTakenMessage);
      }
      throw new Error(value.error || 'No se pudo consultar Battly Servers');
    }
    if (!Array.isArray(value.servers) || value.servers.length > 1) {
      throw new Error('Lista de servidores inválida');
    }
    const servers = value.servers.map((entry) => {
      const record = entry as Record<string, unknown>;
      return normalizeServerSummary(String(record.id), record);
    });
    if (suffix === '/sync') {
      cache = { token: accessToken, until: Date.now() + 3000, servers };
    }
    return servers;
  };
  return {
    list: (local) => request('POST', '/sync', { candidates: local }),
    create: async (server) => {
      const result = await request('POST', '', { server });
      if (result.length !== 1) {
        throw new Error('La API no registró el servidor');
      }
      return result[0];
    },
    update: async (server) => {
      await request('PATCH', `/${server.id}`, { server });
    },
    remove: async (id) => {
      await request('DELETE', `/${id}`);
    },
  };
}
