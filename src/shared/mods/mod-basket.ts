import { normalizeModInstallRequest } from './mod-contract';
export interface ModBasketRequest {
  readonly projectIds: readonly string[];
  readonly gameVersion: string;
  readonly loader: string;
  readonly destinationInstanceId?: string;
  readonly destinationServerId?: string;
}
export interface ModBasketIssue {
  readonly kind: 'version' | 'dependency' | 'conflict' | 'environment' | 'metadata' | 'destination';
  readonly project: string;
  readonly detail: string;
  readonly projectIds?: readonly string[];
}
export interface ModBasketResult {
  readonly installed: readonly string[];
  readonly issues: readonly ModBasketIssue[];
}
export interface ModBasketProgress {
  readonly phase: 'checking' | 'downloading' | 'installing';
  readonly current: number;
  readonly total: number;
  readonly filename?: string;
}
export function normalizeModBasketRequest(value: unknown): ModBasketRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid mod basket');
  }
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          'projectIds',
          'gameVersion',
          'loader',
          'destinationInstanceId',
          'destinationServerId',
        ].includes(key),
    ) ||
    !Array.isArray(raw.projectIds) ||
    !raw.projectIds.length ||
    raw.projectIds.length > 50 ||
    new Set(raw.projectIds).size !== raw.projectIds.length
  ) {
    throw new TypeError('Invalid mod basket');
  }
  const ids = raw.projectIds.map((projectId: unknown) =>
    normalizeModInstallRequest({
      projectId,
      projectType: 'mod',
      gameVersion: raw.gameVersion,
      loader: raw.loader,
      ...(raw.destinationInstanceId === undefined
        ? {}
        : { destinationInstanceId: raw.destinationInstanceId }),
      ...(raw.destinationServerId === undefined
        ? {}
        : { destinationServerId: raw.destinationServerId }),
    }),
  );
  if (!['fabric', 'forge', 'neoforge', 'quilt'].includes(ids[0].loader)) {
    throw new TypeError('Invalid mod basket loader');
  }
  return {
    projectIds: ids.map((item) => item.projectId),
    gameVersion: ids[0].gameVersion,
    loader: ids[0].loader,
    destinationInstanceId: ids[0].destinationInstanceId,
    destinationServerId: ids[0].destinationServerId,
  };
}
