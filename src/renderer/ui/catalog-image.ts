export function catalogImageUrl(url: string): string {
  if (!url.startsWith('https://')) {
    return url.startsWith('battly-catalog://image/') ? url : '';
  }
  return `battly-catalog://image/?url=${encodeURIComponent(url)}`;
}
