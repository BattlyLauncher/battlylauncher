export const serverRegionEndpoints = {
  latam: { apiHost: 'root.battly.org', tunnelHost: 'frp.battly.org' },
  eu: { apiHost: 'root.battly.eu', tunnelHost: 'frp-eu.battlyservers.net' },
} as const;

export type ServerRegion = keyof typeof serverRegionEndpoints;
