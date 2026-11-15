// Modpacks are untrusted documents, not a source of arbitrary network destinations.
const downloadHosts = new Set([
  'cdn.modrinth.com',
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'gitlab.com',
]);

export function validateMrpackDownloadUrl(url: URL): void {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !downloadHosts.has(url.hostname)
  ) {
    throw new TypeError('Mrpack download destination is not permitted');
  }
}
