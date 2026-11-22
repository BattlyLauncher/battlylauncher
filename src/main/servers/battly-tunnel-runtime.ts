import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import { readBoundedRegularFile, writeFileAtomically } from '../files/atomic-file';
import type { ServerSharingOptions } from './server-sharing-service';
import { battlyTunnelCAHash, europeTunnelCA } from './battly-tunnel-integrity';
import { tunnelReleaseClient } from './battly-tunnel-release';
import { serverRegionEndpoints } from '../../shared/servers/server-regions';

/** Explicit rollout: never connect our protocol to a legacy FRP listener. */
export function battlyTunnelRuntimeOptions(
  resourceRoot?: string,
  cacheRoot?: string,
): Partial<ServerSharingOptions> {
  if (process.env.BATTLY_TUNNEL_TRANSPORT === 'frp') {
    return {};
  }
  const bundled = resourceRoot !== undefined && process.env.BATTLY_TUNNEL_TRANSPORT === undefined;
  if (!bundled && process.env.BATTLY_TUNNEL_TRANSPORT !== 'battly') {
    return {};
  }
  const target = `${process.platform}-${process.arch}`;
  if (bundled && !cacheRoot) {
    throw new Error('Battly Tunnel requires a private release cache');
  }
  const release =
    bundled &&
    cacheRoot &&
    !process.env.BATTLY_TUNNEL_CLIENT_PATH &&
    !process.env.BATTLY_TUNNEL_CLIENT_SHA256
      ? tunnelReleaseClient(cacheRoot, target)
      : undefined;
  const resourcePlatform =
    process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform;
  const path =
    process.env.BATTLY_TUNNEL_CLIENT_PATH ??
    (release
      ? release.executable
      : bundled
        ? join(
            resourceRoot,
            'battly-tunnel',
            `${resourcePlatform}-${process.arch}`,
            `battly-tunnel-client${process.platform === 'win32' ? '.exe' : ''}`,
          )
        : '');
  const sha256 = process.env.BATTLY_TUNNEL_CLIENT_SHA256 ?? (release ? '0'.repeat(64) : '');
  const serverAddr =
    process.env.BATTLY_TUNNEL_HOST ?? (bundled ? serverRegionEndpoints.latam.tunnelHost : '');
  const serverPort = Number(process.env.BATTLY_TUNNEL_PORT ?? (bundled ? 7000 : ''));
  const caFile =
    process.env.BATTLY_TUNNEL_CA_FILE ??
    (bundled ? join(resourceRoot, 'battly-tunnel', 'latam-ca.pem') : undefined);
  if (
    !isAbsolute(path) ||
    !/^[a-f0-9]{64}$/i.test(sha256) ||
    !serverAddr ||
    !Number.isInteger(serverPort) ||
    serverPort < 1 ||
    serverPort > 65535
  ) {
    throw new Error(
      'Configura la ruta, SHA-256, host y puerto de Battly Tunnel antes de activarlo',
    );
  }
  const europe =
    bundled &&
    cacheRoot &&
    !process.env.BATTLY_TUNNEL_HOST &&
    !process.env.BATTLY_TUNNEL_PORT &&
    !process.env.BATTLY_TUNNEL_CA_FILE
      ? {
          serverAddr: serverRegionEndpoints.eu.tunnelHost,
          serverPort: 7000,
          caFile: join(cacheRoot, 'europe-ca.pem'),
        }
      : undefined;
  let europeCAWrite: Promise<void> | undefined;
  return {
    battlyTransport: { serverAddr, serverPort, ...(caFile ? { caFile } : {}) },
    ...(europe ? { europeTransport: europe } : {}),
    frpcPath: path,
    frpcSha256: sha256,
    // No shared OIDC secret is needed by the Battly transport.
    oidcClientSecret: 'unused-by-battly-tunnel',
    prepareFrpc: async (region) => {
      if (!release) {
        const bytes = await readBoundedRegularFile(path, 128 * 1024 * 1024);
        if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
          throw new Error('El componente Battly Tunnel está dañado');
        }
      }
      if (region === 'eu' && europe) {
        europeCAWrite ??= (async () => {
          const installed = await readBoundedRegularFile(europe.caFile, 64 * 1024).catch(
            () => undefined,
          );
          if (installed?.toString('utf8') !== europeTunnelCA) {
            await writeFileAtomically(europe.caFile, europeTunnelCA);
          }
        })().finally(() => {
          europeCAWrite = undefined;
        });
        await europeCAWrite;
      } else if (bundled && caFile) {
        const certificate = await readBoundedRegularFile(caFile, 64 * 1024);
        const canonicalCertificate = certificate.toString('utf8').replace(/\r\n/g, '\n');
        if (
          createHash('sha256').update(canonicalCertificate).digest('hex') !== battlyTunnelCAHash
        ) {
          throw new Error('El certificado de Battly Tunnel está dañado');
        }
      }
      if (release) {
        await release.prepare();
      }
      if (process.platform !== 'win32') {
        await chmod(path, 0o700);
      }
    },
  };
}
